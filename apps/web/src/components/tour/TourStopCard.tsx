import type { TourStop } from "../../types/tour";

const CATEGORY_LABELS: Record<string, string> = {
  history: "Historic",
  art: "Art",
  scenic: "Scenic",
  culture: "Culture",
  civic: "Landmark",
};

interface TourStopCardProps {
  stop: TourStop;
  isActive: boolean;
  onClick: () => void;
}

export function TourStopCard({ stop, isActive, onClick }: TourStopCardProps) {
  return (
    <button
      type="button"
      className={`tour-stop-card${isActive ? " tour-stop-card--active" : ""}`}
      onClick={onClick}
    >
      <div className="tour-stop-card__order">{stop.order}</div>
      <div className="tour-stop-card__body">
        <div className="tour-stop-card__header">
          <span className="tour-stop-card__name">{stop.name}</span>
          <span className="tour-stop-card__badge">
            {CATEGORY_LABELS[stop.category] ?? stop.category}
          </span>
        </div>
        <p className="tour-stop-card__desc">{stop.description}</p>
      </div>
    </button>
  );
}
