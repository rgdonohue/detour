import type { TravelMode } from "../lib/api";

interface ModeToggleProps {
  mode: TravelMode;
  onChange: (mode: TravelMode) => void;
}

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className="mode-toggle" role="radiogroup" aria-label="Travel mode">
      <button
        type="button"
        role="radio"
        aria-checked={mode === "walk"}
        className={`mode-toggle__btn${mode === "walk" ? " mode-toggle__btn--active" : ""}`}
        onClick={() => onChange("walk")}
      >
        Walk
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "drive"}
        className={`mode-toggle__btn${mode === "drive" ? " mode-toggle__btn--active" : ""}`}
        onClick={() => onChange("drive")}
      >
        Drive
      </button>
    </div>
  );
}
