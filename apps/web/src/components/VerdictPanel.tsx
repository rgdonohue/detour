import type { StopSuggestion, TravelMode } from "../lib/api";
import type { PlaceCategory } from "../data/places";
import { StopCategorySelector } from "./StopCategorySelector";

const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  history: "Historic",
  art: "Art",
  scenic: "Scenic",
  culture: "Culture",
  civic: "Landmark",
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
  nearbyStops?: StopSuggestion[];
  selectedStops?: StopSuggestion[];
  stopLoading?: boolean;
  stopError?: string | null;
  onSelectStop?: ((stop: StopSuggestion) => void) | null;
  detourLoading?: boolean;
  showingDetour?: boolean;
  shortestRoute?: {
    distance_miles: number;
    duration_seconds: number;
    within_limit: boolean;
  } | null;
  onBackToShortest?: (() => void) | null;
  stopCategory?: PlaceCategory | null;
  onCategoryChange?: ((cat: PlaceCategory | null) => void) | null;
  mode?: TravelMode;
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
  nearbyStops = [],
  selectedStops = [],
  stopLoading = false,
  stopError = null,
  onSelectStop = null,
  detourLoading = false,
  showingDetour = false,
  shortestRoute = null,
  onBackToShortest = null,
  stopCategory = null,
  onCategoryChange = null,
  mode = "walk",
}: VerdictPanelProps) {
  if (error) {
    const isNoRoute = /no route|not found|unreachable|404/i.test(error);
    const isNetwork = /unable to connect|internet connection/i.test(error);
    const routeLabel = mode === "walk" ? "walking" : "driving";
    const message = isNoRoute
      ? `No ${routeLabel} route to this location`
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

  return (
    <div
      className="verdict-panel verdict-panel--visible"
      role="region"
      aria-label="Route check result"
      aria-live="polite"
    >
      {showingDetour && selectedStops.length > 0 ? (
        <div className="verdict-panel__detour-header">
          <h3 className="verdict-panel__title">
            {selectedStops.length === 1
              ? `Via ${selectedStops[0].name}`
              : `Via ${selectedStops.length} stops`}
          </h3>
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

      {/* Itinerary summary — compact route-ordered list of selections */}
      {selectedStops.length > 0 && !isLoading && (
        <div className="itinerary-summary">
          <p className="itinerary-summary__label">Your route</p>
          <ol className="itinerary-summary__list">
            {selectedStops.map((stop, i) => (
              <li key={stop.name}>
                <button
                  type="button"
                  className="itinerary-summary__item"
                  onClick={() => onSelectStop?.(stop)}
                >
                  <span className="itinerary-summary__order">{i + 1}</span>
                  <span className="itinerary-summary__name">{stop.name}</span>
                  <span className="itinerary-summary__badge">{getCategoryLabel(stop.category)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Stop suggestions list */}
      {!isLoading && (
        <div className="verdict-panel__stop">
          <p className="verdict-panel__stop-label">Along the way</p>
          {onCategoryChange && (
            <StopCategorySelector selected={stopCategory ?? null} onChange={onCategoryChange} />
          )}
          {stopLoading ? (
            <p className="verdict-panel__loading">Finding stops…</p>
          ) : nearbyStops.length > 0 ? (
            <>
              <ul className="stop-list">
                {nearbyStops.map((stop) => {
                  const orderIdx = selectedStops.findIndex((s) => s.name === stop.name);
                  const isSelected = orderIdx >= 0;
                  return (
                    <li key={stop.name}>
                      <button
                        type="button"
                        className={`stop-list__item${isSelected ? " stop-list__item--selected" : ""}`}
                        onClick={() => onSelectStop?.(stop)}
                        disabled={detourLoading && !isSelected}
                      >
                        <span className="stop-list__item-header">
                          <span className="stop-list__item-name">{stop.name}</span>
                          <span className="stop-list__item-badges">
                            {isSelected && (
                              <span className="stop-list__item-order">{orderIdx + 1}</span>
                            )}
                            <span className="stop-list__item-badge">{getCategoryLabel(stop.category)}</span>
                          </span>
                        </span>
                        {stop.description && (
                          <span className="stop-list__item-desc">{stop.description}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {detourLoading && (
                <p className="verdict-panel__loading">Computing route…</p>
              )}
            </>
          ) : stopError ? (
            <p className="verdict-panel__stop-error">{stopError}</p>
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
            {selectedStops.length > 1 ? `Clear stops (${selectedStops.length})` : "Shortest route"}
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
