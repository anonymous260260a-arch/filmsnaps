/**
 * Hook that wraps the navigation service into a convenient API.
 *
 * Usage:
 *   const nav = useSafeNavigation();
 *   <Pressable onPress={() => nav.push(`/movie/${id}`)} />
 *   <Pressable onPress={nav.goBack} />
 */

import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import type { Href } from "expo-router";
import {
  safePush,
  safeReplace,
  resetNavigationInterlock,
} from "./navigation-service";
import { safeGoBack, type SafeGoBackOptions } from "./safe-go-back";

/**
 * Drop-in replacement for `useRouter()` that returns guarded methods.
 *
 * Resets the navigation interlock every time the screen gains focus,
 * preventing a stale lock from a previous screen from blocking navigation.
 */
export function useSafeNavigation() {
  // Reset the interlock every time this screen gains focus.
  useFocusEffect(
    useCallback(() => {
      resetNavigationInterlock();
    }, []),
  );

  const push = useCallback((href: Href) => safePush(href), []);
  const replace = useCallback((href: Href) => safeReplace(href), []);
  const goBack = useCallback(
    (opts?: SafeGoBackOptions) => safeGoBack(opts),
    [],
  );

  return { push, replace, goBack } as const;
}
