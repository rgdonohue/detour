import { Map } from "./components/Map";

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>What's Within 3-Mile Driving Distance?</h1>
        <p>Santa Fe, NM</p>
      </header>
      <div className="app-map-wrapper">
        <Map />
      </div>
    </div>
  );
}

export default App;
