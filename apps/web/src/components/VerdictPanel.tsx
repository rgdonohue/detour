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

// ORS returns category_group strings — map to display labels
const ORS_GROUP_LABELS: Record<string, string> = {
  historic: "Historic",
  arts_and_culture: "Arts & Culture",
  leisure_and_entertainment: "Leisure",
  natural: "Natural",
  sustenance: "Food & Drink",
  tourism: "Tourism",
  public_places: "Public Place",
  accommodation: "Accommodation",
  education: "Education",
  facilities: "Facility",
  financial: "Financial",
  healthcare: "Healthcare",
  service: "Service",
  shops: "Shop",
  transport: "Transport",
};

function getCategoryLabel(category: string): string {
  return (
    (CATEGORY_LABELS as Record<string, string>)[category] ??
    ORS_GROUP_LABELS[category] ??
    category
  );
}

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
        <div className="verdict-panel__head">
          <span className="verdict-panel__label">Route</span>
        </div>
        <p className="verdict-panel__error-msg" aria-live="polite">
          {message}
        </p>
        <div className="verdict-panel__actions">
          <button
            type="button"
            className="verdict-panel__btn-ghost"
            onClick={onReset}
          >
            Reset map
          </button>
        </div>
      </div>
    );
  }

  const statusClass = within_limit
    ? "verdict-panel__status verdict-panel__status--in"
    : "verdict-panel__status verdict-panel__status--out";
  const statusText = within_limit
    ? `Within ${limit_miles} mi`
    : `Outside ${limit_miles} mi`;

  const proximityText = (() => {
    if (detourPreview) {
      const extra = Math.max(0, detourPreview.extra_miles).toFixed(1);
      return ` · +${extra} mi${detourPreview.within_limit ? "" : " (over range)"}`;
    }
    if (detourLoading) return " · checking…";
    if (!nearbyStop) return "";
    return nearbyStop.distance_miles < 0.1
      ? " · along your route"
      : ` · ${nearbyStop.distance_miles.toFixed(1)} mi from route`;
  })();

  return (
    <div
      className="verdict-panel verdict-panel--visible"
      role="region"
      aria-label="Route check result"
      aria-live="polite"
    >
      {showingDetour && nearbyStop ? (
        <div className="verdict-panel__detour-header">
          <h3 className="verdict-panel__title">Via {nearbyStop.name}</h3>
          {!isLoading && <span className={statusClass}>{statusText}</span>}
        </div>
      ) : (
        <div className="verdict-panel__head">
          <span className="verdict-panel__label">Route</span>
          {!isLoading && <span className={statusClass}>{statusText}</span>}
        </div>
      )}

      {isLoading ? (
        <p className="verdict-panel__loading">Computing route…</p>
      ) : (
        <div className="verdict-panel__metrics">
          <span className="verdict-panel__metric">{distance_miles.toFixed(1)} mi</span>
          <span className="verdict-panel__metric-sep">·</span>
          <span className="verdict-panel__metric">{formatDuration(duration_seconds)}</span>
        </div>
      )}

      {!isLoading && !within_limit && (
        <p className="verdict-panel__note">
          Spots inside the shaded area can exceed {limit_miles} mi by road
        </p>
      )}

      {/* Comparison with shortest route (detour mode) */}
      {showingDetour && shortestRoute && !isLoading && (
        <div className="verdict-panel__comparison">
          <p className="verdict-panel__comparison-shortest">
            Direct: {shortestRoute.distance_miles.toFixed(1)} mi ·{" "}
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
              <p className="verdict-panel__stop-name">{nearbyStop.name}</p>
              <p className="verdict-panel__stop-meta">
                {getCategoryLabel(nearbyStop.category)}
                <span
                  className="verdict-panel__stop-proximity"
                  style={
                    detourPreview
                      ? {
                          color: detourPreview.within_limit
                            ? "var(--route-within)"
                            : "var(--route-outside)",
                          fontWeight: 500,
                        }
                      : undefined
                  }
                >
                  {proximityText}
                </span>
              </p>
              {nearbyStop.source_category_note === "approximate" && (
                <p className="verdict-panel__stop-note">Approximate category match</p>
              )}
              {nearbyStop.description && (
                <p className="verdict-panel__stop-desc">{nearbyStop.description}</p>
              )}
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
                ? `No ${CATEGORY_LABELS[stopCategory].toLowerCase()} stops nearby`
                : "No stops within 1 mile of this route"}
            </p>
          )}
        </div>
      )}

      <div className="verdict-panel__actions">
        {onBackToShortest && (
          <button
            type="button"
            className="verdict-panel__btn-secondary"
            onClick={onBackToShortest}
          >
            Shortest route
          </button>
        )}
        <button
          type="button"
          className="verdict-panel__btn-ghost"
          onClick={onReset}
        >
          Reset map
        </button>
      </div>
    </div>
  );
}
