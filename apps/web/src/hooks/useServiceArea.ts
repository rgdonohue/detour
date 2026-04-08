import { useEffect, useRef, useState } from "react";
import { getArea, type AreaResponse, type TravelMode } from "../lib/api";

export function useServiceArea(
  originLon?: number,
  originLat?: number,
  mode?: TravelMode,
) {
  const [polygon, setPolygon] = useState<AreaResponse | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;

    if (originLon === undefined || originLat === undefined) {
      return;
    }

    controllerRef.current = new AbortController();
    const { signal } = controllerRef.current;

    getArea(originLon, originLat, mode, signal)
      .then((data) => setPolygon(data))
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setPolygon(null);
      });

    return () => {
      controllerRef.current?.abort();
    };
  }, [originLon, originLat, mode]);

  const hasOrigin = originLon !== undefined && originLat !== undefined;
  return { polygon: hasOrigin ? polygon : null };
}
