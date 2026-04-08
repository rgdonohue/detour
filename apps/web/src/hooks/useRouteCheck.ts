import { useState, useCallback, useRef } from "react";
import { getRoute, type RouteResponse, type TravelMode } from "../lib/api";

export interface RouteCheckResult {
  route: RouteResponse["route"];
  distance_miles: number;
  duration_seconds: number;
  within_limit: boolean;
}

export function useRouteCheck() {
  const [result, setResult] = useState<RouteCheckResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const checkRoute = useCallback(async (
    destLon: number,
    destLat: number,
    miles?: number,
    originLon?: number,
    originLat?: number,
    mode?: TravelMode,
  ) => {
    controllerRef.current?.abort();
    controllerRef.current = new AbortController();
    const signal = controllerRef.current.signal;

    setError(null);
    setIsLoading(true);

    try {
      const data = await getRoute(destLon, destLat, miles, originLon, originLat, undefined, mode, signal);
      setResult({
        route: data.route,
        distance_miles: data.distance_miles,
        duration_seconds: data.duration_seconds,
        within_limit: data.within_limit,
      });
      return data;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      const message =
        err instanceof Error ? err.message : "Route check unavailable, try again";
      setError(message);
      setResult(null);
      throw err;
    } finally {
      if (!signal.aborted) setIsLoading(false);
    }
  }, []);

  const clearResult = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setResult(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return {
    checkRoute,
    clearResult,
    result,
    isLoading,
    error,
  };
}
