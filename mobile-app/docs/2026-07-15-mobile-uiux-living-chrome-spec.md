# Mobile UI/UX — "Living chrome, quiet canvas" (build spec)

_2026-07-15. Derived from a 6-lens audit (visual, motion, IA, states, a11y, code-health; 57 findings)
converged into one coherent, feasibility-vetted plan._

## Design direction

The first "vivid pass" is a **thin top-band veneer**: living colour, depth, and a real token system
exist only in the four top-level tab headers. Every drill-in, list, form, modal, and populated grid
collapses to a flat, tokenless, shadowless generic-dark-app, and half the design system
(`typography`/`space`/`radius`/`grad.favorite`) is dead code that never reaches a screen.

**The single direction: make the _entire_ app continuously crafted and alive** — vivid, glowing,
breathing chrome at **every depth** (drill-in headers, buttons, empty/loading/hero/error states, the
tab bar, toasts) — while **photos always sit on neutral cells and behind neutral faked scrims**.
Nothing photo-facing gets colour; everything chrome-facing gets the living wash, a soft accent glow,
buttery native-driven motion, and one coherent hand-drawn icon language.

Three moves, in order:
1. **Make `theme.ts` the real, consumed source of truth** (typography/space/radius/glow/inset tokens
   spread into every style; all rgba literals routed through `tint()`), and consolidate the
   4×-duplicated button/field/chip/header/empty-state into **named primitives** so consistency is
   structural, not manual.
2. **Close the two headline gaps** — every mutating action must confirm (a **Toast/Undo** backbone),
   and every zero/loading/error state must be crafted (**EmptyState + Skeleton**). Today favoriting
   and deleting land with literally nothing.
3. **Layer the "alive" delight** — FLIP zoom-from-cell into the viewer, staggered grid entrance,
   heart-pop, rolling counters, deepened `LivingGradient`, parallax/collapse header — all pure
   `Animated` transform/opacity on the native driver.

**Accessibility & fake-safe-area are substrate, not polish:** `Springy` forwards a11y props, motion
respects Reduce Motion (vivid colour stays, drift stops), and one `useInsets()` heuristic replaces the
scattered magic numbers. The maximalist aesthetic survives Reduce Motion as static vivid colour.

## Hard constraints (any violation = invalid)

Pure React-Native `Animated` only. **No new native modules** — reanimated, gesture-handler,
expo-linear-gradient, expo-blur, expo-haptics, icon libraries, safe-area-context, react-navigation are
all **banned** (would force a native rebuild). Native driver animates transform/opacity only; layout/
color/width are JS-driven and used sparingly. Must stay `tsc --noEmit` clean (Expo SDK 57 / RN 0.86 /
React 19.2). Faked gradients = stacked translucent Views; hand-drawn icons = plain Views.

## Shared primitives (Wave 1 — the enforced substrate)

| Primitive | File | Purpose |
|---|---|---|
| `assetUri`, `COLS`, `CELL`, `formatDateTime` | `src/media.ts` (new leaf) | one geometry/uri/date module; breaks the ui↔PhotoDetail cycle + doubled `assetUri` |
| tokens + `glow()` + `inset` | `src/theme.ts` | consume typography/space/radius; coloured-shadow depth; one inset fallback |
| `useInsets()` | `src/insets.ts` (new) | responsive fake safe-area (notch/Island/iPad/landscape) |
| `Icon` | `src/Icon.tsx` (new) | one hand-drawn View icon set (search/info/close/chevron/heart/heartFill/spark/check) |
| `Springy`+a11y, `useReducedMotion()` | `src/motion.tsx` | forward a11y props; hold motion static under Reduce Motion |
| `GradientButton` | `src/motion.tsx` | THE signature button: faked-gradient fill + glow + press + auto-contrast + busy |
| `Reveal` | `src/motion.tsx` | fade/settle instead of hard-cut (chrome, info panel, action bar) |
| `RollingNumber` | `src/motion.tsx` | slide tabular-num counters instead of snapping |
| `HeartPop` | `src/motion.tsx` | favorite payoff: scale 1→1.35→1 + expanding ring |
| `Shimmer`/`Skeleton` | `src/motion.tsx` + `src/ui.tsx` | loading cells breathe instead of dead squares |
| `Scrim`, `ViewerChrome` | `src/motion.tsx` + `src/ViewerChrome.tsx` (new) | faked vertical gradient scrims for legible viewer bars |
| `SelectionRing` | `src/ui.tsx` | affirmative accent ring + check disc (not an opacity fade) |
| `useGridEntrance()` | `src/motion.tsx` + `src/ui.tsx` | recycle-safe staggered grid entrance |
| `ScreenHeader` + `back`/`scrollY` | `src/Header.tsx` | drill-in back affordance + parallax/collapse, same living wash |
| `EmptyState` | `src/ui.tsx` | one crafted zero/hero look (orb + glyph + title + subtitle + action) |
| `SearchField`, `Chip`, `Segmented` | `src/fields.tsx` (new) | one accent-driven input/pill/scope (fixes cyan drift) |
| `Toast`/`ToastHost` | `src/Toast.tsx` (new) | every mutation confirms; favorite carries UNDO, delete confirm-only |
| `AppText` | `src/AppText.tsx` (new) | default `maxFontSizeMultiplier` (React 19 removed `Text.defaultProps`) |
| `MediaViewer`/`ZoomModal` | `src/PhotoDetail.tsx` generalized | FLIP zoom-from-cell; one viewer for local + desktop |
| `MemoriesCarousel` | `src/Memories.tsx` (new) + replica helpers | the missing "For You" lead surface |

## Waves

1. **Substrate** — all shared-file edits (theme/motion/ui/Header) land here; afterward those 4 files
   are frozen and later waves touch disjoint screen files + new leaf modules.
2. **Feedback & shell** (`App.tsx`) — mount `ToastHost`; toast on favorite (with undo) / delete;
   `useInsets`; craft permission/error/first-load with EmptyState + Skeleton; pull-to-refresh.
3. **The viewer** — `PhotoDetail`→`MediaViewer`: FLIP zoom-open, faded scrims, `Reveal` chrome,
   `RollingNumber` counter, `HeartPop`, `Icon`s, single-photo Delete/Share, full a11y; DesktopDetail
   adopts the same viewer (paging + zoom + counter) and renders the discarded desktop metadata.
4. **Per-screen craft** (parallelizable, disjoint files) — Library (animated select bar, live counts,
   select-all), Albums (gradient drill headers, real device albums, shimmer covers), Search (cyan
   identity via SearchField/Chip, pending flag, scope, recent queries), Desktop (SearchField, error
   surfacing, desktop albums), Duplicates (gradient header, toast, SelectionRing), TabBar (Icon set,
   active fill+glow+scale-pop, per-tab hue legend, a11y roles).
5. **IA & delight** (new leaf files) — MemoriesCarousel as Library header (On This Day / Recent
   favorites), first-run CoachCard, opt-in DateScrubber, cross-surface "recognize people" bridge.

## Rejected (native-dep or layout-jank) → pure-Animated alternative

- **blur** → `Scrim` stacked ramping-alpha Views; `tint()`-over-surface for bars.
- **haptics** → `Springy` + `HeartPop` + `RollingNumber` visual/kinetic confirmation.
- **linear-gradient** → faked stacked translucent Views (`LivingGradient`, `GradientButton`).
- **reanimated/gesture-handler shared-element + swipe-dismiss** → `ZoomModal` FLIP via
  `measureInWindow` + `Animated.spring`; keep native pinch-zoom ScrollView + tap-to-close.
- **icon library** → hand-drawn `Icon.tsx`.
- **safe-area-context** → `useInsets()` heuristic.
- **Videos album / mixed media** → images only (ingest is `MediaType.IMAGE`; no player dep).
- **full mediaSubtype scan** → iOS smart albums via `Album.get('Screenshots'/'Selfies')`.
- **animating header height** → transform scale + opacity + parallax translateY only.

## Data gaps (noted, not blocking)

Per-photo location/EXIF isn't in expo-media-library `AssetInfo` (local viewer shows dims/date/fav
only; richer metadata comes from the desktop oracle's `analyzeDesktop().meta`, currently fetched then
discarded). No canonical camera-roll↔desktop `asset_uid` join yet (cross-surface recognize-people is a
filename+date heuristic, gated on `connected`). `SemanticSearch` exposes no in-flight flag (Search
tracks a local `pending`). `getLibrary()` currently reduces desktop collections to a count. Recent
searches + coach dismissal need new tiny replica rows.
