import { useState } from "react";
import type { StopSuggestion, TravelMode } from "../lib/api";
import type { PlaceCategory } from "../data/places";
import { CATEGORY_COLORS } from "../data/places";

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
  onFocusStop?: ((stop: StopSuggestion) => void) | null;
  detourLoading?: boolean;
  showingDetour?: boolean;
  shortestRoute?: {
    distance_miles: number;
    duration_seconds: number;
    within_limit: boolean;
  } | null;
  onBackToShortest?: (() => void) | null;
  activeCategories?: Set<PlaceCategory>;
  onToggleCategory?: ((cat: PlaceCategory) => void) | null;
  onToggleAllCategories?: (() => void) | null;
  categoryCounts?: Record<string, number>;
  mode?: TravelMode;
  showAllStops?: boolean;
  onToggleShowAll?: (() => void) | null;
  onPlayTour?: (() => void) | null;
  savingTour?: boolean;
  saveTourError?: string | null;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return "< 1 min";
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
}

const ALL_CATEGORIES: PlaceCategory[] = ["history", "art", "scenic", "culture", "civic"];

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
  onFocusStop = null,
  detourLoading = false,
  showingDetour = false,
  shortestRoute = null,
  onBackToShortest = null,
  activeCategories,
  onToggleCategory = null,
  onToggleAllCategories = null,
  categoryCounts = {},
  mode = "walk",
  showAllStops = false,
  onToggleShowAll = null,
  onPlayTour = null,
  savingTour = false,
  saveTourError = null,
}: VerdictPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — silently no-op
    }
  };

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
      {(() => {
        const headerActions = (
          <div className="verdict-panel__header-actions">
            <button
              type="button"
              className="verdict-panel__header-link"
              onClick={handleCopyShareLink}
              aria-live="polite"
              title="Copy an editor link with your current stops"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <button
              type="button"
              className="verdict-panel__header-link"
              onClick={onReset}
            >
              Reset
            </button>
          </div>
        );

        if (showingDetour && selectedStops.length > 0) {
          return (
            <div className="verdict-panel__detour-header">
              <h3 className="verdict-panel__title">
                {selectedStops.length === 1
                  ? `Via ${selectedStops[0].name}`
                  : `Via ${selectedStops.length} stops`}
              </h3>
              <div className="verdict-panel__head-row">
                {!isLoading && <span className={statusClass}>{statusText}</span>}
                {headerActions}
              </div>
            </div>
          );
        }

        return (
          <div className="verdict-panel__head">
            <span className="verdict-panel__label">Route</span>
            {!isLoading && <span className={statusClass}>{statusText}</span>}
            {headerActions}
          </div>
        );
      })()}

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

      {/* Preview tour CTA — primary action when a detour route with stops exists */}
      {!isLoading && !error && selectedStops.length >= 1 && onPlayTour && (
        <div className="verdict-panel__play-cta">
          <button
            type="button"
            className="verdict-panel__btn-primary"
            onClick={onPlayTour}
            disabled={savingTour}
            aria-busy={savingTour}
          >
            {savingTour ? "Saving…" : "Preview tour"}
          </button>
          {saveTourError && (
            <p className="verdict-panel__save-error" role="alert">
              {saveTourError}
            </p>
          )}
        </div>
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
          <p className="itinerary-summary__label">Itinerary</p>
          <ol className="itinerary-summary__list">
            {selectedStops.map((stop, i) => (
              <li key={stop.name} className="itinerary-summary__row">
                <button
                  type="button"
                  className="itinerary-summary__item"
                  onClick={() => onFocusStop?.(stop)}
                >
                  <span className="itinerary-summary__order">{i + 1}</span>
                  <span className="itinerary-summary__name">{stop.name}</span>
                  <span className="itinerary-summary__badge">{getCategoryLabel(stop.category)}</span>
                </button>
                <button
                  type="button"
                  className="itinerary-summary__remove"
                  onClick={() => onSelectStop?.(stop)}
                  aria-label={`Remove ${stop.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Stop layers panel + suggestions list */}
      {!isLoading && (
        <div className="verdict-panel__stop">
          <div className="verdict-panel__layers">
            <div className="verdict-panel__layers-header">
              <span className="verdict-panel__layers-title">Stops</span>
              {onToggleAllCategories && (
                <button
                  type="button"
                  className="verdict-panel__layers-toggle-all"
                  onClick={onToggleAllCategories}
                >
                  {activeCategories?.size === ALL_CATEGORIES.length ? "Hide all" : "Show all"}
                </button>
              )}
            </div>
            {onToggleCategory && (
              <>
                {ALL_CATEGORIES.map((cat) => {
                  const isOn = activeCategories?.has(cat) ?? true;
                  const color = CATEGORY_COLORS[cat];
                  const count = categoryCounts[cat] ?? 0;
                  return (
                    <label
                      key={cat}
                      className={`verdict-panel__layer-row${isOn ? "" : " verdict-panel__layer-row--off"}`}
                    >
                      <input
                        type="checkbox"
                        className="verdict-panel__layer-checkbox"
                        checked={isOn}
                        onChange={() => onToggleCategory(cat)}
                      />
                      <span
                        className={`verdict-panel__layer-switch${isOn ? " verdict-panel__layer-switch--on" : ""}`}
                        style={isOn ? { background: color } : undefined}
                        aria-hidden="true"
                      >
                        <span className="verdict-panel__layer-switch-thumb" />
                      </span>
                      <span className="verdict-panel__layer-label">
                        {CATEGORY_LABELS[cat]}
                      </span>
                      <span className="verdict-panel__layer-count">{count}</span>
                    </label>
                  );
                })}
                <label className="verdict-panel__layer-row">
                  <input
                    type="checkbox"
                    className="verdict-panel__layer-checkbox"
                    checked={showAllStops}
                    onChange={() => onToggleShowAll?.()}
                  />
                  <span
                    className={`verdict-panel__layer-switch${showAllStops ? " verdict-panel__layer-switch--on" : ""}`}
                    style={showAllStops ? { background: "var(--text-secondary)" } : undefined}
                    aria-hidden="true"
                  >
                    <span className="verdict-panel__layer-switch-thumb" />
                  </span>
                  <span className="verdict-panel__layer-label">All pins</span>
                </label>
              </>
            )}
          </div>

          {stopLoading ? (
            <p className="verdict-panel__loading">Finding stops…</p>
          ) : nearbyStops.length > 0 ? (
            <>
              <ul className="stop-list">
                {nearbyStops.map((stop) => {
                  const orderIdx = selectedStops.findIndex((s) => s.name === stop.name);
                  const isSelected = orderIdx >= 0;
                  return (
                    <li key={stop.poi_id ?? stop.name}>
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
                        {stop.subcategory && (
                          <span className="stop-list__item-subcategory">
                            {stop.subcategory.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                          </span>
                        )}
                        {stop.address && (
                          <span className="stop-list__item-address">{stop.address}</span>
                        )}
                        {(() => {
                          const desc =
                            stop.confidence !== "low"
                              ? (stop.description_card ?? stop.description_map ?? stop.description)
                              : (stop.description_map ?? stop.description_card ?? stop.description);
                          return desc ? (
                            <span className="stop-list__item-desc">{desc}</span>
                          ) : null;
                        })()}
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
              No stops within range of this route
            </p>
          )}
        </div>
      )}

      {onBackToShortest && (
        <div className="verdict-panel__actions">
          <button
            type="button"
            className="verdict-panel__btn-secondary"
            onClick={onBackToShortest}
          >
            {selectedStops.length > 1 ? `Clear stops (${selectedStops.length})` : "Shortest route"}
          </button>
        </div>
      )}
    </div>
  );
}
