# Animation Investigation & Code Reference

> Internal technical document. App name, branding, and purpose intentionally omitted.

---

## 1. Environment / Stack

| Concern | Library |
|---|---|
| Navigation | `expo-router` (`Stack` from `expo-router`) |
| Screen transitions | Native Stack navigator |
| In-component animation | `react-native-reanimated` (v?) |
| Styling | `nativewind` (Tailwind classes) + inline `StyleSheet` objects |
| Data | `@tanstack/react-query` (persisted to disk) |
| Language | TypeScript / React Native |

Reanimated is wired in `babel.config.js`:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxRuntime: 'automatic' }],
      'nativewind/babel',
    ],
    plugins: ['react-native-reanimated/plugin'],
  };
};
```

---

## 2. Navigator Configuration (`app/_layout.tsx`)

```tsx
import { Stack } from 'expo-router';

<Stack
  detachInactiveScreens={false}
  screenOptions={{
    headerShown: false,
    contentStyle: { backgroundColor: '#080808' },
  }}
>
  <Stack.Screen name="(tabs)" options={{ contentStyle: { backgroundColor: '#080808' } }} />

  {/* Detail screens — animation disabled so content mounts instantly */}
  <Stack.Screen
    name="item/[id]"
    options={{ headerShown: false, animationEnabled: false, contentStyle: { backgroundColor: '#080808' } }}
  />
  <Stack.Screen
    name="show/[id]"
    options={{ headerShown: false, animationEnabled: false, contentStyle: { backgroundColor: '#080808' } }}
  />

  <Stack.Screen
    name="play/[...id]"
    options={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: '#000' } }}
  />
  <Stack.Screen
    name="save/[...id]"
    options={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: '#000' } }}
  />
</Stack>
```

Notes:
- Detail push was previously `animation: 'slide_from_right'` (the JS-driven stacked animation). Changed to `animationEnabled: false` to remove the transition entirely.
- `detachInactiveScreens={false}` added to prevent react-native-screens from freezing a pushed screen's JS thread.

---

## 3. The Detail Screen Entrance Animation (CURRENT STATE)

Both `app/item/[id].tsx` and `app/show/[id].tsx` use a custom mount-driven helper instead of Reanimated's `entering` prop.

### Helper

```tsx
import React from 'react';
import Animated, {
  FadeInUp, FadeOutDown,
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing,
} from 'react-native-reanimated';

/**
 * Mount-driven fade-in. Starts the moment the component mounts (JS thread),
 * so it never waits on layout measurement or the scroll content pass.
 */
function FadeInOnMount({ delay = 0, duration = 300, y = 12, style, children }: any) {
  const progress = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * y }],
  }));

  React.useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, { duration, easing: Easing.out(Easing.quad) }),
    );
  }, []);

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
```

### Usage (staggered cascade)

Every content block is wrapped:

```tsx
{/* Backdrop */}
<FadeInOnMount delay={0} duration={200} style={{ width: SCREEN_WIDTH, height: BACKDROP_HEIGHT }}>
  ...
</FadeInOnMount>

{/* Back button (absolute) */}
<FadeInOnMount delay={40} duration={400} style={{ position: 'absolute', top: insets.top + 12, left: 16, zIndex: 10 }}>
  ...
</FadeInOnMount>

{/* Poster */}
<FadeInOnMount delay={80} duration={400}> ... </FadeInOnMount>

{/* Info column */}
<FadeInOnMount delay={120} duration={400} className="flex-1 ml-3 justify-end pb-1"> ... </FadeInOnMount>

{/* Overview */}
<FadeInOnMount delay={160} duration={400} className="mt-6"> ... </FadeInOnMount>

{/* Action buttons */}
<FadeInOnMount delay={200} duration={400} className="flex-row mt-6" style={{ gap: 10 }}> ... </FadeInOnMount>

{/* Cast */}
<FadeInOnMount delay={200} duration={400} className="mt-8"> ... </FadeInOnMount>

{/* Similar */}
<FadeInOnMount delay={200} duration={400} className="mt-6"> ... </FadeInOnMount>
```

### Outer wrapper (exit only)

```tsx
<Animated.View
  exiting={FadeOutDown.duration(150)}
  className="flex-1 bg-void"
  style={{ backgroundColor: '#080808' }}
>
  <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
    {/* ... FadeInOnMount blocks ... */}
  </ScrollView>
</Animated.View>
```

### Loading state (spinner shown while fetching)

```tsx
if (isLoading) {
  return (
    <View className="flex-1 items-center justify-center bg-void" style={{ backgroundColor: '#080808' }}>
      <ActivityIndicator size="large" color="#e8a020" />
    </View>
  );
}
```

---

## 4. Action Buttons (current, restored to plain TouchableOpacity)

```tsx
<View className="flex-row mt-6" style={{ gap: 10 }}>
  {/* Play — primary gold CTA */}
  <TouchableOpacity
    onPress={() => router.push(`/play/item/${id}`)}
    activeOpacity={0.9}
    style={{
      flex: 1,
      backgroundColor: '#e8a020',
      borderRadius: 10,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      ...Platform.select({
        ios: { shadowColor: '#e8a020', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
        android: { elevation: 6 },
      }),
    }}
  >
    <Ionicons name="play" size={18} color="#080808" style={{ marginRight: 8 }} />
    <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#080808' }}>Play</Text>
  </TouchableOpacity>

  {/* Save — secondary with subtle border */}
  <TouchableOpacity
    onPress={() => router.push(`/save/item/${id}`)}
    activeOpacity={0.8}
    style={{
      backgroundColor: 'transparent',
      borderWidth: 0.5,
      borderColor: '#252525',
      borderRadius: 10,
      paddingVertical: 14,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <Ionicons name="bookmark-outline" size={18} color="#5b9cf6" style={{ marginRight: 6 }} />
    <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#5b9cf6' }}>Save</Text>
  </TouchableOpacity>
</View>
```

A previous `ScalePressButton` wrapper (Reanimated `Pressable` + `useSharedValue` scale) was removed because it collapsed to zero width — `Pressable` defaults to `flex: 0` and the animated style dropped the `flex: 1` passed in.

---

## 5. Navigation Trigger (from tabs)

```tsx
const handleItemPress = useCallback((item: Item) => {
  const kind = item.kind || 'item';
  const id = item.id;
  if (kind === 'show') {
    queryClient.prefetchQuery({ queryKey: ['show', id], queryFn: () => tmdbApi.getShowDetails(id), staleTime: 1000 * 60 * 60 });
    router.prefetch(`/show/${id}`);
    router.push(`/show/${id}`);
  } else {
    queryClient.prefetchQuery({ queryKey: ['item', id], queryFn: () => tmdbApi.getItemDetails(id), staleTime: 1000 * 60 * 60 });
    router.prefetch(`/item/${id}`);
    router.push(`/item/${id}`);
  }
}, [router, queryClient]);
```

`prefetch` is fire-and-forget; `router.push` is called immediately. No `await`, no `setTimeout` gating navigation.

---

## 6. Data Layer (react-query)

`hooks/useDetails.ts`:

```ts
export function useItemDetails(id: number | string) {
  return useQuery({
    queryKey: ['item', id],
    queryFn: () => tmdbApi.getItemDetails(id),
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60,
  });
}
// useShowDetails identical pattern
```

Root `QueryClient` defaults: `staleTime: 5min`, `gcTime: 30min`, `retry: 2`, `refetchOnWindowFocus: false`.

Cache is also hydrated from disk on cold launch (`lib/queryCache.ts` → `hydrateQueryClient` / `startPersistLoop`).

**Implication:** For already-visited items the data is present synchronously, so `isLoading === false` on first render — the ~1s delay is NOT a data fetch.

---

## 7. Symptom Reported

- Tap a card → tab/route change is instant.
- Then a **~1 second pause** with no visible change.
- Then the staggered fade-in cascade plays.
- Same behavior for **already-cached** items (so not network).
- `animationEnabled: false` on the push did **not** remove the pause.
- Replacing `entering` prop with mount-driven `FadeInOnMount` (`useEffect` + `withTiming`) did **not** remove the pause.
- Therefore the ~1s occurs *before* the content component's mount effects / first committed frame become visible.

---

## 8. Things Already Ruled Out

| Hypothesis | Status |
|---|---|
| Navigator `slide_from_right` transition | Disabled via `animationEnabled: false` — no change |
| `entering` prop lag inside `ScrollView` | Replaced with mount-driven `useEffect` fade — no change |
| Network fetch on cached data | Cache is 1h staleTime + disk hydrate — not the cause |
| `ScalePressButton` width collapse | Fixed/removed — unrelated to delay |
| `react-native-screens` freeze | `detachInactiveScreens={false}` added — no change |
| `setTimeout` gating navigation | Only used in pull-to-refresh, not navigation |

---

## 9. Open Questions for Expert

1. What in the RN/expo render pipeline would hold a freshly-pushed screen's **first committed frame** invisible for ~1s even with `animationEnabled: false` and cached data?
2. Is there a global font-load / layout-thrash / first-reanimated-worklet-init cost that gates the first animation on a screen?
3. Does `expo-router`'s `Stack` defer mounting the pushed route's React tree until some post-commit pass?
4. Could `nativewind` class resolution or `useWindowDimensions`/`useSafeAreaInsets` cause a forced re-layout that delays the visible frame?
5. Recommended pattern for guaranteed-instant entrance animations on detail screens pushed from a tab.
