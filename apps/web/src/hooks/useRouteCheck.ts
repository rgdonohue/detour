import { useState, useCallback } from "react";
import { getRoute, type RouteResponse } from "../lib/api";

export interface RouteCheckResult {
  route: RouteResponse["route"];
  distance_miles: number;
  within_limit: boolean;
}

export function useRouteCheck() {
  const [result, setResult] = useState<RouteCheckResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkRoute = useCallback(async (lon: number, lat: number) => {
    setError(null);
    setIsLoading(true);

    try {
      const data = await getRoute(lon, lat);
      setResult({
        route: data.route,
        distance_miles: data.distance_miles,
        within_limit: data.within_limit,
      });
      return data;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Route check unavailable, try again";
      setError(message);
      setResult(null);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearResult = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    checkRoute,
    clearResult,
    result,
    isLoading,
    error,
  };
}
