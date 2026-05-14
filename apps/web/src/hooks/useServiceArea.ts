import { useEffect, useRef, useState } from "react";
import { ApiError, getArea, type AreaResponse, type TravelMode } from "../lib/api";

export function useServiceArea(
  originLon?: number,
  originLat?: number,
  mode?: TravelMode,
) {
  const [polygon, setPolygon] = useState<AreaResponse | null>(null);
  // Surface area-fetch failures so the UI can render a non-blocking message
  // instead of silently dropping the distance rings. Codex flagged this as
  // one of the original HN-spike failure modes.
  const [error, setError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setError(null);
    setRetryAfterSeconds(null);

    if (originLon === undefined || originLat === undefined) {
      return;
    }

    controllerRef.current = new AbortController();
    const { signal } = controllerRef.current;

    getArea(originLon, originLat, mode, signal)
      .then((data) => {
        setPolygon(data);
        setError(null);
        setRetryAfterSeconds(null);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setPolygon(null);
        if (err instanceof ApiError) {
          setError(err.message);
          if (err.retryAfterSeconds !== undefined) {
            setRetryAfterSeconds(err.retryAfterSeconds);
          }
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Distance rings unavailable");
        }
      });

    return () => {
      controllerRef.current?.abort();
    };
  }, [originLon, originLat, mode]);

  const hasOrigin = originLon !== undefined && originLat !== undefined;
  return {
    polygon: hasOrigin ? polygon : null,
    error: hasOrigin ? error : null,
    retryAfterSeconds: hasOrigin ? retryAfterSeconds : null,
  };
}
