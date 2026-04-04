import { useRef, useState } from "react";
import { Map } from "./components/Map";
import { parseShareableRouteState } from "./lib/urlState";
import type { TravelMode } from "./lib/api";

function App() {
  const [mode, setMode] = useState<TravelMode>(() =>
    parseShareableRouteState().mode,
  );
  const resetRef = useRef<() => void>(() => {});

  return (
    <div className="app">
      <header className="app-header">
        <h1>The Long Way Home</h1>
        <p>Place-aware routing in Santa Fe</p>
        <button
          type="button"
          className="header-reset-btn"
          onClick={() => resetRef.current()}
        >
          Reset
        </button>
      </header>
      <div className="app-map-wrapper">
        <Map
          resetRef={resetRef}
          mode={mode}
          onModeChange={setMode}
        />
      </div>
    </div>
  );
}

export default App;
