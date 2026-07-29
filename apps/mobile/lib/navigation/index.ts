/**
 * Navigation — barrel export
 */
export {
  safePush,
  safeReplace,
  resetNavigationInterlock,
  __getInterlockState,
} from "./navigation-service";
export { safeGoBack, type SafeGoBackOptions } from "./safe-go-back";
export { useSafeNavigation } from "./use-safe-navigation";
