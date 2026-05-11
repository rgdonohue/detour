import { useRef, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { Map } from "./components/Map";
import { ModeToggle } from "./components/ModeToggle";
import { AppHeader } from "./components/AppHeader";
import { AppFooter } from "./components/AppFooter";
import { TourGallery } from "./pages/TourGallery";
import { TourStoryMap } from "./pages/TourStoryMap";
import { ExplorePage } from "./pages/ExplorePage";
import { parseShareableRouteState } from "./lib/urlState";
import type { TravelMode } from "./lib/api";

function BuilderPage() {
  const [mode, setMode] = useState<TravelMode>(() =>
    parseShareableRouteState().mode,
  );
  const resetRef = useRef<() => void>(() => {});
  const modeChangeRef = useRef<(m: TravelMode) => void>((m) => setMode(m));

  return (
    <div className="app">
      <AppHeader />
      <div className="app-mode-toggle-mobile">
        <ModeToggle mode={mode} onChange={(m) => modeChangeRef.current(m)} />
      </div>
      <div className="app-map-wrapper">
        <Map
          resetRef={resetRef}
          modeChangeRef={modeChangeRef}
          mode={mode}
          onModeChange={setMode}
        />
      </div>
      <AppFooter />
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<ExplorePage />} />
      <Route path="/build" element={<BuilderPage />} />
      <Route path="/tours" element={<TourGallery />} />
      <Route path="/tours/:slug" element={<TourStoryMap />} />
    </Routes>
  );
}

export default App;
