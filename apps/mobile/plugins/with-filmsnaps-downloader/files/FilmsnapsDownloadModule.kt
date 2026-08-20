package app.filmsnaps.mobile.download

import android.content.ComponentName
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.ActivityNotFoundException
import android.content.ServiceConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.provider.MediaStore
import android.util.Log
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
            // The service may stop itself via stopSelf() once the queue drains.
            // Re-bind lazily so the next download (after the service has been
            // recreated) succeeds instead of hitting E_SERVICE_NOT_BOUND.
            rebind()
        }
    }

    /** Re-bind to the download service. Defined as a separate method so the
     *  `connection` object literal does not reference `connection` during its own
     *  initialization (which made the Kotlin compiler hit a recursive-type error). */
    private fun rebind() {
        try {
            val intent = Intent(reactContext, FilmsnapsDownloadService::class.java)
            reactContext.startService(intent)
            reactContext.bindService(intent, connection, Context.BIND_AUTO_CREATE)
        } catch (_: Exception) {}
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
            // Measure the primary shared (emulated) storage so the reported
            // total/free match what the user sees in Android's Storage settings.
            // Use the explicit block-count * block-size getters rather than the
            // totalBytes / availableBytes convenience properties — on some OEM
            // ROMs totalBytes returns 0 for /data, which made the meter show
            // "free of free" (e.g. 44 GB free of 44 GB on a 128 GB device).
            val root = Environment.getExternalStorageDirectory() ?: Environment.getDataDirectory()
            val stat = android.os.StatFs(root.path)
            val blockSize = stat.blockSizeLong
            val map = Arguments.createMap()
            map.putDouble("free", (stat.availableBlocksLong * blockSize).toDouble())
            map.putDouble("total", (stat.blockCountLong * blockSize).toDouble())
            promise.resolve(map)
        } catch (e: Exception) {
            val map = Arguments.createMap()
            map.putDouble("free", 0.0)
            map.putDouble("total", 0.0)
            promise.resolve(map)
        }
    }

    /** Delete a download by URI. Handles both MediaStore `content://` entries
     *  (API 29+, via ContentResolver) and legacy `file://` app-private files. */
    @ReactMethod
    fun deleteFile(uri: String, promise: Promise) {
        try {
            if (uri.startsWith("content://")) {
                reactContext.contentResolver.delete(Uri.parse(uri), null, null)
            } else {
                val path = Uri.parse(uri).path ?: uri
                val f = File(path)
                if (f.exists()) f.delete()
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("E_DELETE_FAILED", e.message, e)
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

    override fun onComplete(taskId: String, filePath: String, totalBytes: Long, realExt: String, realFileName: String) {
        // Publish the finished temp file into the public Downloads collection (API 29+)
        // so it shows in the system Downloads app and is playable by other apps. On older
        // APIs we keep the app-private file. Returns the URI to surface to JS.
        val finalUri = publishToDownloads(File(filePath))
        sendEvent("onDownloadComplete", Arguments.createMap().apply {
            putString("taskId", taskId)
            putString("filePath", finalUri ?: filePath)
            putDouble("bytesTotal", totalBytes.toDouble())
            putString("extension", realExt)
            putString("fileName", realFileName)
        })
    }

    override fun onError(taskId: String, error: String, errorCode: Int) {
        sendEvent("onDownloadError", Arguments.createMap().apply {
            putString("taskId", taskId)
            putString("error", error)
            putInt("errorCode", errorCode)
        })
    }

    // ── Open / Share MediaStore files via a chooser ──
    // expo-sharing only accepts file:// URLs (its native getLocalFileFoUrl throws
    // "Only local file URLs are supported" for any content:// scheme), so it cannot
    // hand our MediaStore content:// URIs to another app. We bypass it entirely and
    // fire a direct intent. Because our app inserted the MediaStore row, we own it
    // and can grant the chosen app temporary read access via
    // FLAG_GRANT_READ_URI_PERMISSION (scoped-storage safe; grant is URI-specific
    // and revoked when the target activity closes).

    @ReactMethod
    fun openWithChooser(uriString: String, mimeType: String, title: String, promise: Promise) {
        try {
            val uri = Uri.parse(uriString)
            val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mimeType)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(viewIntent, title).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(chooser)
            promise.resolve(true)
        } catch (e: ActivityNotFoundException) {
            // The ONLY case the user truly has no player installed.
            promise.reject("NO_APP_FOUND", "No application found to open this file type.", e)
        } catch (e: Exception) {
            promise.reject("OPEN_ERROR", "Failed to open file: ${e.message}", e)
        }
    }

    @ReactMethod
    fun shareWithChooser(uriString: String, mimeType: String, title: String, promise: Promise) {
        try {
            val uri = Uri.parse(uriString)
            val sendIntent = Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(sendIntent, title).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(chooser)
            promise.resolve(true)
        } catch (e: ActivityNotFoundException) {
            promise.reject("NO_APP_FOUND", "No application found to share this file type.", e)
        } catch (e: Exception) {
            promise.reject("SHARE_ERROR", "Failed to share file: ${e.message}", e)
        }
    }

    // ── helpers ──

    private fun destinationFile(safeName: String): File {
        val dir = File(reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Filmsnaps")
        if (!dir.exists()) dir.mkdirs()
        return File(dir, safeName)
    }

    /**
     * Copy a completed temp file into the public Downloads collection (API 29+),
     * where it becomes visible in the system Downloads app and playable by any
     * player. Returns the MediaStore `content://` URI to surface to JS; falls back
     * to the temp `file://` path on older APIs or on any failure (download still
     * succeeds, just stays app-private).
     *
     * The MediaStore entry is created only at completion — never held `IS_PENDING`
     * during the download — so a killed download never leaves an orphaned pending
     * entry behind. The temp file is deleted once the copy succeeds.
     */
    private fun publishToDownloads(tempFile: File): String? {
        if (!tempFile.exists()) return null
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return tempFile.absolutePath
        }
        return try {
            val resolver = reactContext.contentResolver
            // FIX (per Android 16 / Scoped Storage expert review): RELATIVE_PATH is
            // relative to the shared-storage VOLUME root, so a bare "Filmsnaps" tried
            // to write to /storage/emulated/0/Filmsnaps — which apps cannot do without
            // MANAGE_EXTERNAL_STORAGE, so the insert returned null and we fell back to
            // the app-private path. Prefixing with Environment.DIRECTORY_DOWNLOADS
            // places it at Download/Filmsnaps (public, no permission needed).
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, tempFile.name)
                put(MediaStore.Downloads.MIME_TYPE, mimeFromName(tempFile.name))
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Filmsnaps")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: run {
                    Log.e(
                        "FilmsnapsDownload",
                        "publishToDownloads: MediaStore insert returned null for ${tempFile.name}",
                    )
                    return tempFile.absolutePath
                }
            resolver.openOutputStream(uri)?.use { out ->
                tempFile.inputStream().use { it.copyTo(out) }
            }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            try { tempFile.delete() } catch (_: Exception) {}
            uri.toString()
        } catch (e: Exception) {
            Log.e("FilmsnapsDownload", "publishToDownloads failed for ${tempFile.name}: ${e.message}", e)
            tempFile.absolutePath
        }
    }

    private fun mimeFromName(name: String): String {
        return when (name.substringAfterLast('.', "").lowercase()) {
            "mkv" -> "video/x-matroska"
            "webm" -> "video/webm"
            "m4v" -> "video/mp4"
            "mov" -> "video/quicktime"
            "avi" -> "video/x-msvideo"
            "flv" -> "video/x-flv"
            "3gp" -> "video/3gpp"
            "ts" -> "video/mp2t"
            else -> "video/mp4"
        }
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