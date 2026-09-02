import { NextRequest, NextResponse } from "next/server";
import { getTVShows } from "@/lib/tmdb.server";
import { desktopSkip } from "../desktop-skip";
import { getCorsHeaders, handleOptions } from "@/lib/cors";

export const revalidate = 86400; // 24 hours

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(req: NextRequest) {
  const skip = desktopSkip();
  if (skip) return skip;
  const { searchParams } = new URL(req.url);
  const origin = req.headers.get("origin");

  const page = Number(searchParams.get("page") || 1);
  const sortBy = searchParams.get("sortBy") || "popularity.desc";
  const yearStart = Number(searchParams.get("yearStart") || 1950);
  const yearEnd = Number(
    searchParams.get("yearEnd") || new Date().getFullYear(),
  );
  const minRating = Number(searchParams.get("minRating") || 0);
  const maxRating = Number(searchParams.get("maxRating") || 10);
  const genres = searchParams.get("genres")?.split(",").map(Number);
  const language = searchParams.get("language") || undefined;

  try {
    const tvShows = await getTVShows({
      page,
      sortBy,
      genreIds: genres,
      yearStart,
      yearEnd,
      minRating,
      maxRating,
      language,
    });

    return NextResponse.json(tvShows, { headers: getCorsHeaders(origin) });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { results: [], page, total_pages: 0 },
      { status: 500, headers: getCorsHeaders(origin) },
    );
  }
}
