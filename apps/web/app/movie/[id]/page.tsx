import { redirect } from "next/navigation";

/**
 * Deep-link target shared with the mobile app: the app's share sheet emits
 * https://filmsnap-pro.netlify.app/movie/{id} (path form, which is also what
 * Android App Links / the filmnaps:// scheme resolve to on-device). Browsers
 * without the app land here and are sent to the canonical ?id= route that the
 * client-fetched detail page actually renders.
 */
export default async function MovieDeepLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/movie?id=${encodeURIComponent(id)}`);
}
