import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { ExploreMap, type SelectedPoi } from "../components/explore/ExploreMap";
import type { PlaceCategory } from "../data/places";

const ALL_CATEGORIES: PlaceCategory[] = ["history", "art", "scenic", "culture", "civic"];

const CATEGORY_META: Record<PlaceCategory, { label: string; color: string; count: number }> = {
  history: { label: "History",   color: "#9b6b4a", count: 142 },
  art:     { label: "Art",       color: "#8b5e8b", count: 117 },
  scenic:  { label: "Scenic",    color: "#5a8a6a", count: 112 },
  culture: { label: "Culture",   color: "#c2783c", count: 79  },
  civic:   { label: "Landmarks", color: "#6a7d99", count: 65  },
};

function defaultActiveCategories(): Set<PlaceCategory> {
  return new Set(ALL_CATEGORIES);
}

export function ExplorePage() {
  const [activeCategories, setActiveCategories] = useState<Set<PlaceCategory>>(defaultActiveCategories);
  const [selectedPoi, setSelectedPoi] = useState<SelectedPoi | null>(null);

  const handleToggle = useCallback((cat: PlaceCategory) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setActiveCategories((prev) =>
      prev.size === ALL_CATEGORIES.length ? new Set() : defaultActiveCategories(),
    );
  }, []);

  return (
    <div className="app">
      <AppHeader />
      <div className="app-map-wrapper">
        <div className="map-wrapper">
          <ExploreMap activeCategories={activeCategories} onPoiSelect={setSelectedPoi} />
          <aside className="app-sidebar explore-sidebar">
            {selectedPoi ? (
              <PoiDetail
                poi={selectedPoi}
                onClose={() => setSelectedPoi(null)}
              />
            ) : (
              <ExplorePanel
                activeCategories={activeCategories}
                onToggle={handleToggle}
                onToggleAll={handleToggleAll}
              />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function ExplorePanel({
  activeCategories,
  onToggle,
  onToggleAll,
}: {
  activeCategories: Set<PlaceCategory>;
  onToggle: (cat: PlaceCategory) => void;
  onToggleAll: () => void;
}) {
  const allOn = activeCategories.size === ALL_CATEGORIES.length;

  return (
    <div className="explore-panel">
      <div className="explore-panel__header">
        <h2>Explore Santa Fe</h2>
        <p>515 places — click any dot to learn more.</p>
      </div>
      <div className="explore-legend">
        <div className="explore-legend__header">
          <span className="explore-legend__title">Layers</span>
          <button
            type="button"
            className="explore-legend__toggle-all"
            onClick={onToggleAll}
          >
            {allOn ? "Hide all" : "Show all"}
          </button>
        </div>
        {ALL_CATEGORIES.map((cat) => {
          const { label, color, count } = CATEGORY_META[cat];
          const isOn = activeCategories.has(cat);
          return (
            <label key={cat} className={`explore-legend__row${isOn ? "" : " explore-legend__row--off"}`}>
              <input
                type="checkbox"
                className="explore-legend__checkbox"
                checked={isOn}
                onChange={() => onToggle(cat)}
              />
              <span
                className="explore-legend__dot"
                style={{ background: color }}
              />
              <span className="explore-legend__label">{label}</span>
              <span className="explore-legend__count">{count}</span>
            </label>
          );
        })}
      </div>
      <p className="explore-panel__hint">
        Click the map to set a start point and build a route.
      </p>
    </div>
  );
}

function toTitleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function PoiDetail({
  poi,
  onClose,
}: {
  poi: SelectedPoi;
  onClose: () => void;
}) {
  const meta = CATEGORY_META[poi.category as PlaceCategory];
  const label = meta?.label ?? poi.category;
  const color = meta?.color ?? "#999";
  const wikiUrl = poi.wikipedia_title
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(poi.wikipedia_title)}`
    : null;

  // Use card description for high/medium confidence; fall back to map description for low
  const descriptionText =
    poi.confidence !== "low"
      ? (poi.description_card ?? poi.description_map)
      : (poi.description_map ?? poi.description_card);

  const basisTags = poi.basis
    ? poi.basis.split("|").map((t) => t.trim()).filter(Boolean)
    : [];

  return (
    <div className="explore-poi-detail">
      <button
        type="button"
        className="explore-poi-detail__close"
        onClick={onClose}
        aria-label="Back to all places"
      >
        ← All places
      </button>
      <strong className="explore-poi-detail__name">{poi.name}</strong>
      <div className="explore-poi-detail__meta">
        <span
          className="explore-poi-detail__badge"
          style={{ background: color }}
        >
          {label}
        </span>
        {poi.subcategory && (
          <span className="explore-poi-detail__subcategory">
            {toTitleCase(poi.subcategory)}
          </span>
        )}
      </div>
      {descriptionText && (
        <p className="explore-poi-detail__description">{descriptionText}</p>
      )}
      {basisTags.length > 0 && (
        <div className="explore-poi-detail__basis">
          {basisTags.map((tag) => (
            <span key={tag} className="explore-poi-detail__basis-tag">
              {toTitleCase(tag)}
            </span>
          ))}
        </div>
      )}
      <div className="explore-poi-detail__actions">
        {wikiUrl && (
          <a
            href={wikiUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="explore-poi-detail__wiki-link"
          >
            Wikipedia →
          </a>
        )}
        <Link to="/" className="explore-poi-detail__cta">
          Build a route from here →
        </Link>
      </div>
    </div>
  );
}
