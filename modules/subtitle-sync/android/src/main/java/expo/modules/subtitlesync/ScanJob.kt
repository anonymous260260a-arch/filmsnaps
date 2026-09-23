package expo.modules.subtitlesync

/**
 * Common handle for the module's headless scan jobs so the module can hold
 * and cancel behind one field. Progressive + HLS both run on FastScanJob now.
 */
interface ScanJob {
    fun cancel()
}