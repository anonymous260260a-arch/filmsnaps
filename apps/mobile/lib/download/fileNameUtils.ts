/**
 * Fixes Bug 6 (".mkv.mp4"): the old code appended `task.extension || "mp4"` to a
 * fileName that already had an extension. buildFileName now strips whatever extension
 * is already present before appending the canonical one, so there's exactly one.
 */
export function buildFileName(
  fileName: string,
  extension?: string,
  uniqueSuffix?: string,
): string {
  const lastDot = fileName.lastIndexOf(".");
  const base = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
  const existingExt = lastDot > 0 ? fileName.slice(lastDot + 1) : undefined;
  const ext = (extension || existingExt || "mp4").replace(/^\.+/, "");
  const suffix = uniqueSuffix ? `_${uniqueSuffix}` : "";
  return `${base}${suffix}.${ext}`;
}

export function sanitizeForNative(fileName: string): string {
  return fileName
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 200);
}
