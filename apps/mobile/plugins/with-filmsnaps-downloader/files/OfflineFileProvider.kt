package app.filmsnaps.mobile.download

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Log

/**
 * Zero-copy bridge so the in-app player (expo-video / ExoPlayer) can open a
 * MediaStore `content://` download without us copying the file to disk a second time.
 *
 * `HevcPlayer` builds `content://com.filmsnaps.offline/?u=<url-encoded MediaStore uri>`.
 * We decode `u` and re-serve the underlying MediaStore file descriptor. No copy, no
 * permission prompt — the app already owns the MediaStore entry it created.
 *
 * Every call is logged under the `OfflineFileProvider` tag (offline-playback audit):
 * the log line tells us whether ExoPlayer ever reached the bridge, whether the
 * MediaStore fd opened, and what it threw if it did not.
 */
class OfflineFileProvider : ContentProvider() {

    override fun onCreate(): Boolean = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
        val mediaUriStr = uri.getQueryParameter("u")
        if (mediaUriStr == null) {
            Log.e(TAG, "openFile mode=$mode FAILED — no ?u= param on $uri")
            return null
        }
        return try {
            val pfd = context?.contentResolver?.openFileDescriptor(Uri.parse(mediaUriStr), "r")
            if (pfd == null) {
                Log.e(TAG, "openFile mode=$mode mediaUri=$mediaUriStr → fd=NULL")
            } else {
                Log.d(
                    TAG,
                    "openFile mode=$mode mediaUri=$mediaUriStr → fd=${pfd.fd} statSize=${pfd.statSize} valid=${pfd.fileDescriptor.valid()}",
                )
            }
            pfd
        } catch (e: Exception) {
            Log.e(
                TAG,
                "openFile mode=$mode mediaUri=$mediaUriStr THREW ${e.javaClass.simpleName}: ${e.message}",
                e,
            )
            throw e
        }
    }

    override fun query(
        uri: Uri,
        projection: Array<String>?,
        selection: String?,
        selectionArgs: Array<String>?,
        sortOrder: String?,
    ): Cursor? = null

    override fun getType(uri: Uri): String? = "video/*"

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = 0

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<String>?,
    ): Int = 0

    private companion object {
        const val TAG = "OfflineFileProvider"
    }
}
