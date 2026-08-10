/**
 * JsonLd — render a JSON-LD structured-data block as server HTML.
 *
 * Escapes `<` so that strings coming from TMDB (titles, overviews, bios)
 * can never break out of the <script> tag and inject markup. JSON.stringify
 * already escapes quotes/backslashes; only `<` (→ <) needs extra care
 * for a `</script>`-safe payload.
 */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
