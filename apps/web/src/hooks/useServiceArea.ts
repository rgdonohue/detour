import { useEffect, useRef, useState } from "react";
import { ApiError, getArea, type AreaResponse, type TravelMode } from "../lib/api";

// Surface area-fetch failures so the UI can render a non-blocking message
// instead of silently dropping the distance rings. Codex flagged this as
// one of the original HN-spike failure modes.
//
// The error is stored together with the request key it belongs to, so an
// error from a previous origin/mode is never shown for the current one —
// no reset-on-change effect needed.
interface AreaError {
  key: string;
  message: string;
  retryAfterSeconds: number | null;
}

function requestKey(originLon?: number, originLat?: number, mode?: TravelMode): string {
  return `${originLon},${originLat},${mode}`;
}

export function useServiceArea(
  originLon?: number,
  originLat?: number,
  mode?: TravelMode,
) {
  const [polygon, setPolygon] = useState<AreaResponse | null>(null);
  const [areaError, setAreaError] = useState<AreaError | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;

    if (originLon === undefined || originLat === undefined) {
      return;
    }

    const key = requestKey(originLon, originLat, mode);
    controllerRef.current = new AbortController();
    const { signal } = controllerRef.current;

    getArea(originLon, originLat, mode, signal)
      .then((data) => {
        setPolygon(data);
        setAreaError(null);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setPolygon(null);
        if (err instanceof ApiError) {
          setAreaError({
            key,
            message: err.message,
            retryAfterSeconds: err.retryAfterSeconds ?? null,
          });
        } else if (err instanceof Error) {
          setAreaError({ key, message: err.message, retryAfterSeconds: null });
        } else {
          setAreaError({ key, message: "Distance rings unavailable", retryAfterSeconds: null });
        }
      });

    return () => {
      controllerRef.current?.abort();
    };
  }, [originLon, originLat, mode]);

  const hasOrigin = originLon !== undefined && originLat !== undefined;
  const currentError =
    hasOrigin && areaError && areaError.key === requestKey(originLon, originLat, mode)
      ? areaError
      : null;
  return {
    polygon: hasOrigin ? polygon : null,
    error: currentError ? currentError.message : null,
    retryAfterSeconds: currentError ? currentError.retryAfterSeconds : null,
  };
}
