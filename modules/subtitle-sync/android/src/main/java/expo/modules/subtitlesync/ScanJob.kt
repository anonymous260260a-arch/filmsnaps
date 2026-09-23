package expo.modules.subtitlesync

/**
 * Common handle for the module's headless scan jobs (progressive via
 * [RemoteScanJob], HLS via [HlsScanJob]) so the module can hold and cancel
 * either behind one field.
 */
interface ScanJob {
    fun cancel()
}