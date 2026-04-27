import { useState, useCallback, useEffect, useRef } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppFooter } from "../components/AppFooter";
import { ExploreMap, type SelectedPoi, featureToSelectedPoi } from "../components/explore/ExploreMap";
import { SearchBar } from "../components/explore/SearchBar";
import { CATEGORY_COLORS, type PlaceCategory } from "../data/places";
import { getPois, type PoiFeature, type PoisResponse } from "../lib/api";

const ALL_CATEGORIES: PlaceCategory[] = ["history", "art", "scenic", "culture", "civic"];

const CATEGORY_META: Record<PlaceCategory, { label: string; color: string; count: number }> = {
  history: { label: "History",   color: CATEGORY_COLORS.history, count: 142 },
  art:     { label: "Art",       color: CATEGORY_COLORS.art,     count: 117 },
  scenic:  { label: "Scenic",    color: CATEGORY_COLORS.scenic,  count: 112 },
  culture: { label: "Culture",   color: CATEGORY_COLORS.culture, count: 79  },
  civic:   { label: "Landmarks", color: CATEGORY_COLORS.civic,   count: 65  },
};

function defaultActiveCategories(): Set<PlaceCategory> {
  return new Set(ALL_CATEGORIES);
}

export function ExplorePage() {
  const [activeCategories, setActiveCategories] = useState<Set<PlaceCategory>>(defaultActiveCategories);
  const [selectedPoi, setSelectedPoi] = useState<SelectedPoi | null>(null);
  const [pois, setPois] = useState<PoisResponse | null>(null);
  const flyToRef = useRef<(coords: [number, number]) => void>(() => {});

  useEffect(() => {
    getPois().then(setPois).catch((err) => console.warn("Failed to load POIs:", err));
  }, []);

  // displayedPoi is what's actually in the DOM; selectedPoi is the intent.
  // They diverge during the fade-out phase of a transition.
  const [displayedPoi, setDisplayedPoi] = useState<SelectedPoi | null>(null);
  const [fadingOut, setFadingOut] = useState(false);
  const displayedPoiRef = useRef<SelectedPoi | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (transitionTimer.current) {
      clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
    }

    const current = displayedPoiRef.current;
    const isSame = current?.name === selectedPoi?.name;

    if (current === null || isSame) {
      // First show or same POI re-clicked — no transition needed
      displayedPoiRef.current = selectedPoi;
      setDisplayedPoi(selectedPoi);
    } else {
      // Fade out current, then swap in the new one
      setFadingOut(true);
      transitionTimer.current = setTimeout(() => {
        displayedPoiRef.current = selectedPoi;
        setDisplayedPoi(selectedPoi);
        setFadingOut(false);
        transitionTimer.current = null;
      }, 180);
    }
  }, [selectedPoi]);

  const handleSearchSelect = useCallback((poi: PoiFeature) => {
    setSelectedPoi(featureToSelectedPoi(poi));
    flyToRef.current(poi.geometry.coordinates as [number, number]);
  }, []);

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
          <ExploreMap
            activeCategories={activeCategories}
            onPoiSelect={setSelectedPoi}
            pois={pois}
            flyToRef={flyToRef}
          />
          {pois && (
            <SearchBar
              pois={pois.features}
              activeCategories={activeCategories}
              onSelect={handleSearchSelect}
            />
          )}
          <aside className="app-sidebar explore-sidebar">
            <ExplorePanel
              activeCategories={activeCategories}
              onToggle={handleToggle}
              onToggleAll={handleToggleAll}
            />
            {!displayedPoi && (
              <div className="explore-intro">
                <p>
                  Santa Fe's 400-year story is written into its streets, walls,
                  and landscape. This map plots 515 places across five
                  categories — from sites on the National Register to scenic
                  overlooks and public art.
                </p>
                <p className="explore-intro__cta">Click any dot to learn more.</p>
              </div>
            )}
            {displayedPoi && (
              <PoiDetail
                key={displayedPoi.name}
                poi={displayedPoi}
                fadingOut={fadingOut}
              />
            )}
          </aside>
        </div>
      </div>
      <AppFooter />
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
                className={`explore-legend__switch${isOn ? " explore-legend__switch--on" : ""}`}
                style={isOn ? { background: color } : undefined}
                aria-hidden="true"
              >
                <span className="explore-legend__switch-thumb" />
              </span>
              <span className="explore-legend__label">{label}</span>
              <span className="explore-legend__count">{count}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function toTitleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function PoiDetail({ poi, fadingOut }: { poi: SelectedPoi; fadingOut: boolean }) {
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
    <div className={`explore-poi-detail${fadingOut ? " explore-poi-detail--fade-out" : ""}`}>
      <strong className="explore-poi-detail__name">{poi.name}</strong>
      {poi.address && (
        <div className="explore-poi-detail__address">{poi.address}</div>
      )}
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
    </div>
  );
}
