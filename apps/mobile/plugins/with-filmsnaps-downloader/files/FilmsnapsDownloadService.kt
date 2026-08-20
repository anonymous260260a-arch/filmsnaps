package app.filmsnaps.mobile.download

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import java.util.Locale
import android.os.Binder
import android.os.Build
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
        const val EXTRA_TASK_ID = "taskId"
        const val EXTRA_URL = "url"
        const val EXTRA_FILE_NAME = "fileName"
        const val EXTRA_OFFSET = "offsetBytes"
        const val EXTRA_HEADERS = "headers"
        const val PROGRESS_THROTTLE_MS = 300L
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
        // Service is also start()-able so it survives even if unbound briefly (e.g. during
        // Activity recreation). We keep it foreground as long as any job is active.
        return START_STICKY
    }

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
        val job = DownloadJob(taskId, url, fileName, destFile, offset = actualOffset, headers = headers)
        jobs[taskId] = job
        ensureForeground()
        job.start()
    }

    /** True pause: stop the read loop, close streams, report the exact on-disk byte count. */
    fun pause(taskId: String) {
        jobs[taskId]?.pause()
    }

    fun cancel(taskId: String) {
        cancelInternal(taskId, deleteFile = true)
    }

    fun getActiveBytes(taskId: String): Long = jobs[taskId]?.destFile?.let { if (it.exists()) it.length() else 0L } ?: 0L

    private fun cancelInternal(taskId: String, deleteFile: Boolean) {
        jobs.remove(taskId)?.let { job ->
            job.cancel()
            if (deleteFile) {
                try { if (job.destFile.exists()) job.destFile.delete() } catch (_: Exception) {}
            }
        }
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
                val job = activeJobs[0]
                val received = job.progressReceived
                val total = job.progressTotal
                builder.setContentTitle(job.fileName)
                    .setContentText(formatProgress(received, total))
                if (total > 0) {
                    // Known size — determinate bar with live percentage.
                    builder.setProgress(100, ((received * 100) / total).toInt(), false)
                } else {
                    // Unknown total (chunked transfer, common on falix) — show an
                    // indeterminate bar so the user sees active progress instead of
                    // a static "downloading" with no movement.
                    builder.setProgress(0, 0, true)
                }
            }
            else -> {
                builder.setContentTitle("Filmsnaps")
                    .setContentText("Downloading ${activeJobs.size} files…")
            }
        }
        return builder.build()
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
    private fun notifyProgress() {
        // Hard guard: never re-post the notification once the queue has drained.
        // This blocks ghost posts from a progress event emitted just before the
        // last job was removed (race against stopForeground).
        if (jobs.isEmpty()) return
        val now = System.currentTimeMillis()
        if (now - lastNotifUpdate < 1000L) return
        lastNotifUpdate = now
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID_BASE, buildSummaryNotification())
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
        private val paused = AtomicBoolean(false)
        private val cancelled = AtomicBoolean(false)
        private var call: Call? = null
        private var coroutineJob: Job? = null

        fun start() {
            coroutineJob = serviceScope.launch {
                runCatching { execute() }.onFailure { e ->
                    if (cancelled.get() || paused.get()) return@onFailure // expected, not an error
                    if (e is CancellationException) return@onFailure
                    listener?.onError(taskId, e.message ?: "Unknown download error", -1)
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
                val buffer = ByteArray(64 * 1024)

                try {
                    body.byteStream().use { input ->
                        while (isActive) {
                            val read = input.read(buffer)
                            if (read == -1) break
                            raf.write(buffer, 0, read)
                            written += read
                            val now = System.currentTimeMillis()
                            if (now - lastEmit >= PROGRESS_THROTTLE_MS) {
                                lastEmit = now
                                progressReceived = written
                                progressTotal = totalBytes
                                listener?.onProgress(taskId, written, totalBytes)
                                this@FilmsnapsDownloadService.notifyProgress()
                            }
                        }
                    }
                } catch (e: IOException) {
                    // Expected path for both pause() (call.cancel() -> stream throws) and
                    // genuine network errors. Distinguish by our own flags, not by exception type.
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
                        listener?.onPaused(taskId, written, totalBytes)
                        refreshOrStopForeground()
                    }
                    else -> {
                        jobs.remove(taskId)
                        // The JS layer cannot know the real container up front, and ANY
                        // download server may serve ANY extension. Derive the true
                        // extension from the HTTP response (final URL after redirects +
                        // Content-Type) and rename the finished file so it lands with the
                        // correct extension — then players (VLC etc.) detect the codec.
                        val finalFile = renameWithRealExtension(destFile, resp)
                        listener?.onComplete(taskId, finalFile.absolutePath, totalBytes, finalFile.extension, finalFile.name)
                        refreshOrStopForeground()
                    }
                }
            }
        }
    }
}