# Agent Prompt Kit - Detour

## How to use this file

These prompts are for repo-aware maintenance work on the current codebase. They assume the app already exists and that the agent should inspect the repository before editing.

Read these first:

- `README.md`
- `docs/PRD.md`
- `docs/TECH_SPEC.md`
- `CLAUDE.md`

## Prompt 1 - Product/Doc Sync Pass

```text
Read the current repository before editing.

Treat the working tree as the source of truth.

Your task is to reconcile the docs with the current app behavior:
- click to set origin
- click to set destination
- dynamic service area for the chosen origin
- shortest-route verdict with distance and duration
- mileage presets of 1, 3, and 5 miles

Inspect at minimum:
- README.md
- CLAUDE.md
- docs/PRD.md
- docs/TECH_SPEC.md
- docs/DEPLOY.md
- any other existing docs that describe behavior, setup, prompts, or workflow

Do not change application behavior unless a tiny documentation-blocking bug must be fixed to keep the docs truthful.

Deliver:
1. which docs were stale
2. files updated
3. contradictions found between docs and code
4. whether any repo-local agent/tooling docs existed and needed updates
```

## Prompt 2 - Frontend Behavior Pass

```text
Read the current repository before editing.

Focus only on the frontend in apps/web.

Verify that the UI still matches this flow:
1. page loads centered on configured default location
2. first click sets origin
3. polygon renders for selected miles and origin
4. second click sets destination
5. verdict panel shows shortest-route distance, duration, and within-threshold result
6. next click after a route starts a new check

Keep the backend contract unchanged unless the current frontend already depends on a mismatch.
Make minimal changes and preserve the current visual language.
```

## Prompt 3 - Backend/API Contract Pass

```text
Read the current repository before editing.

Focus only on apps/api and the typed API client in apps/web/src/lib/api.ts.

Confirm that:
- /api/config returns the configured default center metadata
- /api/area accepts miles and optional origin=lon,lat
- /api/route accepts to, optional origin=lon,lat, and optional miles
- shortest-route logic still uses ORS preference="shortest"
- isodistance logic still uses range_type="distance"

If you find drift, update code and docs together with the smallest possible change set.
```
