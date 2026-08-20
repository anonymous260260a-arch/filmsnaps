package app.filmsnaps.mobile.download

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor

/**
 * Zero-copy bridge so the in-app player (expo-video / ExoPlayer) can open a
 * MediaStore `content://` download without us copying the file to disk a second time.
 *
 * `HevcPlayer` builds `content://com.filmsnaps.offline/?u=<url-encoded MediaStore uri>`.
 * We decode `u` and re-serve the underlying MediaStore file descriptor. No copy, no
 * permission prompt — the app already owns the MediaStore entry it created.
 */
class OfflineFileProvider : ContentProvider() {

    override fun onCreate(): Boolean = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
        val mediaUriStr = uri.getQueryParameter("u") ?: return null
        val mediaUri = Uri.parse(mediaUriStr)
        val resolver = context?.contentResolver ?: return null
        return resolver.openFileDescriptor(mediaUri, "r")
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
}
