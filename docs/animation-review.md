# Animation — Expert Review Needed

## Stack

- `@react-navigation/native-stack` (via Expo Router)
- `react-native-reanimated` 4.x (entering/exiting layout animations)
- Target: Android primarily, low-end devices must be smooth

## Navigation animations

Used `slide_from_right` → white flash on pop (native-stack issue). Currently using `fade` on all routes. Flicker is gone but the crossfade feels plain — no directionality.

## Content entrance (Reanimated entering/exiting)

All elements inside a ScrollView, each wrapped in `<Animated.View>` with staggered `entering`:

| Element | entering | delay | spring |
|---|---|---|---|
| Hero image | `FadeIn 500ms` | 0 | — |
| Back button | `FadeInDown 300ms` | +100ms | — |
| Thumbnail | `FadeInLeft 400ms` | +200ms | springify |
| Title block | `FadeInUp 400ms` | +300ms | springify |
| Body text | `FadeInUp 400ms` | +500ms | — |
| Actions | `FadeInUp 400ms` | +650ms | — |
| List rows | `FadeInUp 400ms` | +800ms | — |
| Carousel | `FadeInUp 400ms` | +950ms | — |

Exit: container `FadeOutDown 200ms`

## Problems

1. Animations feel basic — opacity + translate with fixed delays. Predictable, no character.
2. No micro-interactions — buttons only use `activeOpacity`, no scale-on-press or feedback.
3. No shared element — thumbnail from list doesn't animate into detail hero.
4. No hero parallax — scrolling has no cinematic feel.
5. Exit animation is a single container fade — no per-element exit stagger.
6. Tab transitions are instant — no animation between tabs.
7. Stagger delays are arbitrary — not tied to animation completion, so items overlap awkwardly.

## Questions

1. Navigation vs content layer — should we handle the entire transition in Reanimated and bypass native-stack's limited options? Or layer them (native-stack fade + content entrance)?

2. Shared element — how to animate a thumbnail from a FlatList card into the hero position on the detail page without a third-party library? The card and the detail are in different routes, so mounting context is different.

3. Micro-interactions — which single micro-interaction (scale-on-press? spring on appear? ripple?) gives the most premium feel per line of code for a detail page with Watch/Download buttons?

4. Stagger timing — what's the right strategy? Measure from previous animation's completion (sequential)? Use spring-based delays? Or let elements overlap organically?

5. Exit stagger — should exit mirror the entrance in reverse (last in, first out)? Or is a single container exit sufficient? How to handle ScrollView content that may be below the fold during exit?

6. Native-stack config — are there `cardStyleInterpolator` or `transitionSpec` options (or the JS stack) that would let us drive transitions with Reanimated instead of native fragment animations?

7. Tab animation — can we add a subtle crossfade or slide between tabs without rewriting the tab bar from scratch?

8. Low-end — which animation patterns (spring, opacity, translate, scale) are safest on $100 Android devices with poor GPUs? Are there known pitfalls with Reanimated entering/exiting on such devices?
