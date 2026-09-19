/**
 * Android two-step back guard with a calm floating toast: the first back
 * press shows "Press back again to exit player"; a second press within 3s
 * closes the player. The event is always consumed on the first press.
 */
import { useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Platform } from "react-native";
import { safeGoBack } from "../lib/navigation";

export function useDoubleBackExit() {
  const lastBackPressRef = useRef(0);
  const [showToast, setShowToast] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const onBackPress = () => {
      const now = Date.now();
      if (now - lastBackPressRef.current < 3000) {
        // Two back presses within 3s — close player
        safeGoBack({ fallback: "/(tabs)" });
        return true;
      }
      lastBackPressRef.current = now;

      // Trigger subtle back toast
      setShowToast(true);
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();

      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => {
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }).start(() => setShowToast(false));
      }, 2400);

      return true; // consume the event on first press
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => {
      sub.remove();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
    // safeGoBack is a module fn; re-running this effect would clear the
    // pending toast-hide timer the moment setShowToast(true) re-renders.
  }, [toastOpacity]);

  return { showToast, toastOpacity };
}
