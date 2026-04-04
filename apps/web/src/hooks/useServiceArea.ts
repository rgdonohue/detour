import { useEffect, useState } from "react";
import { getArea, type AreaResponse, type TravelMode } from "../lib/api";

export function useServiceArea(
  originLon?: number,
  originLat?: number,
  mode?: TravelMode,
) {
  const [polygon, setPolygon] = useState<AreaResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (originLon === undefined || originLat === undefined) {
      setPolygon(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setError(null);
    setIsLoading(true);

    getArea(originLon, originLat, mode)
      .then((data) => {
        if (!cancelled) {
          setPolygon(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPolygon(null);
          setError(err instanceof Error ? err.message : "Failed to load area");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [originLon, originLat, mode]);

  return { polygon, isLoading, error };
}
