# Expert Consultation: Production-Grade UX Resilience for React Native App

## Problem Statement

The Filmsnaps mobile app (Expo SDK 55, React Native 0.83.6, Expo Router) suffers from two critical UX issues:

1. **Navigation crash — `GO_BACK` unhandled**: `router.back()` is called in 18+ screens without checking `router.canGoBack()`. When the user navigates directly to a deep link or the navigation stack has only one screen, `router.back()` throws `The action 'GO_BACK' was not handled by any navigator` and the UI freezes.

2. **UI freezes + double-tap**: The JS thread gets saturated (complex renders, heavy layout calculations, data fetching), causing tap-to-response latency of 2-5 seconds. During this window, users tap again, and both taps register once the JS thread unfreezes — causing duplicate navigations (e.g., the same movie opens twice).

## Current Architecture

- **Navigation**: Expo Router (file-based) with a single root layout + tab layout + modal screens
- **State**: React Query for server data, React state/context for local state
- **No click guards**: Buttons call `router.push()` / `router.back()` directly with no:
  - Loading/disabled state management
  - Debounce mechanism
  - Navigation guard or interlock
- **Back navigation**: ~35 raw `router.back()` calls, most without `canGoBack()` check

## Key Questions for Expert

### 1. Double-Tap / Click-Once Pattern

What is the industry-standard pattern for ensuring a button click fires exactly once in React Native?

Considerations:

- Navigation actions (push/replace) should be idempotent
- Async actions (download, API calls) should show loading state and disable the button
- The solution must survive JS thread starvation (taps queued during freeze)
- Must work across both `TouchableOpacity` and `Pressable`

Specific concerns:

- Should we use a navigation-level interlock (global "navigating" ref)? Or per-button loading states?
- How do we prevent React Native from enqueueing touch events during JS thread congestion?
- What's the right pattern for wrapping `router.push()` with a guard?

### 2. Back Navigation Safety

Is the correct pattern to ALWAYS guard `router.back()` with `canGoBack()`, falling back to `router.push("/")` or `router.dismissAll()`?

Specific concerns:

- When the user deep-links into a modal or detail screen, there's no back stack — `canGoBack()` returns false
- Should we build a custom `safeGoBack()` utility?
- Should the root layout provide a default back handler?

### 3. JS Thread Responsiveness

What patterns prevent the JS thread from freezing under heavy load?

Specific concerns:

- Complex screens (home page with 5+ carousels, hero, full-screen backdrop blurs) cause 2-5s JS thread blocking
- Touch events queue up during this freeze and batch-fire when thread unfreezes
- How to use `InteractionManager.runAfterInteractions()` effectively?
- Should we be using `react-native-reanimated` worklets for heavy animations to offload from JS thread?
- Is there an architecture pattern (skeleton → data → interaction-ready) that big apps use?

### 4. Button Component Design

What should a production-grade `Pressable` / `TouchableOpacity` wrapper look like?

Requirements:

- Click-once guarantee (debounce or disable until action completes)
- Loading spinner overlay when async
- Disabled visual state
- Respects reduced transparency accessibility setting
- Reset state on navigation focus / screen blur

### 5. Navigation Architecture

Should we move to a navigation-agnostic action layer (commands dispatched to a navigation service rather than calling `router` directly)?

This would allow:

- All navigation to go through a single interlock
- Back navigation to have a default fallback
- Deep link handling to be centralized

## Code Patterns Currently in Use

### Problematic: raw `router.back()` without guard

```tsx
// Found in 18+ files — crashes when no back stack exists
onPress={() => router.back()}
```

### Problematic: raw `router.push()` without debounce

```tsx
// User can tap 5x before first navigation completes → 5 pushes
onPress={() => router.push(`/movie/${id}`)}
```

### Partial fix used in some files

```tsx
// Only 2 files use this pattern
if (router.canGoBack()) router.back();
// No fallback when canGoBack is false
```

## What We Need

A **complete production-grade solution** covering:

1. A `SafePressable` component (or HOC) with built-in click-once semantics, loading state, and disabled state
2. A safe navigation utility function that handles back-stack edge cases
3. Navigation interlock to prevent duplicate route pushes
4. JS thread responsiveness patterns (InteractionManager, worklets, skeleton screens)
5. An audit checklist we can apply across all 30+ screens

Please provide:

- Exact code implementations
- Installation/import patterns
- Any required package additions
- Migration strategy (how to roll out across 30+ screens without breaking everything)
