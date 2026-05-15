import { useEffect, useState } from "react";

const FLAG_KEY = "detour.geo_prompted";

interface GeolocatePromptProps {
  onAccept: () => void;
}

function readFlag(): boolean {
  try {
    return localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return true; // localStorage blocked — don't show
  }
}

function writeFlag(): void {
  try {
    localStorage.setItem(FLAG_KEY, "1");
  } catch {
    // ignore
  }
}

export function GeolocatePrompt({ onAccept }: GeolocatePromptProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    if (readFlag()) return;
    const t = setTimeout(() => setVisible(true), 500);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    writeFlag();
    setVisible(false);
  };

  const accept = () => {
    writeFlag();
    setVisible(false);
    onAccept();
  };

  return (
    <div className="geolocate-prompt" role="dialog" aria-label="Use your location?">
      <span className="geolocate-prompt__text">Use your location to center the map?</span>
      <div className="geolocate-prompt__actions">
        <button type="button" className="geolocate-prompt__btn" onClick={accept}>
          Use my location
        </button>
        <button
          type="button"
          className="geolocate-prompt__btn geolocate-prompt__btn--secondary"
          onClick={dismiss}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
