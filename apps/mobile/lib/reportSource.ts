/**
 * Report Source — fire-and-forget telemetry for broken streaming sources.
 * Allows users to report sources that aren't working so the provider
 * blacklist can be maintained.
 */

export interface SourceReport {
  providerId: string;
  tmdbId: string;
  mediaType: string;
  errorMessage: string;
  timestamp: number;
}

const REPORT_ENABLED = false; // Flip to true once a backend endpoint exists

/**
 * Report a broken source. Currently logs to console; future versions
 * will POST to a telemetry endpoint.
 */
export async function reportBrokenSource(
  providerId: string,
  tmdbId: string,
  mediaType: string,
  errorMessage: string,
): Promise<void> {
  const report: SourceReport = {
    providerId,
    tmdbId,
    mediaType,
    errorMessage,
    timestamp: Date.now(),
  };

  console.log("[ReportSource]", JSON.stringify(report));

  if (!REPORT_ENABLED) return;

  try {
    // Future: POST to a lightweight ingestion endpoint
    // await fetch('https://telemetry.filmsnaps.app/report', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(report),
    // });
  } catch (err) {
    console.warn("[ReportSource] Failed to send report:", err);
  }
}
