# Bug Fix Sprint — Paste into fresh Claude Sonnet 4.6 session

Fix these 4 high-priority bugs identified in a code review. Each is scoped to specific files. Fix them one at a time, verify each works, then move to the next.

## Bug 1: URL state mode default is asymmetric

**Files:** `apps/web/src/lib/urlState.ts`, `apps/web/src/components/Map.tsx`

**Problem:** `parseShareableRouteState()` defaults to `"walk"` when mode param is absent, but `replaceShareableRouteState()` only writes mode when it's `"drive"`. This means:
- A URL with no mode param opens in walk mode
- Walk mode URLs never get a mode param written
- Drive mode URLs get `&mode=drive` but then if you remove it, it flips to walk

**Fix:** Make both sides symmetric. The app default is walk mode. Always write mode to the URL regardless of value. Parse with `"walk"` as default. Make sure this matches the actual app default in Map.tsx initial state.

## Bug 2: Shared URLs with detour=1 don't restore selected stops

**Files:** `apps/web/src/lib/urlState.ts`, `apps/web/src/components/Map.tsx`

**Problem:** The URL writes `detour=1` as a boolean flag but never serializes which stops were selected or their coordinates. So a "shared detour URL" can't actually restore the detour route.

**Fix:** Serialize selected stop coordinates in the URL. Suggested approach:
- Add a `via` param that encodes selected stop coordinates: `&via=-105.93,35.68;-105.94,35.69`
- On restore, match via coordinates against fetched nearby stops to reselect them
- If a via coordinate doesn't match any fetched stop, use it as a raw waypoint
- Drop the `detour=1` boolean — the presence of `via` params implies detour

## Bug 3: Race conditions on reset/mode/category changes

**Files:** `apps/web/src/components/Map.tsx`, `apps/web/src/hooks/useRouteCheck.ts`, `apps/web/src/hooks/useServiceArea.ts`

**Problem:** Only detour requests use `detourRequestRef` for staleness checking. The baseline route fetch (`checkRoute`), service area fetch, and stop suggestion fetch have no cancellation. Rapid mode switching, category changes, or reset during a flight request can paint stale results.

**Fix:** Add `AbortController` to all async fetches:
- `useRouteCheck`: accept an AbortSignal, pass to fetch, abort on new request or reset
- `useServiceArea`: same pattern — abort previous fetch when origin/mode changes
- Stop suggestion fetches in Map.tsx: abort previous when category changes or reset happens
- On reset: abort all in-flight requests immediately

The pattern for each hook/fetch:
```typescript
const controllerRef = useRef<AbortController | null>(null);

// Before each fetch:
controllerRef.current?.abort();
controllerRef.current = new AbortController();
const signal = controllerRef.current.signal;

// Pass signal to fetch:
fetch(url, { signal })

// In cleanup/reset:
controllerRef.current?.abort();
```

Don't forget to handle `AbortError` — catch it silently (it's expected, not an error).

## Bug 4: Walk mode shows "No driving route" + other copy errors

**Files:** `apps/web/src/components/VerdictPanel.tsx`, `apps/web/src/components/Map.tsx`

**Problem:**
- Route error message says "No driving route found" even in walk mode (VerdictPanel.tsx:89 area)
- Landing sidebar copy says "Explore Santa Fe on foot" regardless of mode (Map.tsx:987 area)
- Stop suggestion failures silently log to console and show as "no stops nearby" instead of indicating an error

**Fix:**
- Make error messages mode-aware: "No walking route found" vs "No driving route found"
- Make landing copy mode-aware: "on foot" for walk, "by car" for drive
- Add a visible error/retry state for stop suggestion failures (not just console.error)

The VerdictPanel and Map components both receive `mode` as a prop or from state — use it in the copy strings.

---

## General guidance

- Read each file before editing
- Run `npm run build` in `apps/web/` after each fix to verify no type errors
- Run `npm run lint` in `apps/web/` — it currently fails on a react-hooks warning in useServiceArea.ts; fix that if you encounter it
- Run `cd apps/api && python -m pytest` to verify backend tests still pass
- Don't refactor beyond what's needed for each fix. Don't split components, don't add new abstractions.
