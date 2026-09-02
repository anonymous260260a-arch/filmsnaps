/**
 * Gate for API routes during static export (desktop builds).
 *
 * output: 'export' tries to prerender every route, including API routes.
 * Desktop never calls these — it hits the CF Worker directly via
 * NEXT_PUBLIC_API_URL. This helper returns a static 410 early so the
 * route compiles to a no-op shell during desktop builds.
 *
 * Usage: call at the top of every GET/POST handler:
 *   const skip = desktopSkip(); if (skip) return skip;
 */
import { NextResponse } from "next/server";

const IS_DESKTOP = process.env.BUILD_FOR_DESKTOP === "true";

export function desktopSkip(): NextResponse | null {
  if (!IS_DESKTOP) return null;
  return NextResponse.json(
    { error: "Not available in desktop build" },
    { status: 410 },
  );
}
