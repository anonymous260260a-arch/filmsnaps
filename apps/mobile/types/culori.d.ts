/**
 * Minimal culori typings for the accent pipeline (the installed culori build
 * ships no declarations). Only the functions movieAccent uses are declared.
 */
declare module "culori" {
  export interface CuloriColor {
    mode: string;
    /** OKLab L (0..1) — always present on parsed colors. */
    l: number;
    /** OKLCH chroma. */
    c?: number;
    /** OKLCH hue in degrees; undefined for pure greys. */
    h?: number;
    r?: number;
    g?: number;
    b?: number;
    alpha?: number;
    [key: string]: unknown;
  }

  /** Parse any CSS color into its OKLCH representation (undefined when unparsable). */
  export function oklch(color: string | CuloriColor): CuloriColor | undefined;

  /**
   * Shrink chroma to the largest in-gamut value for the color's L/H
   * (sRGB gamut clamp). Returns undefined for out-of-gamut input it
   * cannot clamp.
   */
  export function clampChroma(
    color: string | CuloriColor,
    mode?: string,
  ): CuloriColor | undefined;

  /** Serialize to #rrggbb (undefined when out of sRGB gamut). */
  export function formatHex(color: string | CuloriColor): string | undefined;

  /** Serialize to rgb(r g b) / rgb(r g b / a) (undefined when out of gamut). */
  export function formatRgb(color: string | CuloriColor): string | undefined;
}
