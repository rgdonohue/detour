# Geolocation + Mobile Bottom Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "locate me" feature on both pages and convert the mobile bottom panel into a draggable three-snap-point sheet (Google-Maps-style).

**Architecture:** Pure-logic helpers (haversine distance, geolocate state machine, snap-target math) live in `apps/web/src/lib/` and are unit-tested with Vitest. Hooks and components are thin glue around those helpers and are verified by manual smoke testing on real mobile browsers. No backend changes. No new runtime dependencies. Vitest added as the only new devDep.

**Tech Stack:** React 19, TypeScript, Vite 7, MapLibre GL JS 5, Vitest (new), browser `navigator.geolocation`, pointer events, CSS transforms.

**Reference spec:** `docs/superpowers/specs/2026-05-14-geolocate-and-mobile-sheet-design.md`

---

## File structure

**New files:**

```
apps/web/src/
  lib/
    geo.ts                 (new)  haversineMiles + computeGeolocateState pure helpers
    bottomSheet.ts         (new)  computeTargetSnap pure helper
    youAreHereLayer.ts     (new)  setYouAreHereLayer(map, coords|null) imperative helper
  hooks/
    useGeolocate.ts        (new)  thin glue around navigator.geolocation
    useMediaQuery.ts       (new)  matchMedia subscription hook
  components/
    LocateControl.tsx      (new)  MapLibre IControl wrapper, custom button
    GeolocatePrompt.tsx    (new)  first-visit dismissable banner
    BottomSheet.tsx        (new)  three-snap-point draggable sheet (mobile only)

apps/web/src/lib/__tests__/
  geo.test.ts              (new)
  bottomSheet.test.ts      (new)
```

**Modified files:**

```
apps/web/package.json                          add vitest devDep + "test" script
apps/web/vite.config.ts                        add Vitest test config block
apps/web/src/components/Map.tsx                wire LocateControl + useGeolocate (Builder)
apps/web/src/components/explore/ExploreMap.tsx wire LocateControl + useGeolocate (Explore)
apps/web/src/pages/ExplorePage.tsx             wrap mobile panel in <BottomSheet>, render <GeolocatePrompt>
apps/web/src/App.tsx                           render <GeolocatePrompt> on /build (BuilderPage)
apps/web/src/styles/global.css                 bottom-sheet styles + locate-control offset
```

---

## Task 1: Add Vitest

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/vite.config.ts`

No tests needed for this task. It exists to make later TDD tasks possible.

- [ ] **Step 1: Install Vitest**

Run from `apps/web/`:

```bash
npm install --save-dev vitest@^2.1.0
```

- [ ] **Step 2: Add a `test` script to `apps/web/package.json`**

Insert into the `"scripts"` object (after `"preview"`):

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Add Vitest config block to `apps/web/vite.config.ts`**

Replace the file contents with:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
        },
      },
    },
  },
  test: {
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
})
```

We use `environment: 'node'` because every test in this plan is pure logic — no DOM is needed.

- [ ] **Step 4: Verify Vitest runs with zero tests**

Run:

```bash
cd apps/web && npm run test
```

Expected: exits with `No test files found` and a zero exit status (or `1` if Vitest treats no-files as a failure — that is acceptable; the next task adds a test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/vite.config.ts
git commit -m "Add Vitest for pure-logic unit tests in apps/web"
```

---

## Task 2: `haversineMiles` helper

**Files:**
- Create: `apps/web/src/lib/geo.ts`
- Create: `apps/web/src/lib/__tests__/geo.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/__tests__/geo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { haversineMiles } from "../geo";

describe("haversineMiles", () => {
  it("returns 0 for identical coords", () => {
    const p: [number, number] = [-105.9384, 35.6824];
    expect(haversineMiles(p, p)).toBe(0);
  });

  it("returns ~1 mile for two nearby Santa Fe points", () => {
    const a: [number, number] = [-105.9384, 35.6824];
    const b: [number, number] = [-105.9384, 35.6969]; // ~1 mile north
    expect(haversineMiles(a, b)).toBeGreaterThan(0.9);
    expect(haversineMiles(a, b)).toBeLessThan(1.1);
  });

  it("returns >1000 miles between Santa Fe and NYC", () => {
    const sf: [number, number] = [-105.9384, 35.6824];
    const nyc: [number, number] = [-74.0060, 40.7128];
    expect(haversineMiles(sf, nyc)).toBeGreaterThan(1500);
    expect(haversineMiles(sf, nyc)).toBeLessThan(2000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && npm run test -- geo
```

Expected: FAIL — `Failed to resolve import "../geo"`.

- [ ] **Step 3: Implement `haversineMiles`**

`apps/web/src/lib/geo.ts`:

```ts
const EARTH_RADIUS_MILES = 3958.7613;

/** Great-circle distance between two [lon, lat] points, in miles. */
export function haversineMiles(
  a: [number, number],
  b: [number, number],
): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const lat1r = toRad(lat1);
  const lat2r = toRad(lat2);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1r) * Math.cos(lat2r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web && npm run test -- geo
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/geo.ts apps/web/src/lib/__tests__/geo.test.ts
git commit -m "Add haversineMiles helper with Vitest coverage"
```

---

## Task 3: `computeGeolocateState` pure transition

This is the state machine that powers `useGeolocate`. Extracting it as a pure function makes the hook trivial and testable without DOM/jsdom.

**Files:**
- Modify: `apps/web/src/lib/geo.ts`
- Modify: `apps/web/src/lib/__tests__/geo.test.ts`

- [ ] **Step 1: Write the failing tests** (append to existing test file)

Append to `apps/web/src/lib/__tests__/geo.test.ts`:

```ts
import { computeGeolocateState } from "../geo";

describe("computeGeolocateState", () => {
  const config = { centerCoords: [-105.9384, 35.6824] as [number, number], maxMiles: 5 };

  it("returns ok when within range", () => {
    const result = computeGeolocateState({ kind: "success", coords: [-105.9384, 35.6969] }, config);
    expect(result.state).toBe("ok");
    expect(result.coords).toEqual([-105.9384, 35.6969]);
  });

  it("returns out-of-range when beyond maxMiles + 2", () => {
    const result = computeGeolocateState({ kind: "success", coords: [-74.0060, 40.7128] }, config);
    expect(result.state).toBe("out-of-range");
    expect(result.coords).toEqual([-74.0060, 40.7128]);
  });

  it("returns ok when within the +2 buffer", () => {
    // 6 miles north of center, with maxMiles=5 buffer is 7. 6 < 7 => ok.
    const result = computeGeolocateState(
      { kind: "success", coords: [-105.9384, 35.6824 + 6 / 69.0] },
      config,
    );
    expect(result.state).toBe("ok");
  });

  it("returns denied for permission error", () => {
    const result = computeGeolocateState({ kind: "error", code: 1 }, config);
    expect(result.state).toBe("denied");
    expect(result.coords).toBeNull();
  });

  it("returns unavailable for position-unavailable error", () => {
    const result = computeGeolocateState({ kind: "error", code: 2 }, config);
    expect(result.state).toBe("unavailable");
  });

  it("returns unavailable for timeout error", () => {
    const result = computeGeolocateState({ kind: "error", code: 3 }, config);
    expect(result.state).toBe("unavailable");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npm run test -- geo
```

Expected: 6 new FAILures — `computeGeolocateState` is not defined.

- [ ] **Step 3: Implement `computeGeolocateState`**

Append to `apps/web/src/lib/geo.ts`:

```ts
export type GeolocateState =
  | "idle"
  | "requesting"
  | "ok"
  | "denied"
  | "unavailable"
  | "out-of-range";

export interface GeolocateConfig {
  centerCoords: [number, number];
  maxMiles: number;
}

export type GeolocateInput =
  | { kind: "success"; coords: [number, number] }
  | { kind: "error"; code: 1 | 2 | 3 }; // 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT

export interface GeolocateResult {
  state: GeolocateState;
  coords: [number, number] | null;
}

const OUT_OF_RANGE_BUFFER_MILES = 2;

export function computeGeolocateState(
  input: GeolocateInput,
  config: GeolocateConfig,
): GeolocateResult {
  if (input.kind === "error") {
    if (input.code === 1) return { state: "denied", coords: null };
    return { state: "unavailable", coords: null };
  }
  const dist = haversineMiles(input.coords, config.centerCoords);
  if (dist > config.maxMiles + OUT_OF_RANGE_BUFFER_MILES) {
    return { state: "out-of-range", coords: input.coords };
  }
  return { state: "ok", coords: input.coords };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npm run test -- geo
```

Expected: 9 tests pass (3 from Task 2 + 6 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/geo.ts apps/web/src/lib/__tests__/geo.test.ts
git commit -m "Add computeGeolocateState pure transition with tests"
```

---

## Task 4: `useGeolocate` hook

Thin glue around `navigator.geolocation` that uses `computeGeolocateState`. No tests — pure-logic is already covered by Task 3.

**Files:**
- Create: `apps/web/src/hooks/useGeolocate.ts`

- [ ] **Step 1: Implement the hook**

```ts
import { useCallback, useRef, useState } from "react";
import {
  computeGeolocateState,
  type GeolocateConfig,
  type GeolocateState,
} from "../lib/geo";

export interface UseGeolocateResult {
  state: GeolocateState;
  coords: [number, number] | null;
  request: () => void;
}

export function useGeolocate(config: GeolocateConfig): UseGeolocateResult {
  const [state, setState] = useState<GeolocateState>("idle");
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const inFlightRef = useRef(false);
  const configRef = useRef(config);
  configRef.current = config;

  const request = useCallback(() => {
    if (inFlightRef.current) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      return;
    }
    inFlightRef.current = true;
    setState("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        inFlightRef.current = false;
        const result = computeGeolocateState(
          { kind: "success", coords: [pos.coords.longitude, pos.coords.latitude] },
          configRef.current,
        );
        setState(result.state);
        setCoords(result.coords);
      },
      (err) => {
        inFlightRef.current = false;
        const code = (err.code === 1 || err.code === 2 || err.code === 3
          ? err.code
          : 2) as 1 | 2 | 3;
        const result = computeGeolocateState(
          { kind: "error", code },
          configRef.current,
        );
        setState(result.state);
        setCoords(null);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }, []);

  return { state, coords, request };
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web && npx tsc -b
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useGeolocate.ts
git commit -m "Add useGeolocate hook (glue around navigator.geolocation)"
```

---

## Task 5: `useMediaQuery` hook

**Files:**
- Create: `apps/web/src/hooks/useMediaQuery.ts`

- [ ] **Step 1: Implement the hook**

```ts
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web && npx tsc -b
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useMediaQuery.ts
git commit -m "Add useMediaQuery hook"
```

---

## Task 6: `setYouAreHereLayer` map helper

A small imperative helper that adds/updates/removes the "you are here" source+layer on a MapLibre map. Shared by both ExploreMap and Builder Map.

**Files:**
- Create: `apps/web/src/lib/youAreHereLayer.ts`

- [ ] **Step 1: Implement the helper**

```ts
import maplibregl from "maplibre-gl";

const SOURCE_ID = "you-are-here";
const LAYER_ID = "you-are-here-dot";
const HALO_LAYER_ID = "you-are-here-halo";

/**
 * Adds, updates, or removes the "you are here" pulse dot on a MapLibre map.
 * Pass null coords to remove. Safe to call repeatedly.
 */
export function setYouAreHereLayer(
  map: maplibregl.Map,
  coords: [number, number] | null,
): void {
  if (!coords) {
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getLayer(HALO_LAYER_ID)) map.removeLayer(HALO_LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    return;
  }

  const feature: GeoJSON.Feature<GeoJSON.Point> = {
    type: "Feature",
    geometry: { type: "Point", coordinates: coords },
    properties: {},
  };

  const existing = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(feature);
    return;
  }

  map.addSource(SOURCE_ID, { type: "geojson", data: feature });
  map.addLayer({
    id: HALO_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": 14,
      "circle-color": "#C45B28",
      "circle-opacity": 0.18,
    },
  });
  map.addLayer({
    id: LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": 6,
      "circle-color": "#C45B28",
      "circle-stroke-color": "#FAF7F2",
      "circle-stroke-width": 2,
    },
  });
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web && npx tsc -b
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/youAreHereLayer.ts
git commit -m "Add setYouAreHereLayer map helper"
```

---

## Task 7: `LocateControl` MapLibre IControl

**Files:**
- Create: `apps/web/src/components/LocateControl.tsx`

The control is implemented as a class so it can be `map.addControl()`-ed. A small React wrapper lets us re-render when state changes.

- [ ] **Step 1: Implement the class**

```tsx
import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { GeolocateState } from "../lib/geo";

const ICON_SVG = `
<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9" />
  <circle cx="12" cy="12" r="2" />
  <line x1="12" y1="1" x2="12" y2="4" />
  <line x1="12" y1="20" x2="12" y2="23" />
  <line x1="1" y1="12" x2="4" y2="12" />
  <line x1="20" y1="12" x2="23" y2="12" />
</svg>`;

const SPINNER_SVG = `
<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" class="locate-control__spinner">
  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
</svg>`;

class LocateControlImpl implements maplibregl.IControl {
  private container: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;

  constructor(
    private onClick: () => void,
    private getState: () => GeolocateState,
  ) {}

  onAdd(): HTMLElement {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group locate-control";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "locate-control__btn";
    button.setAttribute("aria-label", "Show my location");
    button.addEventListener("click", () => this.onClick());
    this.button = button;
    this.container.appendChild(button);
    this.render();
    return this.container;
  }

  onRemove(): void {
    this.container?.parentNode?.removeChild(this.container);
    this.container = null;
    this.button = null;
  }

  /** Called by the React wrapper after state changes to refresh the button UI. */
  render(): void {
    if (!this.button) return;
    const state = this.getState();
    this.button.innerHTML = state === "requesting" ? SPINNER_SVG : ICON_SVG;
    this.button.disabled = state === "denied";
    this.button.classList.toggle("locate-control__btn--active", state === "ok");
  }
}

interface LocateControlProps {
  map: maplibregl.Map | null;
  state: GeolocateState;
  onClick: () => void;
}

export function LocateControl({ map, state, onClick }: LocateControlProps) {
  const controlRef = useRef<LocateControlImpl | null>(null);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Add/remove the control on map change
  useEffect(() => {
    if (!map) return;
    const control = new LocateControlImpl(
      () => onClickRef.current(),
      () => stateRef.current,
    );
    controlRef.current = control;
    map.addControl(control, "bottom-right");
    return () => {
      map.removeControl(control);
      controlRef.current = null;
    };
  }, [map]);

  // Re-render the button DOM when state changes
  useEffect(() => {
    controlRef.current?.render();
  }, [state]);

  return null;
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web && npx tsc -b
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/LocateControl.tsx
git commit -m "Add LocateControl MapLibre IControl wrapper"
```

---

## Task 8: `GeolocatePrompt` first-visit banner

**Files:**
- Create: `apps/web/src/components/GeolocatePrompt.tsx`

- [ ] **Step 1: Implement the banner**

```tsx
import { useEffect, useState } from "react";

const FLAG_KEY = "detour.geo_prompted";

interface GeolocatePromptProps {
  onAccept: () => void;
}

function readFlag(): boolean {
  try {
    return localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return true; // localStorage blocked — don't show
  }
}

function writeFlag(): void {
  try {
    localStorage.setItem(FLAG_KEY, "1");
  } catch {
    // ignore
  }
}

export function GeolocatePrompt({ onAccept }: GeolocatePromptProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    if (readFlag()) return;
    const t = setTimeout(() => setVisible(true), 500);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    writeFlag();
    setVisible(false);
  };

  const accept = () => {
    writeFlag();
    setVisible(false);
    onAccept();
  };

  return (
    <div className="geolocate-prompt" role="dialog" aria-label="Use your location?">
      <span className="geolocate-prompt__text">Use your location to center the map?</span>
      <div className="geolocate-prompt__actions">
        <button type="button" className="geolocate-prompt__btn" onClick={accept}>
          Use my location
        </button>
        <button
          type="button"
          className="geolocate-prompt__btn geolocate-prompt__btn--secondary"
          onClick={dismiss}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web && npx tsc -b
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/GeolocatePrompt.tsx
git commit -m "Add GeolocatePrompt first-visit banner"
```

---

## Task 9: Wire geolocate into ExploreMap

**Files:**
- Modify: `apps/web/src/components/explore/ExploreMap.tsx`
- Modify: `apps/web/src/pages/ExplorePage.tsx`

ExploreMap doesn't currently call `getConfig()` — the explore page is decoupled from Builder's config. We'll fetch config inside ExploreMap (or accept it as a prop). Simplest: fetch inside ExploreMap on mount, same shape as Map.tsx does.

- [ ] **Step 1: Add config fetch + geolocate wiring inside `ExploreMap`**

In `apps/web/src/components/explore/ExploreMap.tsx`, after the existing `getConfig` import line, add imports:

```tsx
import { useGeolocate } from "../../hooks/useGeolocate";
import { LocateControl } from "../LocateControl";
import { setYouAreHereLayer } from "../../lib/youAreHereLayer";
import type { Config } from "../../lib/api";
```

Inside the `ExploreMap` component body (after `containerRef`/`mapRef` declarations and before the existing `useEffect` that builds the map), add:

```tsx
const [config, setConfig] = useState<Config | null>(null);
useEffect(() => {
  let cancelled = false;
  getConfig().then((c) => { if (!cancelled) setConfig(c); }).catch(() => {});
  return () => { cancelled = true; };
}, []);

const geo = useGeolocate({
  centerCoords: config?.coordinates ?? [-105.9384, 35.6824],
  maxMiles: config?.max_miles ?? 5,
});

// React to geolocate state changes
const [geoNotice, setGeoNotice] = useState<string | null>(null);
useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  if (geo.state === "ok" && geo.coords) {
    map.easeTo({ center: geo.coords, zoom: 15, duration: 800 });
    setYouAreHereLayer(map, geo.coords);
    setGeoNotice(null);
  } else if (geo.state === "out-of-range" && geo.coords) {
    setYouAreHereLayer(map, geo.coords);
    setGeoNotice("You're not in Santa Fe — showing the city center.");
  } else if (geo.state === "denied") {
    setGeoNotice("Location permission denied. Enable it in your browser settings.");
  } else if (geo.state === "unavailable") {
    setGeoNotice("Couldn't get your location.");
  }
}, [geo.state, geo.coords]);

// Auto-clear notice after 4s
useEffect(() => {
  if (!geoNotice) return;
  const t = setTimeout(() => setGeoNotice(null), 4000);
  return () => clearTimeout(t);
}, [geoNotice]);
```

At the bottom of the `ExploreMap` component's return, after the existing `<div ref={containerRef} ... />`, render the LocateControl and notice:

```tsx
return (
  <>
    <div ref={containerRef} className="map-container" />
    <LocateControl map={mapRef.current} state={geo.state} onClick={geo.request} />
    {geoNotice && <div className="geo-notice">{geoNotice}</div>}
  </>
);
```

(Adjust the existing return statement; if it currently returns just the div, wrap with a fragment.)

Expose `geo.request` and `geo.state` to the parent via the existing focus-ref pattern. Add a new ref prop:

```tsx
interface ExploreMapProps {
  // ...existing props...
  geolocateRef?: { current: () => void };
}
```

Inside the component, wire it:

```tsx
useEffect(() => {
  if (geolocateRef) geolocateRef.current = geo.request;
}, [geolocateRef, geo.request]);
```

- [ ] **Step 2: Render `<GeolocatePrompt>` in ExplorePage**

In `apps/web/src/pages/ExplorePage.tsx`:

Add import:

```tsx
import { GeolocatePrompt } from "../components/GeolocatePrompt";
```

Add a ref inside `ExplorePage`:

```tsx
const geolocateRef = useRef<() => void>(() => {});
```

Pass `geolocateRef` to `<ExploreMap>` and render the prompt inside `.map-wrapper`:

```tsx
<ExploreMap
  activeCategories={activeCategories}
  onPoiSelect={setSelectedPoi}
  pois={pois}
  focusPoiRef={focusPoiRef}
  geolocateRef={geolocateRef}
/>
<GeolocatePrompt onAccept={() => geolocateRef.current()} />
```

- [ ] **Step 3: Type-check**

```bash
cd apps/web && npx tsc -b
```

Expected: no errors.

- [ ] **Step 4: Manual smoke test**

```bash
cd apps/web && npm run dev
```

Then open `http://localhost:5173/` and:
- First visit: banner appears after ~500ms.
- Click "Use my location" → browser permission prompt → on accept, map recenters and a terracotta dot appears at your location. Banner disappears.
- Refresh page: banner does NOT reappear.
- Click locate button (bottom-right of map) → recenter + dot.
- In DevTools, simulate a far-away location (e.g. NYC) → notice appears: "You're not in Santa Fe — showing the city center."; map does NOT pan; dot is rendered but off-screen.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/explore/ExploreMap.tsx apps/web/src/pages/ExplorePage.tsx
git commit -m "Wire geolocate into Explore (locate button + first-visit banner)"
```

---

## Task 10: Wire geolocate into Builder Map

**Files:**
- Modify: `apps/web/src/components/Map.tsx`
- Modify: `apps/web/src/App.tsx`

The Builder Map already fetches config. Behavior here is `set-origin-if-empty`.

- [ ] **Step 1: Add imports + hook in `Map.tsx`**

In `apps/web/src/components/Map.tsx`, add imports:

```tsx
import { useGeolocate } from "../hooks/useGeolocate";
import { LocateControl } from "./LocateControl";
import { setYouAreHereLayer } from "../lib/youAreHereLayer";
```

Inside the `Map` component, after `config` is declared, add:

```tsx
const geo = useGeolocate({
  centerCoords: config?.coordinates ?? FALLBACK_CONFIG.coordinates,
  maxMiles: config?.max_miles ?? FALLBACK_CONFIG.max_miles,
});
const [geoNotice, setGeoNotice] = useState<string | null>(null);
```

- [ ] **Step 2: Add the geolocate effect**

After the other effects in `Map.tsx`:

```tsx
useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  if (geo.state === "ok" && geo.coords) {
    setYouAreHereLayer(map, geo.coords);
    if (clickPhase === "set-origin" && !origin) {
      setOrigin(geo.coords);
      setClickPhase("set-destination");
    }
    map.easeTo({ center: geo.coords, zoom: 15, duration: 800 });
    setGeoNotice(null);
  } else if (geo.state === "out-of-range" && geo.coords) {
    setYouAreHereLayer(map, geo.coords);
    setGeoNotice("You're not in Santa Fe — showing the city center.");
  } else if (geo.state === "denied") {
    setGeoNotice("Location permission denied. Enable it in your browser settings.");
  } else if (geo.state === "unavailable") {
    setGeoNotice("Couldn't get your location.");
  }
}, [geo.state, geo.coords, clickPhase, origin]);

useEffect(() => {
  if (!geoNotice) return;
  const t = setTimeout(() => setGeoNotice(null), 4000);
  return () => clearTimeout(t);
}, [geoNotice]);
```

- [ ] **Step 3: Render the LocateControl + notice**

Find the existing `<div ref={containerRef} ... />` in the Map render output and add the control + notice next to it (likely wrap in a fragment if needed):

```tsx
<LocateControl map={mapRef.current} state={geo.state} onClick={geo.request} />
{geoNotice && <div className="geo-notice">{geoNotice}</div>}
```

- [ ] **Step 4: Add a geolocate ref prop to expose `geo.request` to the BuilderPage**

In `apps/web/src/components/Map.tsx`, extend `MapProps`:

```tsx
interface MapProps {
  resetRef?: { current: () => void };
  modeChangeRef?: { current: (mode: TravelMode) => void };
  geolocateRef?: { current: () => void };
  mode: TravelMode;
  onModeChange: (mode: TravelMode) => void;
}
```

Inside `Map`:

```tsx
useEffect(() => {
  if (geolocateRef) geolocateRef.current = geo.request;
}, [geolocateRef, geo.request]);
```

- [ ] **Step 5: Render `<GeolocatePrompt>` in `BuilderPage`**

In `apps/web/src/App.tsx`:

Add import:

```tsx
import { GeolocatePrompt } from "./components/GeolocatePrompt";
```

Inside `BuilderPage`, add a ref:

```tsx
const geolocateRef = useRef<() => void>(() => {});
```

Pass it to `<Map>` and render the prompt:

```tsx
<Map
  resetRef={resetRef}
  modeChangeRef={modeChangeRef}
  geolocateRef={geolocateRef}
  mode={mode}
  onModeChange={setMode}
/>
```

After `<AppFooter />` is rendered (or inside `app-map-wrapper`), render:

```tsx
<GeolocatePrompt onAccept={() => geolocateRef.current()} />
```

(Position-wise the banner is `absolute` and will overlay the map regardless of DOM placement, but rendering it inside `.app-map-wrapper` is conventional.)

- [ ] **Step 6: Type-check**

```bash
cd apps/web && npx tsc -b
```

Expected: no errors.

- [ ] **Step 7: Manual smoke test**

Visit `http://localhost:5173/build`:
- Permission already granted from Task 9 smoke — geolocate button works. Click it before clicking the map → origin is set from your location, area polygon fetches, click phase advances to "set-destination". A terracotta dot marks the user's location.
- Click the locate button again → just recenters; does NOT overwrite the origin.
- Reset (existing reset button) → click locate → origin again set from location.
- Simulate NYC in DevTools → notice appears; origin is NOT set.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/Map.tsx apps/web/src/App.tsx
git commit -m "Wire geolocate into Builder (sets origin if empty, otherwise recenters)"
```

---

## Task 11: `computeTargetSnap` pure helper

The pure math that decides which snap point the sheet should settle on after a drag.

**Files:**
- Create: `apps/web/src/lib/bottomSheet.ts`
- Create: `apps/web/src/lib/__tests__/bottomSheet.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/__tests__/bottomSheet.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeTargetSnap, nextSnapCycle, type SnapName } from "../bottomSheet";

const snapPx = { peek: 80, half: 360, full: 720 } as const;

describe("computeTargetSnap", () => {
  it("snaps to exact snap heights when velocity is low", () => {
    expect(computeTargetSnap(80, 0, snapPx)).toBe<SnapName>("peek");
    expect(computeTargetSnap(360, 0, snapPx)).toBe<SnapName>("half");
    expect(computeTargetSnap(720, 0, snapPx)).toBe<SnapName>("full");
  });

  it("snaps to nearest when velocity is low and height is between snaps", () => {
    expect(computeTargetSnap(150, 0, snapPx)).toBe<SnapName>("peek"); // d=70 vs d=210
    expect(computeTargetSnap(260, 0, snapPx)).toBe<SnapName>("half"); // d=100 vs d=180
    expect(computeTargetSnap(600, 0, snapPx)).toBe<SnapName>("full"); // d=120 vs d=240
  });

  it("snaps down (peek) when release velocity is downward and above threshold", () => {
    expect(computeTargetSnap(400, 1.0, snapPx)).toBe<SnapName>("peek");
    expect(computeTargetSnap(400, 0.6, snapPx)).toBe<SnapName>("peek");
  });

  it("snaps up (full) when release velocity is upward and above threshold", () => {
    expect(computeTargetSnap(400, -1.0, snapPx)).toBe<SnapName>("full");
    expect(computeTargetSnap(400, -0.6, snapPx)).toBe<SnapName>("full");
  });

  it("uses distance when velocity is below threshold", () => {
    expect(computeTargetSnap(150, 0.3, snapPx)).toBe<SnapName>("peek");
    expect(computeTargetSnap(600, -0.3, snapPx)).toBe<SnapName>("full");
  });
});

describe("nextSnapCycle", () => {
  it("cycles peek -> half -> full -> peek", () => {
    expect(nextSnapCycle("peek")).toBe<SnapName>("half");
    expect(nextSnapCycle("half")).toBe<SnapName>("full");
    expect(nextSnapCycle("full")).toBe<SnapName>("peek");
  });
});
```

The test heights are deliberately picked so that no two snap distances are equal — the tie-resolution rule in the implementation is documented but never tested (and not user-visible).

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npm run test -- bottomSheet
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

`apps/web/src/lib/bottomSheet.ts`:

```ts
export type SnapName = "peek" | "half" | "full";

export interface SnapHeightsPx {
  peek: number;
  half: number;
  full: number;
}

const VELOCITY_THRESHOLD_PX_MS = 0.5;

/**
 * Given the current sheet height in px, the release velocity in px/ms
 * (positive = sheet shrinking, negative = sheet growing), and the configured
 * snap heights in px, return the snap target.
 *
 * Tie-resolution (rarely hit in practice): when two snaps are equidistant, the
 * larger snap wins (i.e. expand rather than shrink on a tie).
 */
export function computeTargetSnap(
  heightPx: number,
  velocityPxMs: number,
  snapPx: SnapHeightsPx,
): SnapName {
  if (velocityPxMs > VELOCITY_THRESHOLD_PX_MS) return "peek";
  if (velocityPxMs < -VELOCITY_THRESHOLD_PX_MS) return "full";

  const dPeek = Math.abs(heightPx - snapPx.peek);
  const dHalf = Math.abs(heightPx - snapPx.half);
  const dFull = Math.abs(heightPx - snapPx.full);

  // Prefer larger snap on ties: check full first, then half, then peek
  let best: SnapName = "full";
  let bestD = dFull;
  if (dHalf < bestD) { best = "half"; bestD = dHalf; }
  if (dPeek < bestD) { best = "peek"; bestD = dPeek; }
  return best;
}

export function nextSnapCycle(current: SnapName): SnapName {
  if (current === "peek") return "half";
  if (current === "half") return "full";
  return "peek";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npm run test -- bottomSheet
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/bottomSheet.ts apps/web/src/lib/__tests__/bottomSheet.test.ts
git commit -m "Add computeTargetSnap pure helper with tests"
```

---

## Task 12: `BottomSheet` component

**Files:**
- Create: `apps/web/src/components/BottomSheet.tsx`

- [ ] **Step 1: Implement the component**

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  computeTargetSnap,
  nextSnapCycle,
  type SnapName,
} from "../lib/bottomSheet";
import { useMediaQuery } from "../hooks/useMediaQuery";

interface BottomSheetProps {
  initialSnap?: SnapName;
  peekSummary?: ReactNode;
  onSnapChange?: (snap: SnapName) => void;
  /** Imperative ref to control the sheet from a parent. */
  controlRef?: { current: { setSnap: (snap: SnapName) => void } | null };
  children: ReactNode;
}

const SNAP_VH = { peek: 0, half: 45, full: 90 } as const; // peek uses px below
const PEEK_PX = 80;
const DRAG_THRESHOLD_PX = 6;
const TRANSITION_MS = 220;

function getSnapPx(snap: SnapName): number {
  if (snap === "peek") return PEEK_PX;
  const vh = SNAP_VH[snap];
  return (window.innerHeight * vh) / 100;
}

export function BottomSheet({
  initialSnap = "half",
  peekSummary,
  onSnapChange,
  controlRef,
  children,
}: BottomSheetProps) {
  const isMobile = useMediaQuery("(max-width: 768px)");

  const [snap, setSnap] = useState<SnapName>(initialSnap);
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const lastYRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const currentHeightRef = useRef(0);

  // Expose imperative setSnap to parents via controlRef
  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = {
      setSnap: (s) => {
        setSnap(s);
      },
    };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef]);

  // Apply snap height to DOM whenever snap changes (idle state)
  useEffect(() => {
    if (!isMobile) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const h = getSnapPx(snap);
    currentHeightRef.current = h;
    sheet.style.transition = `transform ${TRANSITION_MS}ms cubic-bezier(.2,.8,.2,1)`;
    sheet.style.transform = `translateY(calc(100% - ${h}px))`;
    sheet.style.setProperty("--sheet-height", `${h}px`);
    document.documentElement.style.setProperty("--sheet-height", `${h}px`);
    if (onSnapChange) onSnapChange(snap);
  }, [snap, isMobile, onSnapChange]);

  // Recompute snap heights on viewport resize
  useEffect(() => {
    if (!isMobile) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const sheet = sheetRef.current;
        if (!sheet) return;
        const h = getSnapPx(snap);
        currentHeightRef.current = h;
        sheet.style.transform = `translateY(calc(100% - ${h}px))`;
        sheet.style.setProperty("--sheet-height", `${h}px`);
        document.documentElement.style.setProperty("--sheet-height", `${h}px`);
      }, 100);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timer) clearTimeout(timer);
    };
  }, [isMobile, snap]);

  if (!isMobile) {
    return <>{children}</>;
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // ignore — fall back to window-level listeners (not implemented here; iOS rarely needs it)
    }
    draggingRef.current = true;
    startYRef.current = e.clientY;
    lastYRef.current = e.clientY;
    lastTimeRef.current = performance.now();
    startHeightRef.current = currentHeightRef.current || getSnapPx(snap);
    const sheet = sheetRef.current;
    if (sheet) sheet.style.transition = "none";
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const dy = e.clientY - startYRef.current; // positive = moved down = sheet shrinks
    const newHeight = Math.max(
      PEEK_PX,
      Math.min(getSnapPx("full"), startHeightRef.current - dy),
    );
    currentHeightRef.current = newHeight;
    const sheet = sheetRef.current;
    if (sheet) {
      sheet.style.transform = `translateY(calc(100% - ${newHeight}px))`;
      sheet.style.setProperty("--sheet-height", `${newHeight}px`);
      document.documentElement.style.setProperty("--sheet-height", `${newHeight}px`);
    }
    const now = performance.now();
    const dt = now - lastTimeRef.current;
    if (dt > 0) {
      velocityRef.current = (e.clientY - lastYRef.current) / dt;
    }
    lastYRef.current = e.clientY;
    lastTimeRef.current = now;
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const totalDy = Math.abs(e.clientY - startYRef.current);
    const heightPx = currentHeightRef.current;
    if (totalDy < DRAG_THRESHOLD_PX) {
      // Treat as a tap → cycle
      setSnap((s) => nextSnapCycle(s));
      return;
    }
    const target = computeTargetSnap(heightPx, velocityRef.current, {
      peek: PEEK_PX,
      half: getSnapPx("half"),
      full: getSnapPx("full"),
    });
    setSnap(target);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSnap((s) => nextSnapCycle(s));
    } else if (e.key === "Escape") {
      setSnap("peek");
    }
  };

  return (
    <div className="bottom-sheet" ref={sheetRef} role="region" aria-label="Detail panel">
      <div
        ref={headerRef}
        className="bottom-sheet__header"
        role="button"
        tabIndex={0}
        aria-label="Drag to resize panel, or press Enter to cycle"
        aria-expanded={snap === "full"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={onKeyDown}
      >
        <span className="bottom-sheet__handle" aria-hidden="true" />
        {snap === "peek" && peekSummary && (
          <div className="bottom-sheet__peek-summary">{peekSummary}</div>
        )}
      </div>
      <div className="bottom-sheet__body">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web && npx tsc -b
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/BottomSheet.tsx
git commit -m "Add BottomSheet component (three snap points, pointer-event drag)"
```

---

## Task 13: CSS for bottom sheet, locate control, banner, notice

**Files:**
- Modify: `apps/web/src/styles/global.css`

- [ ] **Step 1: Append bottom-sheet, locate-control, banner, and notice styles**

Append to the END of `apps/web/src/styles/global.css`:

```css
/* ============================================================
   Locate control (MapLibre custom IControl)
   ============================================================ */

.locate-control {
  /* Sits in the bottom-right MapLibre control stack */
}

.locate-control__btn {
  width: 36px;
  height: 36px;
  border: none;
  background: var(--warm-cream, #FAF7F2);
  color: #6b4a30;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.locate-control__btn:hover {
  color: #C45B28;
}

.locate-control__btn--active {
  color: #C45B28;
}

.locate-control__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.locate-control__spinner {
  animation: locate-spin 0.9s linear infinite;
}

@keyframes locate-spin {
  to { transform: rotate(360deg); }
}

/* ============================================================
   Geolocate first-visit banner
   ============================================================ */

.geolocate-prompt {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(250, 247, 242, 0.97);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(44, 24, 16, 0.08);
  border-radius: 8px;
  padding: 0.625rem 0.875rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  z-index: 30;
  box-shadow: 0 4px 16px rgba(44, 24, 16, 0.08);
  animation: geo-prompt-fade-in 0.25s ease;
  font-size: 0.875rem;
  max-width: calc(100% - 24px);
}

@media (prefers-reduced-motion: reduce) {
  .geolocate-prompt {
    animation: none;
  }
}

@keyframes geo-prompt-fade-in {
  from { opacity: 0; transform: translate(-50%, -8px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}

.geolocate-prompt__actions {
  display: flex;
  gap: 0.375rem;
}

.geolocate-prompt__btn {
  border: none;
  padding: 0.375rem 0.75rem;
  border-radius: 6px;
  background: #C45B28;
  color: white;
  font-size: 0.8125rem;
  cursor: pointer;
}

.geolocate-prompt__btn--secondary {
  background: transparent;
  color: #6b4a30;
}

/* ============================================================
   Geolocate inline notice (out-of-range, denied, unavailable)
   ============================================================ */

.geo-notice {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(250, 247, 242, 0.97);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(44, 24, 16, 0.12);
  border-radius: 8px;
  padding: 0.5rem 0.875rem;
  z-index: 29;
  font-size: 0.8125rem;
  color: #6b4a30;
  max-width: calc(100% - 24px);
}

/* ============================================================
   Bottom sheet (mobile only — wrapper visible at <=768px)
   ============================================================ */

@media (max-width: 768px) {
  .bottom-sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 90dvh;
    /* Fallback for browsers without dvh */
    max-height: 90vh;
    background: rgba(250, 247, 242, 0.97);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-top: 1px solid rgba(44, 24, 16, 0.08);
    box-shadow: 0 -4px 16px rgba(44, 24, 16, 0.06);
    z-index: 12;
    display: flex;
    flex-direction: column;
    will-change: transform;
    transform: translateY(calc(100% - 360px)); /* default = half (will be overwritten by inline style) */
  }

  @media (prefers-reduced-motion: reduce) {
    .bottom-sheet {
      transition: none !important;
    }
  }

  .bottom-sheet__header {
    flex: 0 0 auto;
    padding: 0.5rem 0.75rem 0.625rem;
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
  }

  .bottom-sheet__header:active {
    cursor: grabbing;
  }

  .bottom-sheet__header:focus-visible {
    outline: 2px solid #C45B28;
    outline-offset: -2px;
    border-radius: 4px;
  }

  .bottom-sheet__handle {
    width: 36px;
    height: 4px;
    border-radius: 999px;
    background: rgba(196, 91, 40, 0.45);
  }

  .bottom-sheet__peek-summary {
    font-size: 0.8125rem;
    color: #6b4a30;
    text-align: center;
  }

  .bottom-sheet__body {
    flex: 1 1 auto;
    overflow-y: auto;
    touch-action: pan-y;
    -webkit-overflow-scrolling: touch;
  }

  /* When the BottomSheet wrapper is rendered, hide the legacy mobile sidebar overrides */
  .app-sidebar.app-sidebar--has-sheet {
    display: none;
  }

  /* Push the MapLibre control stack up so it stays above the sheet */
  .map-container .maplibregl-ctrl-bottom-right,
  .map-container .maplibregl-ctrl-bottom-left {
    bottom: calc(var(--sheet-height, 80px) + 8px);
    transition: bottom 220ms cubic-bezier(.2,.8,.2,1);
  }
}
```

- [ ] **Step 2: Verify the dev server picks up the styles**

```bash
cd apps/web && npm run dev
```

Open `http://localhost:5173/` on a mobile-sized window (devtools). At this point the sheet is not yet rendered (next tasks wire it in). Confirm there are no console errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/styles/global.css
git commit -m "Add styles for BottomSheet, LocateControl, banner, and notice"
```

---

## Task 14: Wire `BottomSheet` into ExplorePage

**Files:**
- Modify: `apps/web/src/pages/ExplorePage.tsx`

- [ ] **Step 1: Import BottomSheet**

Add:

```tsx
import { BottomSheet } from "../components/BottomSheet";
import { useMediaQuery } from "../hooks/useMediaQuery";
```

- [ ] **Step 2: Extract a `PanelContents` local component to avoid duplication**

Inside `apps/web/src/pages/ExplorePage.tsx`, just above the `ExplorePage` function, add:

```tsx
function PanelContents({
  activeCategories,
  onToggle,
  onToggleAll,
  pois,
  displayedPoi,
  fadingOut,
}: {
  activeCategories: Set<PlaceCategory>;
  onToggle: (cat: PlaceCategory) => void;
  onToggleAll: () => void;
  pois: PoisResponse | null;
  displayedPoi: SelectedPoi | null;
  fadingOut: boolean;
}) {
  return (
    <>
      <ExplorePanel
        activeCategories={activeCategories}
        onToggle={onToggle}
        onToggleAll={onToggleAll}
        pois={pois}
      />
      {!displayedPoi && (
        <div className="explore-intro">
          <p>
            Santa Fe's 400-year story is written into its streets, walls,
            and landscape. This map plots {pois ? pois.features.length : "hundreds of"} places
            across five categories — from sites on the National Register to scenic
            overlooks and public art.
          </p>
          <p className="explore-intro__cta">Click any dot to learn more.</p>
        </div>
      )}
      {displayedPoi && (
        <PoiDetail key={displayedPoi.name} poi={displayedPoi} fadingOut={fadingOut} />
      )}
    </>
  );
}
```

- [ ] **Step 3: Replace the existing `<aside>` block with the mobile/desktop split**

Find the existing `<aside className="app-sidebar explore-sidebar">…</aside>` block inside `ExplorePage` and replace it with:

```tsx
{!isMobile && (
  <aside className="app-sidebar explore-sidebar">
    <PanelContents
      activeCategories={activeCategories}
      onToggle={handleToggle}
      onToggleAll={handleToggleAll}
      pois={pois}
      displayedPoi={displayedPoi}
      fadingOut={fadingOut}
    />
  </aside>
)}
{isMobile && (
  <BottomSheet initialSnap="half" peekSummary={peekSummary}>
    <PanelContents
      activeCategories={activeCategories}
      onToggle={handleToggle}
      onToggleAll={handleToggleAll}
      pois={pois}
      displayedPoi={displayedPoi}
      fadingOut={fadingOut}
    />
  </BottomSheet>
)}
```

Declare `isMobile` and `peekSummary` near the top of `ExplorePage`:

```tsx
const isMobile = useMediaQuery("(max-width: 768px)");
const peekSummary = pois ? (
  <>{pois.features.length} places · {activeCategories.size} layers</>
) : null;
```

- [ ] **Step 4: Type-check**

```bash
cd apps/web && npx tsc -b
```

Expected: no errors.

- [ ] **Step 5: Manual smoke test (mobile)**

In Chrome DevTools, toggle device toolbar to iPhone 14 (or any width ≤ 768px). Visit `/`:
- Sheet appears at half height.
- Drag the handle up — sheet grows to full.
- Drag back down — passes half, then snaps to peek.
- At peek, summary "234 places · 5 layers" is visible.
- Tap the handle (no drag) — cycles peek → half → full → peek.
- `Tab` to focus the header, press `Enter` — cycles. Press `Esc` — collapses to peek.
- Rotate device (portrait/landscape) — sheet adjusts heights.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ExplorePage.tsx
git commit -m "Wrap Explore mobile panel in BottomSheet"
```

---

## Task 15: Wire `BottomSheet` into Builder

**Files:**
- Modify: `apps/web/src/components/Map.tsx`

The Builder's sidebar is rendered inside `Map.tsx`. The contents are `DistancePresets + VerdictPanel` (the `ModeToggle` is already split out to a top-of-screen position on mobile).

The Builder's sidebar block lives at `apps/web/src/components/Map.tsx:1321` (`<aside className="app-sidebar">…</aside>`). It contains `<ModeToggle>` + an intro/`<VerdictPanel>` switch.

- [ ] **Step 1: Add imports**

In `apps/web/src/components/Map.tsx`:

```tsx
import { BottomSheet } from "./BottomSheet";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { SnapName } from "../lib/bottomSheet";
```

- [ ] **Step 2: Declare `sheetControlRef`, `isMobile`, `peekSummary` near the top of the `Map` component**

Inside the `Map` component body, near the other refs:

```tsx
const sheetControlRef = useRef<{ setSnap: (snap: SnapName) => void } | null>(null);
```

Just before the return statement:

```tsx
const isMobile = useMediaQuery("(max-width: 768px)");
const peekSummary = (() => {
  if (activeResult?.within_limit === true) return <>{mode === "walk" ? "Walk" : "Drive"} · within limit</>;
  if (activeResult?.within_limit === false) return <>{mode === "walk" ? "Walk" : "Drive"} · over limit</>;
  return <>{mode === "walk" ? "Walk" : "Drive"} · tap map to start</>;
})();
```

(`activeResult` is the same variable used inside `VerdictPanel` props — see line ~1334 of `Map.tsx`.)

- [ ] **Step 3: Extract a `SidebarContents` local component**

Just above the `Map` function, add:

```tsx
function SidebarContents(props: {
  mode: TravelMode;
  handleModeChange: (m: TravelMode) => void;
  showVerdictPanel: boolean;
  verdictProps: React.ComponentProps<typeof VerdictPanel>;
  showModeToggle: boolean;
}) {
  const { mode, handleModeChange, showVerdictPanel, verdictProps, showModeToggle } = props;
  return (
    <>
      {showModeToggle && <ModeToggle mode={mode} onChange={handleModeChange} />}
      {!showVerdictPanel && (
        <div className="sidebar-intro">
          <h2>Explore Santa Fe {mode === "walk" ? "on foot" : "by car"}</h2>
          <p>
            Plan a {mode === "walk" ? "walk" : "drive"} and discover stops worth a detour — historic sites,
            galleries, landmarks, and scenic overlooks along your route.
          </p>
        </div>
      )}
      {showVerdictPanel && <VerdictPanel {...verdictProps} />}
    </>
  );
}
```

The mobile sheet sets `showModeToggle={false}` because the top-of-screen mobile toggle (`app-mode-toggle-mobile` in `App.tsx`) is already rendered there.

- [ ] **Step 4: Build the `verdictProps` object inline before the return**

Before the JSX `return`, assemble the props that today are passed inline to `<VerdictPanel>` (so they can be reused by both the desktop sidebar and the mobile sheet):

```tsx
const verdictProps: React.ComponentProps<typeof VerdictPanel> = {
  distance_miles: activeResult?.distance_miles ?? 0,
  duration_seconds: activeResult?.duration_seconds ?? 0,
  within_limit: activeResult?.within_limit ?? false,
  limit_miles: effectiveMilesFor(mode),
  isLoading,
  error,
  retryAfterSeconds,
  onReset: handleReset,
  nearbyStops: filteredStops,
  selectedStops,
  stopLoading,
  stopError,
  onSelectStop: handleSelectStop,
  onFocusStop: handleFocusStop,
  activeCategories,
  onToggleCategory: handleToggleCategory,
  onToggleAllCategories: handleToggleAllCategories,
  categoryCounts,
  detourLoading,
  showingDetour,
  mode,
  shortestRoute:
    showingDetour && result
      ? {
          distance_miles: result.distance_miles,
          duration_seconds: result.duration_seconds,
          within_limit: result.within_limit,
        }
      : null,
  onBackToShortest: showingDetour ? handleBackToShortest : null,
  showAllStops,
  onToggleShowAll: () => setShowAllStops((prev) => !prev),
  onPlayTour: showingDetour && detourResult && selectedStops.length >= 1 ? handlePlayTour : null,
  savingTour,
  saveTourError,
};
```

- [ ] **Step 5: Replace the existing `<aside className="app-sidebar">…</aside>` block**

Replace it with the desktop/mobile split:

```tsx
{!isMobile && (
  <aside className="app-sidebar">
    <SidebarContents
      mode={mode}
      handleModeChange={handleModeChange}
      showVerdictPanel={showVerdictPanel}
      verdictProps={verdictProps}
      showModeToggle={true}
    />
  </aside>
)}
{isMobile && (
  <BottomSheet initialSnap="half" peekSummary={peekSummary} controlRef={sheetControlRef}>
    <SidebarContents
      mode={mode}
      handleModeChange={handleModeChange}
      showVerdictPanel={showVerdictPanel}
      verdictProps={verdictProps}
      showModeToggle={false}
    />
  </BottomSheet>
)}
```

- [ ] **Step 6: Type-check**

```bash
cd apps/web && npx tsc -b
```

Expected: no errors.

- [ ] **Step 7: Manual smoke test (mobile)**

In DevTools mobile mode, visit `/build`:
- Sheet appears at half height with mode toggle (hidden via existing `.app-sidebar > .mode-toggle { display: none }` rule — confirm; if the rule fires inside the sheet too, adjust by changing the selector to `.app-sidebar > .mode-toggle` only, which it already is).
- Tap map to set origin → area polygon fetches; sheet stays at half.
- Tap a second point → route shows; verdict appears.
- Drag sheet to peek → peek summary reads "Drive · within limit" (or "over limit").
- Sheet stays usable through phase changes.
- Top-of-screen mode toggle still works (`app-mode-toggle-mobile`).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/Map.tsx
git commit -m "Wrap Builder mobile panel in BottomSheet"
```

---

## Task 16: Sheet-aware geolocate + accessibility polish

This is the final integration task: when geolocate succeeds and the sheet is at `full`, auto-collapse it to `peek` so the dot is visible. Also do a manual pass on a11y and reduced-motion.

**Files:**
- Modify: `apps/web/src/components/Map.tsx`
- Modify: `apps/web/src/components/explore/ExploreMap.tsx`
- Modify: `apps/web/src/pages/ExplorePage.tsx`

The sheet is rendered by the *page* (ExplorePage) or by Map.tsx (Builder), but geolocate fires from inside the map components. We need a way for the map component to request "collapse the sheet to peek" after a successful geolocate.

Approach: the page (ExplorePage / BuilderPage already wired in Map.tsx) holds a `sheetControlRef` and passes a "collapse to peek" callback to the map component. After geolocate transitions to `ok` and the map component recenters, it calls the callback.

For Explore, ExplorePage owns the `<BottomSheet>` so we add the ref there and pass a callback into `<ExploreMap>`.

For Builder, the sheet is rendered inside `Map.tsx`, so we already have direct access to `sheetControlRef`.

- [ ] **Step 1: Add `onGeolocateSuccess` prop to `ExploreMap`**

In `apps/web/src/components/explore/ExploreMap.tsx`:

```tsx
interface ExploreMapProps {
  // ...existing...
  onGeolocateSuccess?: () => void;
}
```

In the existing geolocate effect, after `map.easeTo(...)` for `state === "ok"`, add:

```tsx
if (onGeolocateSuccess) onGeolocateSuccess();
```

- [ ] **Step 2: Pass `onGeolocateSuccess` from ExplorePage**

In `apps/web/src/pages/ExplorePage.tsx`:

```tsx
const sheetControlRef = useRef<{ setSnap: (snap: SnapName) => void } | null>(null);
```

Add import:

```tsx
import type { SnapName } from "../lib/bottomSheet";
```

Pass `controlRef={sheetControlRef}` to `<BottomSheet>` and `onGeolocateSuccess` to `<ExploreMap>`:

```tsx
<ExploreMap
  activeCategories={activeCategories}
  onPoiSelect={setSelectedPoi}
  pois={pois}
  focusPoiRef={focusPoiRef}
  geolocateRef={geolocateRef}
  onGeolocateSuccess={() => sheetControlRef.current?.setSnap("peek")}
/>
```

```tsx
<BottomSheet initialSnap="half" peekSummary={peekSummary} controlRef={sheetControlRef}>
  ...
</BottomSheet>
```

- [ ] **Step 3: Hook the Builder geolocate effect to `sheetControlRef`**

In `apps/web/src/components/Map.tsx`, inside the existing geolocate effect, after `map.easeTo(...)` for the `state === "ok"` branch:

```tsx
sheetControlRef.current?.setSnap("peek");
```

- [ ] **Step 4: Type-check**

```bash
cd apps/web && npx tsc -b
```

Expected: no errors.

- [ ] **Step 5: Run all unit tests**

```bash
cd apps/web && npm run test
```

Expected: all PASS — geo.test.ts + bottomSheet.test.ts.

- [ ] **Step 6: Manual smoke test (full feature)**

Run dev server:

```bash
cd apps/web && npm run dev
```

In a mobile viewport (or, ideally, an actual phone via local network), exercise:

**Explore (`/`):**
- First load: banner appears after ~500ms.
- Accept location → map recenters; dot at user; sheet auto-collapses to peek.
- Expand sheet to full → tap locate button → sheet collapses to peek; dot visible.
- Deny location → notice "Location permission denied…" appears; button is disabled.
- Reload, no banner.
- Drag sheet through all three positions; tap-cycle; keyboard (Tab/Enter/Esc).
- `prefers-reduced-motion` (DevTools rendering tab) → snaps are instant.

**Builder (`/build`):**
- Click locate before tapping map → origin is set from location; area fetches; phase advances.
- Click locate again → does NOT overwrite origin; just recenters; sheet collapses to peek.
- Tap map for origin manually, then click locate → recenters; origin unchanged.
- Out-of-range simulated → notice; origin is NOT set.
- Bottom sheet works through all phases (set-origin → set-destination → route-shown).

**Both pages on desktop (>768px):**
- Sidebar renders unchanged.
- Locate button visible bottom-right of map; clicking works (no sheet to collapse — just recenters).

If any step fails, capture the failure clearly and create follow-up tasks; do NOT mark this task complete until the smoke test passes.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/Map.tsx apps/web/src/components/explore/ExploreMap.tsx apps/web/src/pages/ExplorePage.tsx
git commit -m "Auto-collapse sheet to peek on successful geolocate"
```

---

## Done criteria

- [ ] All 16 tasks complete.
- [ ] `npm run test` passes (9 tests in `geo.test.ts` + 6 tests in `bottomSheet.test.ts`).
- [ ] `npx tsc -b` succeeds with no errors.
- [ ] Manual smoke test in Task 16 passes on at least one mobile viewport.
- [ ] No new runtime dependencies in `package.json`.
- [ ] Desktop appearance unchanged above 768px breakpoint.

## Out of scope (do not implement)

- `watchPosition` continuous tracking.
- Persisting last-known location.
- Reverse geocoding ("you are near …").
- A desktop bottom-sheet treatment.
- Background re-fetch of POIs based on user location.
