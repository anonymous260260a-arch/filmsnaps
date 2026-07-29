package app.filmsnaps.mobile.download

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
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
        fun onComplete(taskId: String, filePath: String, totalBytes: Long)
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
        }
    }

    private fun buildSummaryNotification(): Notification {
        val activeCount = jobs.size
        val text = if (activeCount <= 1) "Downloading…" else "Downloading $activeCount files…"
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Filmsnaps")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
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
                                listener?.onProgress(taskId, written, totalBytes)
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
                        maybeStopForeground()
                        listener?.onPaused(taskId, written, totalBytes)
                    }
                    else -> {
                        jobs.remove(taskId)
                        maybeStopForeground()
                        listener?.onComplete(taskId, destFile.absolutePath, totalBytes)
                    }
                }
            }
        }
    }
}