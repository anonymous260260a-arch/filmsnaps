import React from 'react';
import Svg, { Defs, Filter, FeTurbulence, FeColorMatrix, Rect } from 'react-native-svg';
import type { StyleProp, ViewStyle } from 'react-native';

interface FilmGrainProps {
  opacity?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Barely-perceptible film grain texture overlay.
 *
 * Uses an SVG feTurbulence noise filter at low opacity.
 * This single element gives FilmSnaps a visual fingerprint —
 * the sense of projected film rather than a sterile digital screen.
 */
export function FilmGrain({ opacity = 0.04, style }: FilmGrainProps) {
  return (
    <Svg style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, style]} width="100%" height="100%">
      <Defs>
        <Filter id="grain">
          <FeTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves={4}
            stitchTiles="stitch"
          />
          <FeColorMatrix type="saturate" values="0" />
        </Filter>
      </Defs>
      <Rect width="100%" height="100%" filter="url(#grain)" opacity={opacity} />
    </Svg>
  );
}
