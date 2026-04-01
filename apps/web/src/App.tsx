import { useState } from "react";
import { Map } from "./components/Map";
import { DistancePresets } from "./components/DistancePresets";
import { getInitialMilesFromUrl } from "./lib/urlState";

const MILE_PRESETS = [1, 3, 5];

function App() {
  const [selectedMiles, setSelectedMiles] = useState(() =>
    getInitialMilesFromUrl(MILE_PRESETS, 3),
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>The Long Way Home</h1>
        <p>Place-aware routing in Santa Fe</p>
      </header>
      <DistancePresets
        presets={MILE_PRESETS}
        selected={selectedMiles}
        onChange={setSelectedMiles}
      />
      <div className="app-map-wrapper">
        <Map miles={selectedMiles} />
      </div>
    </div>
  );
}

export default App;
