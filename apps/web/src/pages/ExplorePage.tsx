import { useState, useCallback, useEffect, useRef } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppFooter } from "../components/AppFooter";
import { BottomSheet } from "../components/BottomSheet";
import { ExploreMap, type SelectedPoi, featureToSelectedPoi } from "../components/explore/ExploreMap";
import { SearchBar } from "../components/explore/SearchBar";
import { GeolocatePrompt } from "../components/GeolocatePrompt";
import { CATEGORY_COLORS, type PlaceCategory } from "../data/places";
import { getPois, type PoiFeature, type PoisResponse } from "../lib/api";
import { useMediaQuery } from "../hooks/useMediaQuery";

const ALL_CATEGORIES: PlaceCategory[] = ["history", "art", "scenic", "culture", "civic"];

const CATEGORY_META: Record<PlaceCategory, { label: string; color: string }> = {
  history: { label: "History",   color: CATEGORY_COLORS.history },
  art:     { label: "Art",       color: CATEGORY_COLORS.art     },
  scenic:  { label: "Scenic",    color: CATEGORY_COLORS.scenic  },
  culture: { label: "Culture",   color: CATEGORY_COLORS.culture },
  civic:   { label: "Landmarks", color: CATEGORY_COLORS.civic   },
};

function defaultActiveCategories(): Set<PlaceCategory> {
  return new Set(ALL_CATEGORIES);
}

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

export function ExplorePage() {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [activeCategories, setActiveCategories] = useState<Set<PlaceCategory>>(defaultActiveCategories);
  const [selectedPoi, setSelectedPoi] = useState<SelectedPoi | null>(null);
  const [pois, setPois] = useState<PoisResponse | null>(null);
  const focusPoiRef = useRef<(feature: PoiFeature) => void>(() => {});
  const geolocateRef = useRef<() => void>(() => {});

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
    focusPoiRef.current(poi);
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

  const peekSummary = pois ? (
    <>{pois.features.length} places · {activeCategories.size} layers</>
  ) : null;

  return (
    <div className="app">
      <AppHeader />
      <div className="app-map-wrapper">
        <div className="map-wrapper">
          <ExploreMap
            activeCategories={activeCategories}
            onPoiSelect={setSelectedPoi}
            pois={pois}
            focusPoiRef={focusPoiRef}
            geolocateRef={geolocateRef}
          />
          <GeolocatePrompt onAccept={() => geolocateRef.current()} />
          {pois && (
            <SearchBar
              pois={pois.features}
              activeCategories={activeCategories}
              onSelect={handleSearchSelect}
            />
          )}
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
  pois,
}: {
  activeCategories: Set<PlaceCategory>;
  onToggle: (cat: PlaceCategory) => void;
  onToggleAll: () => void;
  pois: PoisResponse | null;
}) {
  const allOn = activeCategories.size === ALL_CATEGORIES.length;
  const totalCount = pois?.features.length ?? null;

  const countByCategory = pois
    ? ALL_CATEGORIES.reduce<Record<PlaceCategory, number>>((acc, cat) => {
        acc[cat] = pois.features.filter((f) => f.properties.category === cat).length;
        return acc;
      }, {} as Record<PlaceCategory, number>)
    : null;

  return (
    <div className="explore-panel">
      <div className="explore-panel__header">
        <h2>Explore Santa Fe</h2>
        {totalCount !== null && <p>{totalCount} places — click any dot to learn more.</p>}
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
          const { label, color } = CATEGORY_META[cat];
          const count = countByCategory?.[cat];
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
              {count !== undefined && <span className="explore-legend__count">{count}</span>}
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
