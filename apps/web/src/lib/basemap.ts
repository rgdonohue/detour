// CARTO raster basemap ("light_all", a.k.a. Positron).
// Since 2026-09-23 CARTO stamps "API KEY REQUIRED" on keyless tiles.
// The key is public by design: Vite inlines VITE_* values into the bundle
// at build time, so it must be set on the web service before the build runs.
const CARTO_BASEMAP_KEY: string | undefined = import.meta.env.VITE_CARTO_BASEMAP_KEY;

if (!CARTO_BASEMAP_KEY) {
  console.warn(
    "VITE_CARTO_BASEMAP_KEY is not set; basemap tiles will show an 'API KEY REQUIRED' watermark.",
  );
}

export const BASEMAP_TILES_URL = CARTO_BASEMAP_KEY
  ? `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=${encodeURIComponent(CARTO_BASEMAP_KEY)}`
  : "https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png";
