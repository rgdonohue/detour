import type { StopSuggestion } from "../lib/api";
import type { PlaceCategory } from "../data/places";
import { StopCategorySelector } from "./StopCategorySelector";

const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  history: "Historic",
  art: "Art",
  food: "Food & Drink",
  scenic: "Scenic",
  culture: "Culture",
};

interface VerdictPanelProps {
  distance_miles: number;
  duration_seconds: number;
  within_limit: boolean;
  limit_miles: number;
  isLoading?: boolean;
  error?: string | null;
  onReset: () => void;
  nearbyStop?: StopSuggestion | null;
  stopLoading?: boolean;
  onRouteViaStop?: (() => void) | null;
  detourLoading?: boolean;
  showingDetour?: boolean;
  shortestRoute?: {
    distance_miles: number;
    duration_seconds: number;
    within_limit: boolean;
  } | null;
  onBackToShortest?: (() => void) | null;
  detourPreview?: { extra_miles: number; within_limit: boolean } | null;
  stopCategory?: PlaceCategory | null;
  onCategoryChange?: ((cat: PlaceCategory | null) => void) | null;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return "< 1 min";
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
}

export function VerdictPanel({
  distance_miles,
  duration_seconds,
  within_limit,
  limit_miles,
  isLoading = false,
  error = null,
  onReset,
  nearbyStop = null,
  stopLoading = false,
  onRouteViaStop = null,
  detourLoading = false,
  showingDetour = false,
  shortestRoute = null,
  onBackToShortest = null,
  detourPreview = null,
  stopCategory = null,
  onCategoryChange = null,
}: VerdictPanelProps) {
  const accentColor = within_limit ? "var(--route-within)" : "var(--route-outside)";

  if (error) {
    const isNoRoute = /no route|not found|unreachable|404/i.test(error);
    const isNetwork = /unable to connect|internet connection/i.test(error);
    const message = isNoRoute
      ? "No driving route to this location"
      : isNetwork
        ? "Unable to connect. Check your internet connection."
        : "Route check unavailable, try again";

    return (
      <div
        className="verdict-panel verdict-panel--visible verdict-panel--error"
        role="region"
        aria-label="Route check result"
      >
        <h3 className="verdict-panel__title">📍 Route Result</h3>
        <p className="verdict-panel__message" aria-live="polite">
          {message}
        </p>
        <div className="verdict-panel__actions">
          <button
            type="button"
            className="verdict-panel__reset"
            onClick={onReset}
          >
            Reset View
          </button>
        </div>
      </div>
    );
  }

  const verdictText = within_limit
    ? `Within ${limit_miles}-mile range`
    : `Outside ${limit_miles}-mile range`;

  const title =
    showingDetour && nearbyStop
      ? `Via ${nearbyStop.name}`
      : "Selected Destination";

  return (
    <div
      className="verdict-panel verdict-panel--visible"
      role="region"
      aria-label="Route check result"
      aria-live="polite"
      style={{ "--verdict-accent": accentColor } as React.CSSProperties}
    >
      <h3 className="verdict-panel__title">📍 {title}</h3>

      {isLoading ? (
        <p className="verdict-panel__loading">Computing route…</p>
      ) : (
        <>
          <p className="verdict-panel__distance">
            Distance:{" "}
            <span className="verdict-panel__value tabular-nums">
              {distance_miles.toFixed(1)} miles
            </span>
            <span className="verdict-panel__duration">
              {" "}· {formatDuration(duration_seconds)} drive
            </span>
          </p>
          <p className="verdict-panel__verdict" aria-label={verdictText}>
            {within_limit ? (
              <>
                <span className="verdict-panel__icon" aria-hidden>✅</span>{" "}
                {verdictText}
              </>
            ) : (
              <>
                <span className="verdict-panel__icon" aria-hidden>❌</span>{" "}
                {verdictText}
                <span className="verdict-panel__note">
                  {" "}— Spots inside the shaded area can exceed {limit_miles} mi by road
                </span>
              </>
            )}
          </p>
        </>
      )}

      {/* Comparison with shortest route (detour mode) */}
      {showingDetour && shortestRoute && !isLoading && (
        <div className="verdict-panel__comparison">
          <p className="verdict-panel__comparison-shortest">
            Shortest: {shortestRoute.distance_miles.toFixed(1)} mi ·{" "}
            {formatDuration(shortestRoute.duration_seconds)}
          </p>
          <p className="verdict-panel__comparison-delta">
            +{Math.max(0, distance_miles - shortestRoute.distance_miles).toFixed(1)} mi
            {" "}· +{formatDuration(Math.max(0, duration_seconds - shortestRoute.duration_seconds))} added
          </p>
        </div>
      )}

      {/* Nearby stop suggestion (shortest mode only) */}
      {!showingDetour && !isLoading && (
        <div className="verdict-panel__stop">
          <p className="verdict-panel__stop-label">Along the way</p>
          {onCategoryChange && (
            <StopCategorySelector selected={stopCategory ?? null} onChange={onCategoryChange} />
          )}
          {stopLoading && !nearbyStop ? (
            <p className="verdict-panel__loading">Finding a stop…</p>
          ) : nearbyStop ? (
            <>
              <p className="verdict-panel__stop-name">
                {nearbyStop.name}
                <span className="verdict-panel__stop-category">
                  {(CATEGORY_LABELS as Record<string, string>)[nearbyStop.category] ?? nearbyStop.category}
                </span>
              </p>
              {nearbyStop.description && (
                <p className="verdict-panel__stop-desc">
                  {nearbyStop.description}
                </p>
              )}
              {nearbyStop.source_category_note === "approximate" && (
                <p className="verdict-panel__stop-note">Approximate category match</p>
              )}
              <p
                className="verdict-panel__stop-proximity"
                style={
                  detourPreview
                    ? {
                        color: detourPreview.within_limit
                          ? "var(--sage)"
                          : "var(--route-outside)",
                        fontWeight: 500,
                      }
                    : undefined
                }
              >
                {detourPreview
                  ? `+${Math.max(0, detourPreview.extra_miles).toFixed(1)} mi via this stop · ${detourPreview.within_limit ? `still within ${limit_miles}-mi range` : `exceeds ${limit_miles}-mi range`}`
                  : detourLoading
                    ? "Checking detour…"
                    : nearbyStop.distance_miles < 0.1
                      ? "Right along your route"
                      : `${nearbyStop.distance_miles.toFixed(1)} mi from route`}
              </p>
              {onRouteViaStop && (
                <button
                  type="button"
                  className="verdict-panel__via-btn"
                  onClick={onRouteViaStop}
                  disabled={detourLoading}
                >
                  {detourLoading ? "Computing…" : "Route via this stop"}
                </button>
              )}
            </>
          ) : (
            <p className="verdict-panel__stop-none">
              {stopCategory
                ? `No ${CATEGORY_LABELS[stopCategory].toLowerCase()} spots within 1 mile of this route`
                : "No stops within 1 mile of this route"}
            </p>
          )}
        </div>
      )}

      <div className="verdict-panel__actions">
        {onBackToShortest && (
          <button
            type="button"
            className="verdict-panel__reset"
            onClick={onBackToShortest}
          >
            Shortest route
          </button>
        )}
        <button
          type="button"
          className="verdict-panel__reset"
          onClick={onReset}
        >
          Reset View
        </button>
      </div>
    </div>
  );
}
