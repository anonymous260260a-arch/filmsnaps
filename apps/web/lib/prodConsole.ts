/**
 * prodConsole — silence routine console output in production builds.
 *
 * Debug logs ([Direct] player diagnostics, [QoE], provider traces) are
 * invaluable in development and noise in a shipped app — and the desktop
 * renderer forwards every line into the main-process log, so a shipped app
 * also ships that noise. Routine levels (log/info/debug/table/trace) become
 * no-ops when NODE_ENV is production; warn/error stay untouched so real
 * failures still surface.
 *
 * Import this module from a client component mounted at the app root (the
 * "use client" directive puts it in the browser bundle). The window guard
 * keeps the server bundle's evaluation from patching Node's console.
 */

"use client";

if (typeof window !== "undefined" && process.env.NODE_ENV === "production") {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
  console.table = noop;
  console.trace = noop;
}
