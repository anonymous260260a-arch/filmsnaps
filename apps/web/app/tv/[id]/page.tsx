import { redirect } from "next/navigation";

/**
 * Deep-link target shared with the mobile app — path-form /tv/{id} redirect
 * (App Links / filmsnaps:// scheme / share sheet) to the canonical ?id= route.
 * See movie/[id]/page.tsx for the matching movie-side note.
 */
export default async function TvDeepLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/tv?id=${encodeURIComponent(id)}`);
}
