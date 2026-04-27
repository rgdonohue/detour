import { useState, useRef, useEffect } from "react";
import type { PoiFeature } from "../../lib/api";
import type { PlaceCategory } from "../../data/places";
import { CATEGORY_LABELS } from "../../data/places";

interface SearchBarProps {
  pois: PoiFeature[];
  activeCategories: Set<PlaceCategory>;
  onSelect: (poi: PoiFeature) => void;
}

function toTitleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function SearchBar({ pois, activeCategories, onSelect }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hasQuery = tokens.length > 0;

  const results = hasQuery
    ? pois
        .filter(
          (f) =>
            activeCategories.has(f.properties.category as PlaceCategory) &&
            tokens.every((t) => f.properties.name.toLowerCase().includes(t)),
        )
        .slice(0, 8)
    : [];

  const showDropdown = open && results.length > 0;

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (query) {
        setQuery("");
      }
      setOpen(false);
    }
  };

  const handleClear = () => {
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleSelect = (poi: PoiFeature) => {
    onSelect(poi);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="explore-search" ref={containerRef}>
      <div className="explore-search__input-wrap">
        <input
          ref={inputRef}
          type="search"
          className="explore-search__input"
          placeholder="Search places…"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => hasQuery && setOpen(true)}
          aria-label="Search places"
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            className="explore-search__clear"
            aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleClear}
          >
            ×
          </button>
        )}
      </div>
      {showDropdown && (
        <ul className="explore-search__results">
          {results.map((poi) => {
            const cat = poi.properties.category as PlaceCategory;
            const categoryLabel = CATEGORY_LABELS[cat] ?? cat;
            const secondary =
              poi.properties.address
              ?? (poi.properties.subcategory ? toTitleCase(poi.properties.subcategory) : null);
            const meta = secondary ? `${categoryLabel} · ${secondary}` : categoryLabel;
            return (
              <li key={`${poi.properties.name}-${poi.geometry.coordinates.join(",")}`}>
                <button
                  type="button"
                  className="explore-search__result"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(poi)}
                >
                  <span className="explore-search__result-name">{poi.properties.name}</span>
                  <span className="explore-search__result-meta">{meta}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
