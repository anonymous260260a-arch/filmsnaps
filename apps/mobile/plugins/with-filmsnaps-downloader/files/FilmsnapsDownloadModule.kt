package app.filmsnaps.mobile.download

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Environment
import android.os.IBinder
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

/**
 * Thin RN bridge. All real work happens in FilmsnapsDownloadService (a ForegroundService)
 * so downloads survive JS reloads and app backgrounding. This module's only jobs are:
 *   - bind/unbind to the service
 *   - translate RN calls into service calls
 *   - forward service events to JS as absolute byte counts (no arithmetic on the JS side)
 */
class FilmsnapsDownloadModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), FilmsnapsDownloadService.Listener {

    companion object { const val NAME = "FilmsnapsDownloader" }

    override fun getName(): String = NAME

    private var service: FilmsnapsDownloadService? = null
    private var bound = false
    private var listenerCount = 0

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val s = (binder as FilmsnapsDownloadService.LocalBinder).getService()
            service = s
            s.setListener(this@FilmsnapsDownloadModule)
            bound = true
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            service = null
            bound = false
        }
    }

    init {
        val intent = Intent(reactContext, FilmsnapsDownloadService::class.java)
        reactContext.startService(intent)
        reactContext.bindService(intent, connection, Context.BIND_AUTO_CREATE)
    }

    override fun invalidate() {
        super.invalidate()
        if (bound) {
            try { reactContext.unbindService(connection) } catch (_: Exception) {}
            bound = false
        }
    }

    @ReactMethod fun addListener(eventName: String) { listenerCount++ }
    @ReactMethod fun removeListeners(count: Int) { listenerCount -= count; if (listenerCount < 0) listenerCount = 0 }

    /** Returns taskIds the service considers currently active/running — used on app cold-start
     *  so JS can reconcile without a restart being required. */
    @ReactMethod
    fun getActiveTaskIds(promise: Promise) {
        val arr = Arguments.createArray()
        service?.activeTaskIds()?.forEach { arr.pushString(it) }
        promise.resolve(arr)
    }

    @ReactMethod
    fun startDownload(taskId: String, url: String, fileName: String, headers: ReadableMap?, promise: Promise) {
        val svc = service
        if (svc == null) { promise.reject("E_SERVICE_NOT_BOUND", "Download service not bound yet"); return }
        try {
            val safeName = sanitize(fileName)
            val destFile = destinationFile(safeName)
            svc.start(taskId, url, safeName, destFile, toMap(headers))
            promise.resolve(taskId)
        } catch (e: Exception) {
            promise.reject("E_START_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun pauseDownload(taskId: String, promise: Promise) {
        service?.pause(taskId)
        promise.resolve(null)
    }

    @ReactMethod
    fun resumeDownload(taskId: String, url: String, fileName: String, offsetBytes: Double, headers: ReadableMap?, promise: Promise) {
        val svc = service
        if (svc == null) { promise.reject("E_SERVICE_NOT_BOUND", "Download service not bound yet"); return }
        try {
            val safeName = sanitize(fileName)
            val destFile = destinationFile(safeName)
            svc.resume(taskId, url, safeName, destFile, offsetBytes.toLong(), toMap(headers))
            promise.resolve(taskId)
        } catch (e: Exception) {
            promise.reject("E_RESUME_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun cancelDownload(taskId: String, promise: Promise) {
        service?.cancel(taskId)
        promise.resolve(null)
    }

    @ReactMethod
    fun getAvailableStorage(promise: Promise) {
        try {
            val stat = android.os.StatFs(Environment.getDataDirectory().path)
            promise.resolve(stat.availableBytes.toDouble())
        } catch (e: Exception) {
            promise.resolve(0.0)
        }
    }

    // ── FilmsnapsDownloadService.Listener — forward straight to JS, absolute bytes only ──

    override fun onProgress(taskId: String, receivedBytes: Long, totalBytes: Long) {
        sendEvent("onDownloadProgress", Arguments.createMap().apply {
            putString("taskId", taskId)
            putDouble("bytesDownloaded", receivedBytes.toDouble())
            putDouble("bytesTotal", totalBytes.toDouble())
        })
    }

    override fun onPaused(taskId: String, receivedBytes: Long, totalBytes: Long) {
        sendEvent("onDownloadPaused", Arguments.createMap().apply {
            putString("taskId", taskId)
            putDouble("bytesDownloaded", receivedBytes.toDouble())
            putDouble("bytesTotal", totalBytes.toDouble())
        })
    }

    override fun onComplete(taskId: String, filePath: String, totalBytes: Long) {
        sendEvent("onDownloadComplete", Arguments.createMap().apply {
            putString("taskId", taskId)
            putString("filePath", filePath)
            putDouble("bytesTotal", totalBytes.toDouble())
        })
    }

    override fun onError(taskId: String, error: String, errorCode: Int) {
        sendEvent("onDownloadError", Arguments.createMap().apply {
            putString("taskId", taskId)
            putString("error", error)
            putInt("errorCode", errorCode)
        })
    }

    // ── helpers ──

    private fun destinationFile(safeName: String): File {
        val dir = File(reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Filmsnaps")
        if (!dir.exists()) dir.mkdirs()
        return File(dir, safeName)
    }

    private fun sanitize(name: String): String =
        name.replace(Regex("[<>:\"/\\\\|?*\\x00-\\x1f]"), "_").trim().take(200)

    private fun toMap(headers: ReadableMap?): Map<String, String> {
        if (headers == null) return emptyMap()
        val map = mutableMapOf<String, String>()
        val iter = headers.keySetIterator()
        while (iter.hasNextKey()) {
            val key = iter.nextKey()
            headers.getString(key)?.let { map[key] = it }
        }
        return map
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        if (listenerCount > 0) {
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }
}