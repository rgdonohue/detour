import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { GeolocateState } from "../lib/geo";

const ICON_SVG = `
<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9" />
  <circle cx="12" cy="12" r="2" />
  <line x1="12" y1="1" x2="12" y2="4" />
  <line x1="12" y1="20" x2="12" y2="23" />
  <line x1="1" y1="12" x2="4" y2="12" />
  <line x1="20" y1="12" x2="23" y2="12" />
</svg>`;

const SPINNER_SVG = `
<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" class="locate-control__spinner">
  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
</svg>`;

class LocateControlImpl implements maplibregl.IControl {
  private container: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private onClick: () => void;
  private getState: () => GeolocateState;

  constructor(onClick: () => void, getState: () => GeolocateState) {
    this.onClick = onClick;
    this.getState = getState;
  }

  onAdd(): HTMLElement {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group locate-control";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "locate-control__btn";
    button.setAttribute("aria-label", "Show my location");
    button.addEventListener("click", () => this.onClick());
    this.button = button;
    this.container.appendChild(button);
    this.render();
    return this.container;
  }

  onRemove(): void {
    this.container?.parentNode?.removeChild(this.container);
    this.container = null;
    this.button = null;
  }

  /** Called by the React wrapper after state changes to refresh the button UI. */
  render(): void {
    if (!this.button) return;
    const state = this.getState();
    this.button.innerHTML = state === "requesting" ? SPINNER_SVG : ICON_SVG;
    this.button.disabled = state === "denied";
    this.button.classList.toggle("locate-control__btn--active", state === "ok");
  }
}

interface LocateControlProps {
  map: maplibregl.Map | null;
  state: GeolocateState;
  onClick: () => void;
}

export function LocateControl({ map, state, onClick }: LocateControlProps) {
  const controlRef = useRef<LocateControlImpl | null>(null);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Add/remove the control on map change
  useEffect(() => {
    if (!map) return;
    const control = new LocateControlImpl(
      () => onClickRef.current(),
      () => stateRef.current,
    );
    controlRef.current = control;
    map.addControl(control, "bottom-right");
    return () => {
      map.removeControl(control);
      controlRef.current = null;
    };
  }, [map]);

  // Re-render the button DOM when state changes
  useEffect(() => {
    controlRef.current?.render();
  }, [state]);

  return null;
}
