import type { TourDefinition, TourSummary } from "../types/tour";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export async function getTours(): Promise<TourSummary[]> {
  const res = await fetch(`${API_BASE}/tours`);
  if (!res.ok) throw new Error(`Tours failed: ${res.status}`);
  const data = await res.json();
  return data.tours as TourSummary[];
}

export async function getTour(slug: string): Promise<TourDefinition> {
  const res = await fetch(`${API_BASE}/tours/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Tour not found: ${slug}`);
    throw new Error(`Tour fetch failed: ${res.status}`);
  }
  return res.json();
}
