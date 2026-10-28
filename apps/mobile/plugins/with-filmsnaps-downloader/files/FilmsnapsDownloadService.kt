package app.filmsnaps.mobile.download

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import java.util.Locale
import android.os.Binder
import android.os.Build
import android.os.Environment
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import okhttp3.*
import java.io.File
import java.io.RandomAccessFile
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Owns the lifetime of every download. Survives JS reloads and backgrounding.
 * The RN module (FilmsnapsDownloadModule.kt) binds to this and is a thin forwarder.
 *
 * One DownloadJob per taskId. Pause = stop reading the stream and close it cleanly;
 * the byte offset used for resume is ALWAYS `file.length()`, i.e. what's actually on
 * disk — never a value computed by adding numbers together in two different layers.
 */
class FilmsnapsDownloadService : Service() {

    companion object {
        const val CHANNEL_ID = "filmsnaps_downloads"
        const val NOTIFICATION_ID_BASE = 5000
        const val ACTION_START = "app.filmsnaps.mobile.download.START"
        const val ACTION_PAUSE = "app.filmsnaps.mobile.download.PAUSE"
        const val ACTION_RESUME = "app.filmsnaps.mobile.download.RESUME"
        const val ACTION_CANCEL = "app.filmsnaps.mobile.download.CANCEL"
        const val EXTRA_TASK_ID = "taskId"
        const val EXTRA_URL = "url"
        const val EXTRA_FILE_NAME = "fileName"
        const val EXTRA_OFFSET = "offsetBytes"
        const val EXTRA_HEADERS = "headers"
        const val PROGRESS_THROTTLE_MS = 300L
        /** Error code reported when the USER cancelled (notification action).
         *  JS treats this as a clean cancellation — never a failure, never retried. */
        const val CODE_CANCELLED_BY_USER = 1001

        /** Stable per-task notification id (summary keeps NOTIFICATION_ID_BASE). */
        fun taskIdToNotificationId(taskId: String): Int =
            NOTIFICATION_ID_BASE + 1 + (taskId.hashCode() and 0x7FFFFFFF) % 99999
    }

    interface Listener {
        fun onProgress(taskId: String, receivedBytes: Long, totalBytes: Long)
        fun onPaused(taskId: String, receivedBytes: Long, totalBytes: Long)
        fun onComplete(taskId: String, filePath: String, totalBytes: Long, realExt: String, realFileName: String)
        fun onError(taskId: String, error: String, errorCode: Int)
    }

    inner class LocalBinder : Binder() {
        fun getService(): FilmsnapsDownloadService = this@FilmsnapsDownloadService
    }

    private val binder = LocalBinder()
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val jobs = ConcurrentHashMap<String, DownloadJob>()
    private var listener: Listener? = null

    /** Paused descriptors — lets a notification's Resume action restart a job
     *  even when nothing is actively downloading. Resume intents also carry
     *  full extras, so this works even after process death. */
    private data class PausedJob(
        val taskId: String,
        val url: String,
        val fileName: String,
        val headers: Map<String, String>,
    )
    private val pausedJobs = ConcurrentHashMap<String, PausedJob>()

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    fun setListener(l: Listener?) { listener = l }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // ── Notification action handling ──
        // All actions arrive as PendingIntents targeting THIS service
        // (getForegroundService — user-initiated, exempt from background-start
        // limits, and survive process death because every intent carries the
        // full task descriptor). Any ACTION_* must reach startForeground() fast.
        when (intent?.action) {
            ACTION_PAUSE -> {
                ensureForeground()
                intent.getStringExtra(EXTRA_TASK_ID)?.let { pause(it) }
            }
            ACTION_RESUME -> {
                ensureForeground()
                handleResumeAction(intent)
            }
            ACTION_CANCEL -> {
                ensureForeground()
                intent.getStringExtra(EXTRA_TASK_ID)?.let { cancelFromNotification(it) }
            }
        }
        // Service is also start()-able so it survives even if unbound briefly (e.g. during
        // Activity recreation). We keep it foreground as long as any job is active.
        return START_STICKY
    }

    private fun handleResumeAction(intent: Intent) {
        val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: return
        // Prefer the in-memory descriptor; fall back to intent extras (process death).
        val paused = pausedJobs.remove(taskId)
        val url = paused?.url ?: intent.getStringExtra(EXTRA_URL) ?: return
        val fileName = paused?.fileName ?: intent.getStringExtra(EXTRA_FILE_NAME) ?: return
        val headers = paused?.headers ?: emptyMap()
        val safeName = sanitizeName(fileName)
        val destFile = File(downloadDir(), safeName)
        resume(taskId, url, safeName, destFile, destFile.length(), headers)
    }

    /** Download dir — mirrors the RN module's destinationFile() base. */
    private fun downloadDir(): File {
        val dir = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Filmsnaps")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun sanitizeName(name: String): String =
        name.replace(Regex("[<>:\"/\\\\|?*\\x00-\\x1f]"), "_").trim().take(200)

    override fun onDestroy() {
        jobs.values.forEach { it.cancel() }
        jobs.clear()
        serviceScope.cancel()
        super.onDestroy()
    }

    // ── Public API used by the RN module ─────────────────────────────────

    fun activeTaskIds(): List<String> = jobs.keys.toList()

    fun start(taskId: String, url: String, fileName: String, destFile: File, headers: Map<String, String>) {
        cancelInternal(taskId, deleteFile = true) // ensure a clean slate for a fresh start
        val job = DownloadJob(taskId, url, fileName, destFile, offset = 0L, headers = headers)
        jobs[taskId] = job
        ensureForeground()
        job.start()
    }

    fun resume(taskId: String, url: String, fileName: String, destFile: File, requestedOffset: Long, headers: Map<String, String>) {
        // Trust the real file on disk over any stale caller-supplied offset.
        val actualOffset = if (destFile.exists()) minOf(requestedOffset, destFile.length()) else 0L
        pausedJobs.remove(taskId)
        // The paused-state notification is replaced by live progress — remove it.
        try {
            getSystemService(NotificationManager::class.java).cancel(taskIdToNotificationId(taskId))
        } catch (_: Exception) {}
        val job = DownloadJob(taskId, url, fileName, destFile, offset = actualOffset, headers = headers)
        job.speedLimitBps = lastSpeedLimit
        jobs[taskId] = job
        ensureForeground()
        job.start()
    }

    /** Last user speed limit — reapplied to resumed jobs (incl. from notification). */
    @Volatile private var lastSpeedLimit: Long = 0L

    /** True pause: stop the read loop, close streams, report the exact on-disk byte count. */
    fun pause(taskId: String) {
        jobs[taskId]?.pause()
    }

    fun cancel(taskId: String) {
        // JS-initiated: JS has already marked its own state before calling.
        cancelInternal(taskId, deleteFile = true, reportToJs = false)
    }

    /** Cancel from a notification action — the JS layer has NO idea, so report
     *  a user-cancellation error event to keep notification state in sync. */
    fun cancelFromNotification(taskId: String) {
        cancelInternal(taskId, deleteFile = true, reportToJs = true)
    }

    fun getActiveBytes(taskId: String): Long = jobs[taskId]?.destFile?.let { if (it.exists()) it.length() else 0L } ?: 0L

    /** Apply a user-configured speed limit (bytes/sec) to a running job. 0 = unlimited.
     *  Additive method — the start/resume signatures (and the iOS module) stay unchanged. */
    fun setSpeedLimit(taskId: String, bytesPerSecond: Long) {
        lastSpeedLimit = bytesPerSecond
        jobs[taskId]?.speedLimitBps = bytesPerSecond
    }

    private fun cancelInternal(taskId: String, deleteFile: Boolean, reportToJs: Boolean = false) {
        pausedJobs.remove(taskId)
        jobs.remove(taskId)?.let { job ->
            job.cancel()
            if (deleteFile) {
                try { if (job.destFile.exists()) job.destFile.delete() } catch (_: Exception) {}
            }
            if (reportToJs) {
                // The tap came from the notification — JS must learn the task
                // was cancelled or its UI would show a phantom "downloading".
                try {
                    listener?.onError(taskId, "Cancelled by user", CODE_CANCELLED_BY_USER)
                } catch (_: Throwable) {}
            }
        }
        // Dismiss this task's notification immediately — a cancelled download
        // must never leave a "downloading" notification behind.
        try {
            getSystemService(NotificationManager::class.java)
                .cancel(taskIdToNotificationId(taskId))
        } catch (_: Exception) {}
        maybeStopForeground()
    }

    // ── Foreground notification lifecycle ────────────────────────────────

    private fun ensureForeground() {
        val notification = buildSummaryNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID_BASE, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID_BASE, notification)
        }
    }

    private fun maybeStopForeground() {
        if (jobs.isEmpty()) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            // Explicitly cancel the notification ID: guarantees it is gone even if a
            // delayed notify() would otherwise re-post it (ghost-notification fix).
            val nm = getSystemService(NotificationManager::class.java)
            nm.cancel(NOTIFICATION_ID_BASE)
            // No jobs left → the foreground service has nothing to do. Stop it so the
            // OS reclaims it instead of leaving an idle service in the background.
            // The RN module re-binds lazily on the next download (see onServiceDisconnected).
            stopSelf()
        }
    }

    // ── Notification actions (PendingIntents targeting THIS service) ─────

    private fun actionIntent(action: String, taskId: String, job: PausedJob? = null): Intent {
        val intent = Intent(this, FilmsnapsDownloadService::class.java).setAction(action)
        intent.putExtra(EXTRA_TASK_ID, taskId)
        if (job != null) {
            // Full descriptor on resume/cancel intents → works after process death.
            intent.putExtra(EXTRA_URL, job.url)
            intent.putExtra(EXTRA_FILE_NAME, job.fileName)
        }
        return intent
    }

    private fun pauseAction(taskId: String): PendingIntent =
        PendingIntent.getService(
            this, taskId.hashCode(), actionIntent(ACTION_PAUSE, taskId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /** Resume may (re)start the service from the background — user-initiated
     *  notification taps are explicitly exempt from background-start limits. */
    private fun resumeAction(job: PausedJob): PendingIntent =
        PendingIntent.getForegroundService(
            this, ("r" + job.taskId).hashCode(), actionIntent(ACTION_RESUME, job.taskId, job),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun cancelAction(taskId: String): PendingIntent =
        PendingIntent.getService(
            this, ("c" + taskId).hashCode(), actionIntent(ACTION_CANCEL, taskId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun NotificationCompat.Builder.applyProgress(received: Long, total: Long): NotificationCompat.Builder {
        if (total > 0) {
            setProgress(100, ((received.coerceAtLeast(0) * 100) / total).toInt(), false)
        } else {
            // Unknown total (chunked transfer, common on falix) — indeterminate bar.
            setProgress(0, 0, true)
        }
        return this
    }

    private fun NotificationCompat.Builder.baseTask(jobActive: Boolean): NotificationCompat.Builder {
        setSmallIcon(android.R.drawable.stat_sys_download)
        setOnlyAlertOnce(true)
        setContentIntent(openDownloadsIntent())
        setOngoing(jobActive)
        return this
    }

    private fun buildSummaryNotification(): Notification {
        val activeJobs = jobs.values.toList()
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openDownloadsIntent())

        when {
            activeJobs.isEmpty() -> {
                builder.setContentTitle("Filmsnaps")
                    .setContentText("Downloads up to date")
            }
            activeJobs.size == 1 -> {
                // Single download: the summary IS the task notification — with
                // real speed/ETA and Pause/Cancel actions. No duplicate rows.
                val job = activeJobs[0]
                val received = job.progressReceived
                val total = job.progressTotal
                builder.setContentTitle(job.fileName)
                    .setContentText(progressLine(received, total, job.notifSpeedBps))
                    .applyProgress(received, total)
                    .addAction(0, "Pause", pauseAction(job.taskId))
                    .addAction(0, "Cancel", cancelAction(job.taskId))
            }
            else -> {
                val known = activeJobs.filter { it.progressTotal > 0 }
                val pct = if (known.isNotEmpty()) {
                    val done = known.sumOf { it.progressReceived }
                    val tot = known.sumOf { it.progressTotal }
                    if (tot > 0) " · ${(done * 100 / tot).toInt()}%" else ""
                } else ""
                builder.setContentTitle("Filmsnaps")
                    .setContentText("Downloading ${activeJobs.size} files$pct")
            }
        }
        return builder.build()
    }

    /** Per-task notification (only shown alongside OTHER active downloads). */
    private fun buildTaskNotification(job: DownloadJob): Notification {
        val received = job.progressReceived
        val total = job.progressTotal
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .baseTask(jobActive = true)
            .setContentTitle(job.fileName)
            .setContentText(progressLine(received, total, job.notifSpeedBps))
            .applyProgress(received, total)
            .addAction(0, "Pause", pauseAction(job.taskId))
            .addAction(0, "Cancel", cancelAction(job.taskId))
            .build()
    }

    /** "Paused · 450 MB of 1.2 GB" — NOT ongoing, so it survives service stop,
     *  with Resume + Cancel actions that work even after process death. */
    private fun postPausedNotification(taskId: String, fileName: String, received: Long, total: Long) {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .baseTask(jobActive = false)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(fileName)
            .setContentText("Paused · ${formatProgress(received, total)}")
            .applyProgress(received, total)
            .addAction(0, "Resume", resumeAction(PausedJob(taskId, pausedJobs[taskId]?.url ?: "", pausedJobs[taskId]?.fileName ?: fileName, pausedJobs[taskId]?.headers ?: emptyMap())))
            .addAction(0, "Cancel", cancelAction(taskId))
            .build()
        try {
            getSystemService(NotificationManager::class.java)
                .notify(taskIdToNotificationId(taskId), notification)
        } catch (_: Exception) {}
    }

    /** Terminal notifications — real value, not noise: what finished (or why
     *  it failed), tap → downloads screen. Auto-cancel on tap. */
    private fun postTerminalNotification(taskId: String, fileName: String, title: String, text: String) {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(
                if (title == "Download complete") android.R.drawable.stat_sys_download_done
                else android.R.drawable.stat_notify_error
            )
            .setContentTitle(title)
            .setContentText(fileName)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$fileName — $text"))
            .setContentIntent(openDownloadsIntent())
            .setAutoCancel(true)
            .setOngoing(false)
            .setOnlyAlertOnce(true)
            .build()
        try {
            getSystemService(NotificationManager::class.java)
                .notify(taskIdToNotificationId(taskId), notification)
        } catch (_: Exception) {}
    }

    /**
     * Tap target: deep-link into the in-app Downloads screen. The app's URL
     * scheme is `filmsnaps`, and `/downloads` is a top-level route, so
     * `filmsnaps://downloads` routes the user to the download manager.
     */
    private fun openDownloadsIntent(): PendingIntent {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("filmsnaps://downloads"))
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** Throttled notification refresh during active downloads (max ~1/sec). */
    private var lastNotifUpdate = 0L
    private val lastTaskNotifUpdate = ConcurrentHashMap<String, Long>()
    private fun notifyProgress() {
        // Hard guard: never re-post the notification once the queue has drained.
        // This blocks ghost posts from a progress event emitted just before the
        // last job was removed (race against stopForeground).
        if (jobs.isEmpty()) return
        val now = System.currentTimeMillis()
        val nm = getSystemService(NotificationManager::class.java)

        // Per-task notifications only when several downloads run in parallel
        // (with one download the summary carries everything — no noise).
        if (jobs.size > 1) {
            for (job in jobs.values) {
                val last = lastTaskNotifUpdate[job.taskId] ?: 0L
                if (now - last < 1000L) continue
                lastTaskNotifUpdate[job.taskId] = now
                try { nm.notify(taskIdToNotificationId(job.taskId), buildTaskNotification(job)) } catch (_: Exception) {}
            }
        }

        if (now - lastNotifUpdate < 1000L) return
        lastNotifUpdate = now
        nm.notify(NOTIFICATION_ID_BASE, buildSummaryNotification())
    }

    /** "45% · 12.3 MB/s · 3m 12s left" (falls back gracefully when size is unknown). */
    private fun progressLine(received: Long, total: Long, speedBps: Long): String {
        val parts = mutableListOf<String>()
        if (total > 0) parts.add("${(received.coerceAtLeast(0) * 100 / total).toInt()}%")
        parts.add(formatProgress(received, total))
        if (speedBps > 0) {
            parts.add("${humanReadableBytes(speedBps)}/s")
            if (total > 0 && total > received) {
                val secs = (total - received) / speedBps
                val eta = when {
                    secs < 90 -> "${secs}s left"
                    secs < 5400 -> "${secs / 60}m ${(secs % 60).toInt()}s left"
                    else -> "${secs / 3600}h ${(secs % 3600) / 60}m left"
                }
                parts.add(eta)
            }
        }
        return parts.joinToString(" · ")
    }

    /** If jobs remain, refresh the notification to reflect them; else stop it. */
    private fun refreshOrStopForeground() {
        if (jobs.isEmpty()) maybeStopForeground() else notifyProgress()
    }

    private fun formatProgress(received: Long, total: Long): String {
        val rec = humanReadableBytes(received)
        return if (total > 0) "$rec / ${humanReadableBytes(total)}" else "$rec downloaded"
    }

    private fun humanReadableBytes(bytes: Long): String {
        if (bytes <= 0) return "0 B"
        val units = arrayOf("B", "KB", "MB", "GB", "TB")
        val exp = (Math.log(bytes.toDouble()) / Math.log(1024.0))
            .toInt()
            .coerceAtMost(units.size - 1)
        val value = bytes / Math.pow(1024.0, exp.toDouble())
        return String.format(Locale.US, "%.1f %s", value, units[exp])
    }

    /**
     * Derive the real file extension from the HTTP response. The JS layer guesses
     * an extension up front, but the actual container is only knowable once we see
     * the server's response — and any download server may serve any extension.
     * Prefers a clear extension on the final URL (after redirects); falls back to
     * the Content-Type header when the URL has none.
     */
    private fun resolveExtension(resp: Response): String? {
        val finalUrl = resp.request.url.toString()
        val contentType = resp.header("Content-Type")
        return resolveExtension(finalUrl, contentType)
    }

    private fun resolveExtension(url: String, contentType: String?): String? {
        val urlExt = url
            .substringBefore('?')
            .substringBefore('#')
            .substringAfterLast('/')
            .substringAfterLast('.', "")
            .lowercase()
            .takeIf { it.length in 2..4 }
        val ctExt = contentType
            ?.substringBefore(';')
            ?.trim()
            ?.lowercase()
            ?.let { mimeToExt(it) }
        // Trust a clear URL extension; otherwise fall back to the Content-Type one.
        return urlExt ?: ctExt
    }

    private fun mimeToExt(mime: String): String? = when (mime) {
        "video/x-matroska" -> "mkv"
        "video/webm" -> "webm"
        "video/mp4", "video/x-m4v", "video/m4v" -> "mp4"
        "video/quicktime" -> "mov"
        "video/x-msvideo" -> "avi"
        "video/x-flv" -> "flv"
        "video/3gpp" -> "3gp"
        "video/mp2t" -> "ts"
        else -> null
    }

    /** Rename a finished file to its real extension (no-op if already correct). */
    private fun renameWithRealExtension(file: File, resp: Response): File {
        val realExt = resolveExtension(resp) ?: return file
        val currentExt = file.extension.lowercase()
        if (realExt == currentExt) return file
        val newFile = File(file.parentFile, "${file.nameWithoutExtension}.$realExt")
        if (newFile.exists()) return file // never clobber an existing file
        return try {
            if (file.renameTo(newFile)) newFile else file
        } catch (_: Exception) {
            file
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW)
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    // ── DownloadJob: one real HTTP streaming download ─────────────────────

    inner class DownloadJob(
        val taskId: String,
        val url: String,
        val fileName: String,
        val destFile: File,
        private val offset: Long,
        private val headers: Map<String, String>,
    ) {
        // Latest progress, surfaced to the foreground notification.
        @Volatile var progressReceived: Long = offset
        @Volatile var progressTotal: Long = -1L
        /** Smoothed speed (bytes/sec) for the notification's speed/ETA line. */
        @Volatile var notifSpeedBps: Long = 0L
        private var notifLastBytes: Long = offset
        private var notifLastTs: Long = 0L
        /** User-configured speed cap in bytes/sec (0 = unlimited). Checked every read. */
        @Volatile var speedLimitBps: Long = 0L
        private val paused = AtomicBoolean(false)
        private val cancelled = AtomicBoolean(false)
        private var call: Call? = null
        private var coroutineJob: Job? = null

        fun start() {
            coroutineJob = serviceScope.launch {
                runCatching { execute() }.onFailure { e ->
                    if (cancelled.get() || paused.get()) return@onFailure // expected, not an error
                    if (e is CancellationException) return@onFailure
                    // This scope has no CoroutineExceptionHandler — an escape
                    // from onError (promise/event delivery) would be fatal.
                    try {
                        listener?.onError(taskId, e.message ?: "Unknown download error", -1)
                    } catch (_: Throwable) {
                    }
                    lastTaskNotifUpdate.remove(taskId)
                    postTerminalNotification(
                        taskId,
                        fileName,
                        "Download failed",
                        e.message ?: "Unknown error — retry from your downloads",
                    )
                }
            }
        }

        fun pause() {
            if (paused.compareAndSet(false, true)) {
                call?.cancel() // interrupts the InputStream read cleanly; caught below
            }
        }

        fun cancel() {
            if (cancelled.compareAndSet(false, true)) {
                call?.cancel()
                coroutineJob?.cancel()
            }
        }

        private suspend fun execute() = withContext(Dispatchers.IO) {
            destFile.parentFile?.mkdirs()
            val requestBuilder = Request.Builder().url(url)
            headers.forEach { (k, v) -> if (k != "Range") requestBuilder.addHeader(k, v) }
            if (offset > 0) {
                requestBuilder.addHeader("Range", "bytes=$offset-")
            }
            val request = requestBuilder.build()
            val newCall = client.newCall(request)
            call = newCall

            val response = try {
                newCall.execute()
            } catch (e: IOException) {
                if (cancelled.get() || paused.get()) return@withContext
                throw e
            }

            response.use { resp ->
                if (!resp.isSuccessful) {
                    listener?.onError(taskId, "HTTP ${resp.code}", resp.code)
                    return@use
                }
                // If we asked for a Range but the server ignored it (200 instead of 206),
                // we must start the file over rather than append — otherwise we'd corrupt it.
                val servedPartial = resp.code == 206
                val effectiveOffset = if (offset > 0 && !servedPartial) 0L else offset

                val body = resp.body ?: run {
                    listener?.onError(taskId, "Empty response body", -1)
                    return@use
                }
                val contentLength = body.contentLength()
                val totalBytes = when {
                    contentLength <= 0 -> -1L
                    servedPartial -> effectiveOffset + contentLength
                    else -> contentLength
                }

                val raf = RandomAccessFile(destFile, "rw")
                raf.seek(effectiveOffset)
                if (effectiveOffset == 0L) raf.setLength(0)

                var written = effectiveOffset
                var lastEmit = 0L
                var streamEndedNaturally = false
                val buffer = ByteArray(64 * 1024)
                // 1-second throttle window for the optional speed limit.
                var throttleWindowStart = System.currentTimeMillis()
                var throttleWindowBytes = 0L

                try {
                    body.byteStream().use { input ->
                        while (isActive) {
                            val read = input.read(buffer)
                            if (read == -1) break
                            raf.write(buffer, 0, read)
                            written += read
                            // Speed-limit throttle (token window): once the window's
                            // byte budget is spent, sleep out the rest of the second.
                            val limit = speedLimitBps
                            if (limit > 0) {
                                throttleWindowBytes += read
                                if (throttleWindowBytes >= limit) {
                                    val windowElapsed = System.currentTimeMillis() - throttleWindowStart
                                    if (windowElapsed < 1000L) Thread.sleep(1000L - windowElapsed)
                                    throttleWindowStart = System.currentTimeMillis()
                                    throttleWindowBytes = 0L
                                }
                            }
                            val now = System.currentTimeMillis()
                            if (now - lastEmit >= PROGRESS_THROTTLE_MS) {
                                lastEmit = now
                                // Exponentially-smoothed speed for the notification.
                                if (notifLastTs > 0) {
                                    val dt = now - notifLastTs
                                    if (dt > 0) {
                                        val inst = (written - notifLastBytes) * 1000 / dt
                                        notifSpeedBps = if (notifSpeedBps == 0L) inst
                                            else (notifSpeedBps * 3 + inst) / 4
                                    }
                                }
                                notifLastBytes = written
                                notifLastTs = now
                                progressReceived = written
                                progressTotal = totalBytes
                                listener?.onProgress(taskId, written, totalBytes)
                                this@FilmsnapsDownloadService.notifyProgress()
                            }
                        }
                        // Reaching EOF (-1) is the ONLY natural end of a stream.
                        streamEndedNaturally = true
                    }
                } catch (e: IOException) {
                    // pause()/cancel() cancel the call, whose stream then throws
                    // here — distinguish by OUR OWN flags, never by the exception
                    // type. Anything else is a genuine network failure and the
                    // download is NOT complete: propagate it to the JS layer so
                    // the task is failed (or retried) instead of masquerading as
                    // a finished file. F10 fix.
                    if (!paused.get() && !cancelled.get()) {
                        jobs.remove(taskId)
                        lastTaskNotifUpdate.remove(taskId)
                        listener?.onError(
                            taskId,
                            "Download interrupted: ${e.message ?: "network error"}",
                            -1,
                        )
                        postTerminalNotification(
                            taskId,
                            fileName,
                            "Download failed",
                            "Network problem — retry from your downloads",
                        )
                        refreshOrStopForeground()
                        return@use
                    }
                } finally {
                    raf.fd.sync()
                    raf.close()
                }

                when {
                    cancelled.get() -> {
                        // cancelInternal() already removed us from the jobs map and will delete the file.
                    }
                    paused.get() -> {
                        jobs.remove(taskId)
                        lastTaskNotifUpdate.remove(taskId)
                        // Remember how to restart this job so the notification's
                        // Resume action works even with zero active downloads.
                        pausedJobs[taskId] = PausedJob(taskId, url, fileName, headers)
                        listener?.onPaused(taskId, written, totalBytes)
                        postPausedNotification(taskId, fileName, written, totalBytes)
                        refreshOrStopForeground()
                    }
                    else -> {
                        // F10: a partial download must NEVER be reported as
                        // completed. Either the stream ended early (network drop
                        // that didn't throw, or a server closing the connection
                        // short) or we know the expected size and didn't get it
                        // all — both are failures, not completions.
                        val fullyReceived =
                            streamEndedNaturally &&
                                (totalBytes < 0 || written >= totalBytes)
                        if (!fullyReceived) {
                            jobs.remove(taskId)
                            lastTaskNotifUpdate.remove(taskId)
                            listener?.onError(
                                taskId,
                                "Incomplete download: ${written}/$totalBytes bytes",
                                -1,
                            )
                            postTerminalNotification(
                                taskId,
                                fileName,
                                "Download failed",
                                "Transfer cut off — it will resume automatically",
                            )
                            refreshOrStopForeground()
                            return@use
                        }
                        jobs.remove(taskId)
                        // The JS layer cannot know the real container up front, and ANY
                        // download server may serve ANY extension. Derive the true
                        // extension from the HTTP response (final URL after redirects +
                        // Content-Type) and rename the finished file so it lands with the
                        // correct extension — then players (VLC etc.) detect the codec.
                        val finalFile = renameWithRealExtension(destFile, resp)
                        lastTaskNotifUpdate.remove(taskId)
                        listener?.onComplete(taskId, finalFile.absolutePath, totalBytes, finalFile.extension, finalFile.name)
                        postTerminalNotification(
                            taskId,
                            finalFile.name,
                            "Download complete",
                            "Tap to open your downloads",
                        )
                        refreshOrStopForeground()
                    }
                }
            }
        }
    }
}