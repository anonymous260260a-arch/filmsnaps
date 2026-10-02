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
        /** Target prefetch window in MB (HTTP + encrypted sources). */
        buffersize?: number | string;
        /** Stall sound+picture together (default on) — "false" unbinds them so
         *  the picture keeps presenting through an audio rebuffer. */
        bindav?: boolean | "false" | "";
        /** Engine priority, space-separated: wasm | shaka | dashjs | hlsjs | native */
        engine?: string;
        /** What to do with a source Movi can't play ("native" → <video>). */
        fallback?: string;
        /** URL of movi.wasm (slim build) — we host it from /public. */
        wasmurl?: string;
        /** Turn the element's own control bar on/off. */
        controls?: boolean | "";
        /** UI theme. */
        theme?: "dark" | "light";
        /** One or two CSS colours, space-separated: primary then optional secondary. */
        themecolor?: string;
        /** Show the in-player title bar overlay. */
        showtitle?: boolean | "";
        /** Title text for that bar — the element strips the attribute so no
         *  native browser tooltip appears on hover. */
        title?: string;
        /** Disable the element's built-in keyboard shortcuts (ours own keys). */
        nohotkeys?: boolean | "";
        /** Switch off individual built-in controls with no<name> tokens. */
        controlslist?: string;
      };
    }
  }
}
