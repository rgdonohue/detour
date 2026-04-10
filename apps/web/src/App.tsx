import { useRef, useState } from "react";
import { Routes, Route, Link } from "react-router-dom";
import { Map } from "./components/Map";
import { ModeToggle } from "./components/ModeToggle";
import { TourGallery } from "./pages/TourGallery";
import { TourViewer } from "./pages/TourViewer";
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
      <header className="app-header">
        <h1>Santa Fe Detour</h1>
        <p>routes shaped by place</p>
        <Link to="/tours" className="header-reset-btn" style={{ textDecoration: "none" }}>
          Tours
        </Link>
        <button
          type="button"
          className="header-reset-btn"
          onClick={() => resetRef.current()}
        >
          Reset
        </button>
      </header>
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
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<BuilderPage />} />
      <Route path="/tours" element={<TourGallery />} />
      <Route path="/tours/:slug" element={<TourViewer />} />
    </Routes>
  );
}

export default App;
