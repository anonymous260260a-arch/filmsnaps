/**
 * FilmSnaps Typography System — Single Source of Truth
 *
 * Re-exports the existing typography styles from lib/typography.ts,
 * providing a centralized import path for all components.
 *
 * This file exists as the semantic counterpart to theme/colors.ts,
 * so components import from theme/* for everything visual.
 */

export { typography } from "../lib/typography";
export type { TextStyle } from "react-native";
