import { useState } from "react";

export function Legend() {
  const [expanded, setExpanded] = useState(
    () => typeof window !== "undefined" && !window.matchMedia("(max-width: 768px)").matches
  );

  return (
    <div className={`legend ${expanded ? "legend--expanded" : "legend--collapsed"}`}>
      <button
        type="button"
        className="legend__toggle"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse legend" : "Expand legend"}
      >
        {expanded ? "×" : "ℹ️"}
      </button>
      {expanded && (
        <>
          <div className="legend-row">
            <span className="legend-swatch legend-marker" aria-hidden />
            <span>Coverage area — 3-mile driving distance along streets</span>
          </div>
          <p className="legend-footnote">
            Tap anywhere on the map to check if a destination is within range. Route
            distance is the official determination.
          </p>
        </>
      )}
    </div>
  );
}
