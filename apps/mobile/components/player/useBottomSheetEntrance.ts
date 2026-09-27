/**
 * useBottomSheetEntrance — shared open/close animation for the player's
 * bottom sheets.
 *
 * RN Modal animationType="slide" slides the ENTIRE modal content (black
 * backdrop + sheet) up from the bottom as one block. This hook decouples the
 * two, matching ServerPickerSheet: the sheet springs up from the bottom while
 * the backdrop only fades in. The Modal itself is animationType="none" and
 * stays mounted until the exit animation finishes, so closing fades/slides out
 * too (the parent's `visible` prop flips immediately, which would otherwise
 * kill the exit animation).
 *
 * Timing detail: the sheet is pre-positioned off-screen the moment `visible`
 * flips true, but the enter animation is started by a SECOND effect keyed on
 * `mounted` — i.e. after the Modal content has committed. Starting a
 * native-driven animation before any Animated node exists lets the spring run
 * JS-side first and desync from the later-attached node, stranding the sheet
 * mid-screen.
 */
import { useEffect, useRef, useState } from "react";
import { Animated, Dimensions } from "react-native";

/** Shared fade/slide-out duration (ms). Enter uses a spring for the sheet. */
const FADE_MS = 200;

export function useBottomSheetEntrance(visible: boolean) {
  const [mounted, setMounted] = useState(false);
  /** Bumped on every open — re-runs the enter effect even while `mounted` is
   *  already true (user re-opened while the exit animation was running). */
  const [enterTick, setEnterTick] = useState(0);
  const backdrop = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  /** Whether the sheet has ever been shown (skip exit anim on first mount). */
  const everShownRef = useRef(false);
  /** Monotonic run token — a stale exit completion must never hide the modal
   *  after the user re-opened it mid-animation. */
  const runRef = useRef(0);

  // `visible` flips → mount/unmount orchestration + pre-positioning.
  useEffect(() => {
    const run = ++runRef.current;

    if (visible) {
      everShownRef.current = true;
      const height = Dimensions.get("window").height;
      translateY.stopAnimation();
      backdrop.stopAnimation();
      translateY.setValue(height);
      backdrop.setValue(0);
      setMounted(true);
      setEnterTick((t) => t + 1);
      return;
    }

    if (!everShownRef.current) return;

    Animated.parallel([
      Animated.timing(translateY, {
        toValue: Dimensions.get("window").height,
        duration: FADE_MS,
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && run === runRef.current) {
        setMounted(false);
      }
    });
  }, [visible, translateY, backdrop]);

  // Enter — runs after the Modal content committed, so the native-driven
  // spring/fade start with their Animated nodes attached.
  useEffect(() => {
    if (!mounted) return;
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
      }),
      Animated.timing(backdrop, {
        toValue: 1,
        duration: FADE_MS,
        useNativeDriver: true,
      }),
    ]).start();
  }, [mounted, enterTick, translateY, backdrop]);

  return { mounted, backdrop, translateY };
}
