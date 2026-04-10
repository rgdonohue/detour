import { Link } from "react-router-dom";
import type { TourDefinition } from "../../types/tour";
import { TourStopCard } from "./TourStopCard";

interface TourPanelProps {
  tour: TourDefinition;
  activeStopIndex: number | null;
  onStopClick: (index: number) => void;
}

export function TourPanel({ tour, activeStopIndex, onStopClick }: TourPanelProps) {
  const hours = Math.floor(tour.duration_minutes / 60);
  const mins = tour.duration_minutes % 60;
  const durationLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return (
    <div className="app-sidebar tour-panel">
      <div className="tour-panel__meta">
        <Link to="/tours" className="tour-panel__back">
          ← All tours
        </Link>
        <h2 className="tour-panel__name">{tour.name}</h2>
        <p className="tour-panel__tagline">{tour.tagline}</p>
        <div className="tour-panel__stats">
          <span className="tour-panel__stat">{tour.distance_miles.toFixed(1)} mi</span>
          <span className="tour-panel__stat-sep">·</span>
          <span className="tour-panel__stat">{durationLabel}</span>
          <span className="tour-panel__stat-sep">·</span>
          <span className="tour-panel__stat">{tour.stops.length} stops</span>
          <span className="tour-panel__stat-sep">·</span>
          <span className="tour-panel__mode-badge">
            {tour.mode === "walk" ? "Walking" : "Driving"}
          </span>
        </div>
        <p className="tour-panel__desc">{tour.description}</p>
      </div>

      <div className="tour-panel__stops-label">Stops</div>

      <div className="tour-panel__stops">
        {tour.stops.map((stop, i) => (
          <TourStopCard
            key={stop.order}
            stop={stop}
            isActive={activeStopIndex === i}
            onClick={() => onStopClick(i)}
          />
        ))}
      </div>

      <div className="tour-panel__footer">
        <Link to="/" className="tour-panel__build-link">
          Build your own route
        </Link>
      </div>
    </div>
  );
}
