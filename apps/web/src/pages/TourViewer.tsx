import { useEffect, useReducer, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getTour } from "../lib/tourApi";
import type { TourDefinition } from "../types/tour";
import { TourMap } from "../components/tour/TourMap";
import { TourPanel } from "../components/tour/TourPanel";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; tour: TourDefinition };

function tourReducer(_: LoadState, action: LoadState): LoadState {
  return action;
}

export function TourViewer() {
  const { slug } = useParams<{ slug: string }>();
  const [state, dispatch] = useReducer(tourReducer, { status: "loading" });
  const [activeStopIndex, setActiveStopIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!slug) return;
    dispatch({ status: "loading" });
    getTour(slug)
      .then((tour) => dispatch({ status: "ok", tour }))
      .catch((e: unknown) =>
        dispatch({ status: "error", message: e instanceof Error ? e.message : "Failed to load tour" })
      );
  }, [slug]);

  if (state.status === "loading") {
    return (
      <div className="app">
        <TourHeader />
        <div className="map-loading">Loading tour…</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="app">
        <TourHeader />
        <div className="map-error">
          {state.message}
          <Link to="/tours" style={{ marginLeft: "0.5rem" }}>Browse tours</Link>
        </div>
      </div>
    );
  }

  const { tour } = state;

  return (
    <div className="app">
      <TourHeader />
      <div className="app-map-wrapper">
        <div className="map-wrapper">
          <TourMap
            tour={tour}
            activeStopIndex={activeStopIndex}
            onStopClick={setActiveStopIndex}
          />
          <TourPanel
            tour={tour}
            activeStopIndex={activeStopIndex}
            onStopClick={setActiveStopIndex}
          />
        </div>
      </div>
    </div>
  );
}

function TourHeader() {
  return (
    <header className="app-header">
      <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
        <h1>Santa Fe Detour</h1>
      </Link>
      <p>routes shaped by place</p>
      <Link to="/tours" className="header-reset-btn">
        Tours
      </Link>
    </header>
  );
}
