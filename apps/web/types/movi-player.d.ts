import type { DetailedHTMLProps, HTMLAttributes } from "react";

/**
 * <movi-player> — custom element from the movi-player package, loaded lazily
 * via `import("movi-player/element/slim")`. Attributes mirror the package's
 * documented MoviPlayerAttributes map; anything not listed below still passes
 * through (React 19 sets unknown props as attributes on custom elements).
 */
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "movi-player": DetailedHTMLProps<
        HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        src?: string;
        poster?: string;
        controls?: boolean | "";
        autoplay?: boolean | "";
        muted?: boolean | "";
        playsinline?: boolean | "";
        preload?: "none" | "metadata" | "auto";
        volume?: number | string;
        playbackrate?: number | string;
        objectfit?: string;
        startat?: number | string;
        buffersize?: number | string;
        /** Engine priority, space-separated: wasm | shaka | dashjs | hlsjs | native */
        engine?: string;
        /** What to do with a source Movi can't play ("native" → <video>). */
        fallback?: string;
        /** URL of movi.wasm (slim build) — we host it from /public. */
        wasmurl?: string;
        /** Disable the element's built-in keyboard shortcuts (ours own keys). */
        nohotkeys?: boolean | "";
        /** Switch off individual built-in controls with no<name> tokens. */
        controlslist?: string;
      };
    }
  }
}
