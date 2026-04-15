import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { AppFooter } from "../components/AppFooter";
import { getTours } from "../lib/tourApi";
import type { TourSummary } from "../types/tour";

export function TourGallery() {
  const [tours, setTours] = useState<TourSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTours()
      .then(setTours)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load tours"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="app">
      <AppHeader />

      <div className="tour-gallery">
        <div className="tour-gallery__header">
          <h2 className="tour-gallery__title">Curated Tours</h2>
          <p className="tour-gallery__subtitle">
            Hand-crafted walking routes through Santa Fe's historic neighborhoods.
          </p>
        </div>

        {loading && <p className="tour-gallery__loading">Loading tours…</p>}
        {error && <p className="tour-gallery__error">{error}</p>}

        {!loading && !error && (
          <div className="tour-gallery__grid">
            {tours.map((tour) => (
              <TourCard key={tour.slug} tour={tour} />
            ))}
          </div>
        )}
      </div>
      <AppFooter />
    </div>
  );
}

function TourCard({ tour }: { tour: TourSummary }) {
  const hours = Math.floor(tour.duration_minutes / 60);
  const mins = tour.duration_minutes % 60;
  const durationLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return (
    <Link to={`/tours/${tour.slug}`} className="tour-card">
      <div className="tour-card__mode">
        {tour.mode === "walk" ? "Walking" : "Driving"}
      </div>
      <h3 className="tour-card__name">{tour.name}</h3>
      <p className="tour-card__tagline">{tour.tagline}</p>
      <div className="tour-card__stats">
        <span>{tour.distance_miles.toFixed(1)} mi</span>
        <span className="tour-card__sep">·</span>
        <span>{durationLabel}</span>
        <span className="tour-card__sep">·</span>
        <span>{tour.stop_count} stops</span>
      </div>
    </Link>
  );
}
