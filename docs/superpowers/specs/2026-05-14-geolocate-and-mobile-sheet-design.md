# Geolocation and Mobile Bottom Sheet — Design

Date: 2026-05-14
Status: Approved, ready for implementation plan
Scope: Frontend only (`apps/web/`). No backend changes.

## Goals

1. Let users place themselves on the map. On Explore (`/`), recenter and show a "you are here" dot. On Build (`/build`), use the user's location as the origin if none is set yet; otherwise just recenter.
2. On mobile, replace the fixed-height bottom panel with a draggable bottom sheet with three snap positions (peek / half / full), so users can reclaim map space the way they can in Google Maps.

Both features apply to both `/` (Explore) and `/build` (Builder).

## Non-goals

- Continuous location tracking (`watchPosition`).
- Persisting last-known location across sessions.
- Reverse geocoding ("you are near …").
- A desktop bottom-sheet treatment — desktop sidebar stays as-is above 768px.
- Background re-fetch of POIs based on the user's location.

## User-facing behavior

### Geolocation

- A small "locate me" control sits on the bottom-right of the map (custom MapLibre `IControl`), styled to match the existing map controls.
- On a user's first visit (per browser, tracked via `localStorage["detour.geo_prompted"]`), a small dismissable banner appears below the header offering to use their location. Two buttons: "Use my location" / "Not now". Either choice sets the flag and the banner does not return.
- On success:
  - **Explore**: recenter (`easeTo`, zoom 15, 800ms), render a "you are here" dot.
  - **Build**: if no origin yet and click phase is `set-origin`, set origin from coords (triggers area fetch) and recenter. If an origin already exists or phase is `set-destination` / `route-shown`, just recenter and drop a "you are here" dot — never overwrite the user's clicked origin. Out-of-range result never sets the origin.
  - On mobile, if the bottom sheet is at `full`, auto-collapse it to `peek` so the user can actually see the dot.
- "Out of range" = haversine distance from user's coords to `Config.coordinates` is greater than `Config.max_miles + 2`. In that case do not pan/zoom; show a brief inline notice ("You're not in Santa Fe — showing the city center") for ~4s. On Build, do not set origin.
- Permission denied / timeout / unavailable: show an inline notice; button stays visible but disabled until next page load on permission-denied.

### Mobile bottom sheet

- Active only when `window.matchMedia("(max-width: 768px)").matches`.
- Three snap positions:
  - `peek`: 80px tall — drag handle + one-line summary strip.
  - `half`: 45vh — current default; matches today's `max-height: 45vh`.
  - `full`: 90vh — header still visible above.
- Movement:
  - **Drag**: pointer-down on the handle or header strip, drag vertically. While dragging, the sheet follows the finger. On release, snap to nearest of the three; if release velocity > 0.5 px/ms, snap in the direction of motion.
  - **Tap**: tapping the handle (without crossing ~6px movement) cycles `peek → half → full → peek`.
- Default snap on each page load is `half`. No cross-page or cross-session memory.
- Peek summary content:
  - Explore: `"{N} places · {M} layers"` (e.g. `"234 places · 5 layers"`).
  - Build: short status — `"{mode} · {miles} mi"` plus verdict if a route is shown.
- Search bar on Explore stays pinned at the top, does not move with the sheet.
- Mode toggle on Build stays pinned to the top on mobile (existing `.app-mode-toggle-mobile`), does not move into the sheet.
- Geolocate control on the map repositions itself above the sheet using a CSS var (`--sheet-height`) that tracks current snap, so it remains tappable at all snap positions.

### Accessibility

- Handle has `role="button"`, `aria-label="Drag to resize panel, or tap to expand/collapse"`, `aria-expanded` reflecting whether snap is `full`.
- Keyboard: handle is focusable. `Enter`/`Space` cycles snaps; `Esc` collapses to `peek`.
- `prefers-reduced-motion: reduce` → snap is instant, no transition. Geolocate banner does not slide in.
- `touch-action: none` is set only on the handle/header strip so vertical scroll inside the sheet body still works at `full`.

## File layout

```
apps/web/src/
  hooks/
    useGeolocate.ts          (new)  geolocation request, validation, behavior dispatch
    useMediaQuery.ts         (new)  tiny matchMedia hook
  components/
    LocateControl.tsx        (new)  MapLibre IControl wrapper for the locate button
    GeolocatePrompt.tsx      (new)  first-visit banner
    BottomSheet.tsx          (new)  generic 3-snap-point sheet
    Map.tsx                  (edit) integrate LocateControl + useGeolocate ("set-origin-if-empty")
    explore/
      ExploreMap.tsx         (edit) integrate LocateControl + useGeolocate ("recenter")
  pages/
    ExplorePage.tsx          (edit) wrap mobile panel content in <BottomSheet>
    (Builder)                (handled in Map.tsx where the sidebar is rendered)
  styles/
    global.css               (edit) bottom-sheet styles + mobile breakpoint changes
```

## Component design

### `useGeolocate(config)`

Signature:

```ts
interface GeolocateConfig {
  centerCoords: [number, number]; // from Config.coordinates
  maxMiles: number;               // Config.max_miles
}

interface UseGeolocateResult {
  state: "idle" | "requesting" | "ok" | "denied" | "unavailable" | "out-of-range";
  coords: [number, number] | null;
  error: string | null;
  request: () => void;
}

function useGeolocate(config: GeolocateConfig): UseGeolocateResult;
```

Behavior:

- `request()` calls `navigator.geolocation.getCurrentPosition` with `{ enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }`.
- Ignores re-entrant `request()` calls while `state === "requesting"`.
- On success: haversine-checks distance to `centerCoords`. If `dist > maxMiles + 2`, sets `state = "out-of-range"`, still sets `coords`. Otherwise `state = "ok"`.
- The hook is purely a state machine — it does **not** call `easeTo` or set origin. The consuming component (`ExploreMap` / `Map`) holds a `useEffect` keyed on `(state, coords)` and runs its own side effects: `recenter` for Explore, `set-origin-if-empty` for Build. The "recenter" vs "set-origin-if-empty" split lives at the call site, not in the hook.

### `LocateControl`

A MapLibre `IControl` implementation:

```ts
class LocateControl implements maplibregl.IControl {
  constructor(opts: { onClick: () => void; state: UseGeolocateResult["state"] });
  onAdd(map: maplibregl.Map): HTMLElement;
  onRemove(): void;
  // re-rendered when state changes (spinner during "requesting", disabled on "denied")
}
```

Rendered button: 40×40, warm-cream background, terracotta icon, sits at `bottom-right` of the map. CSS positions it `bottom: calc(var(--sheet-height, 0px) + 12px)` on mobile so it floats above the sheet.

### `GeolocatePrompt`

```tsx
<GeolocatePrompt onAccept={() => request()} onDismiss={() => {}} />
```

- Renders nothing if `!navigator.geolocation`, if `localStorage["detour.geo_prompted"] === "1"`, or before 500ms after mount.
- Position: `absolute`, top of map area, below header. Warm-cream background, two buttons.
- Sets `localStorage["detour.geo_prompted"] = "1"` on either action.

### `BottomSheet`

```tsx
<BottomSheet
  initialSnap="half"
  peekSummary={<span>{n} places · {m} layers</span>}
  onSnapChange={(snap) => setSheetSnap(snap)}  // optional, used by parent to inform geolocate offset
>
  {children}
</BottomSheet>
```

Internal state: `{ snap: "peek" | "half" | "full", dragOffset: number, dragging: boolean }`.

Implementation notes:

- Snap heights are CSS custom properties: `--sheet-peek: 80px`, `--sheet-half: 45dvh`, `--sheet-full: 90dvh` (fallback `vh`).
- During drag, transform writes go directly to the DOM via a ref inside `requestAnimationFrame` — React state is not updated per frame.
- On `pointerup`, compute target snap from current offset + velocity, set `transition: transform 220ms cubic-bezier(.2,.8,.2,1)`, commit `snap` to state.
- `pointercancel` commits to current snap.
- Exposes the current sheet height via a CSS variable on the outer container (`--sheet-height`) so the geolocate control can offset against it.
- Recomputes snap target px values on `window.resize` (debounced 100ms).
- When `useMediaQuery("(max-width: 768px)")` is `false`, returns `<>{children}</>` directly — desktop renders unchanged.

### `useMediaQuery(query)`

Minimal hook: subscribes to `matchMedia(query)`, returns boolean, cleans up on unmount.

## Data flow

### Geolocation, Explore

```
User taps locate button (or banner "Use my location")
  → LocateControl.onClick / GeolocatePrompt.onAccept
  → useGeolocate.request()
  → navigator.geolocation.getCurrentPosition
  → state = "ok" | "out-of-range" | "denied" | "unavailable"
  → ExploreMap effect on (state, coords):
       "ok"            → easeTo + render "you-are-here" layer + collapse sheet to peek if at full
       "out-of-range"  → render "you-are-here" layer + show inline notice
       "denied"        → show inline notice; LocateControl renders disabled
       "unavailable"   → show inline notice
```

### Geolocation, Build

```
User taps locate button (or banner accept)
  → useGeolocate.request() (behavior: "set-origin-if-empty")
  → on "ok":
       if click phase === "set-origin" and origin is null → set origin from coords
                                                          → triggers /api/area
                                                          → phase advances to "set-destination"
       else → just easeTo + render "you-are-here" layer
       in either case: collapse sheet to peek if at full
  → on "out-of-range": never set origin; easeTo unchanged; notice shown
```

## Styling

CSS additions in `global.css`:

- Bottom sheet (only inside `@media (max-width: 768px)`):
  - Container: `position: absolute; left: 0; right: 0; bottom: 0;` replacing the current `.app-sidebar` mobile override for these pages.
  - Handle strip: 24px tall, centered 36×4 pill, terracotta-tinted.
  - Header strip (handle + peek summary): non-scrolling, `touch-action: none`.
  - Body: scrollable inside the sheet, `touch-action: pan-y`.
  - Snap transition: `transition: transform 220ms cubic-bezier(.2,.8,.2,1)`. While `dragging`, transition is `none`.
- Geolocate control: `position: absolute; right: 12px; bottom: calc(var(--sheet-height, 12px) + 12px);`.
- "You are here" dot layer: terracotta (`#C45B28`) inner, warm-cream halo, ~10px / 20px radii.
- Geolocate banner: warm-cream background, top of map area, sliding-in only when `!prefers-reduced-motion`.

## Edge cases

| Scenario | Behavior |
|---|---|
| Geolocate while sheet at `full` | After success, auto-collapse to `peek` so the dot is visible. |
| Re-entrant `request()` | Ignored while `state === "requesting"`. Button shows spinner. |
| Cached coords (`maximumAge`) | Treated as a normal success; no double-flight. |
| `pointercancel` during drag | Sheet commits to current snap. |
| Orientation / resize | Snap targets recomputed on `window.resize` (debounced 100ms). |
| iOS address-bar shrink | Use `dvh` where available, fall back to `vh`. Minor acceptable jitter. |
| Build, origin already set | Geolocate only recenters, never overwrites origin. |
| Out-of-range on Build | Never sets origin. Recenter is skipped; notice shown. |
| `setPointerCapture` fails (iOS quirk) | Fall back to tracking `pointermove` on `window`. |

## Testing

- **Vitest unit tests, `useGeolocate`**: stub `navigator.geolocation`, assert state transitions for success, denied, timeout, unavailable; assert haversine `out-of-range`; assert behavior-mode dispatch is the caller's responsibility (hook itself is pure state).
- **Vitest unit tests, `BottomSheet`**: mock `matchMedia` to mobile, simulate `pointerdown` / `pointermove` / `pointerup`, assert snap target after various velocity scenarios. Verify keyboard handlers (`Enter`/`Space`/`Esc`).
- **Manual smoke test (required)** on real iOS Safari and Chrome Android: drag through snaps, tap-cycle, geolocate (allow + deny + outside-Santa-Fe simulated via DevTools), banner first-visit + dismiss persistence, orientation change while at each snap.
- No backend tests — no API changes.

## Risks

- **iOS Safari pointer events.** Known historical quirks with `setPointerCapture` on `<div>`. Mitigation: fall back to `window`-level `pointermove`/`pointerup`.
- **Layout-shift on banner mount.** Banner is `position: absolute`; should not reflow map. Verify on manual smoke test.
- **Free-tier ORS load.** Geolocate-to-origin on Build triggers `/api/area` exactly as a click would; same rate-limited path covered in `docs/LAUNCH_READINESS.md`. No new risk.
- **Privacy.** User coords stay in the browser unless they become the `origin` query parameter on Build's `/api/area` / `/api/route` calls — same surface area as a click-set origin today.

## Open questions

None at time of writing. Implementation plan should:

1. Confirm the locate-button icon (use an inline SVG; do not add an icon library).
2. Confirm the peek-summary copy for Build (currently `"{mode} · {miles} mi"` + verdict if present); minor copy decisions can be made during implementation.
