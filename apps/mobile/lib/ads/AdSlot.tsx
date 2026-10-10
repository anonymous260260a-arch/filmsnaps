import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { getMovieAdsView, MovieAds } from "../../modules/movie-ads";
import { getAnonId } from "../telemetry/anonId";
import { trackAdImpression, type AdSlotName } from "../telemetry";
import { getAdsConfig, subscribeAdsConfig } from "./adsConfig";
import { adTagForSlot, shouldShowAdSlot } from "./gating";

/**
 * AdSlot — one native Start.io placement, fully remote-gated.
 *
 * Renders NOTHING (not even reserved space) while:
 *  - the binary has no native ads module (old installs after OTA),
 *  - ads-config.json has the global kill off / this slot disabled,
 *  - the install is outside the rollout bucket or has no anonId yet,
 *  - the network returns no fill (collapsed after onMovieAdsFailed).
 *
 * Telemetry contract:
 *  - ad_slot_view (measurement) is owned by useSlotImpression at the call
 *    sites and keeps flowing regardless of this component's state.
 *  - ad_impression (real SDK outcome) is emitted here on loaded/failed.
 */
export function AdSlot({
  slot,
  bottomMargin = 0,
}: {
  slot: AdSlotName;
  /** Applied only while the creative is visible (collapsed slot = no space). */
  bottomMargin?: number;
}) {
  const config = useSyncExternalStore(subscribeAdsConfig, getAdsConfig);
  const anonId = getAnonId();
  const NativeView = useMemo(() => getMovieAdsView(), []);

  const slotCfg = config.slots[slot];
  const allowed =
    shouldShowAdSlot(config, slot, anonId) && !!NativeView && !!slotCfg;

  // Collapse until the creative actually arrives (no blank reserved box).
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!allowed) setLoaded(false);
  }, [allowed]);

  if (!allowed || !slotCfg) return null;

  const format = slotCfg.format;
  // Reserved sizes (dp): banner 320x50, mrec 300x250, cover 300x157.
  // NOTE: the native view MUST get explicit Yoga bounds — RN does not size
  // native views from their Android children, so without this it's 0×0 and
  // the Start.io creative renders invisibly.
  const size =
    format === "mrec"
      ? { width: 300, height: 250 }
      : format === "cover"
        ? { width: 300, height: 157 }
        : { width: 320, height: 50 };

  return (
    <View
      style={{
        height: loaded ? size.height : 0,
        marginBottom: loaded ? bottomMargin : 0,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <NativeView
        format={format}
        adTag={adTagForSlot(slot)}
        onMovieAdsLoaded={() => {
          setLoaded(true);
          trackAdImpression({
            slot,
            network: "startio",
            format,
            outcome: "filled",
            test: config.testMode,
          });
        }}
        onMovieAdsFailed={() => {
          setLoaded(false);
          trackAdImpression({
            slot,
            network: "startio",
            format,
            outcome: "no_fill",
            test: config.testMode,
          });
        }}
        onMovieAdsImpression={() => {
          // IAB viewable-impression callback from Start.io. No extra event:
          // "filled" above is our impression-of-record; this is a hook for
          // tierB visibility work later.
        }}
        onMovieAdsClicked={() => {
          // Intentionally untracked: clicks are not our revenue model and
          // per-slot click telemetry has no product use yet.
        }}
        style={{ ...size, opacity: loaded ? 1 : 0 }}
      />
    </View>
  );
}

/** True when the binary itself can show ads (native module present). */
export const ADS_NATIVE_AVAILABLE = MovieAds !== null;
