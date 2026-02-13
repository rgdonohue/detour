interface VerdictPanelProps {
  distance_miles: number;
  within_limit: boolean;
  isLoading?: boolean;
  error?: string | null;
  onReset: () => void;
}

export function VerdictPanel({
  distance_miles,
  within_limit,
  isLoading = false,
  error = null,
  onReset,
}: VerdictPanelProps) {
  const accentColor = within_limit ? "var(--route-within)" : "var(--route-outside)";

  if (error) {
    const isNoRoute = /no route|not found|unreachable|404/i.test(error);
    const isNetwork = /unable to connect|internet connection/i.test(error);
    const message = isNoRoute
      ? "No driving route to this location"
      : isNetwork
        ? "Unable to connect. Check your internet connection."
        : "Route check unavailable, try again";

    return (
      <div
        className="verdict-panel verdict-panel--visible verdict-panel--error"
        role="region"
        aria-label="Route check result"
      >
        <h3 className="verdict-panel__title">📍 Selected Destination</h3>
        <p className="verdict-panel__message" aria-live="polite">
          {message}
        </p>
        <button
          type="button"
          className="verdict-panel__reset"
          onClick={onReset}
        >
          Reset View
        </button>
      </div>
    );
  }

  const verdictText = within_limit
    ? "Within 3-mile range"
    : "Outside 3-mile range";

  return (
    <div
      className="verdict-panel verdict-panel--visible"
      role="region"
      aria-label="Route check result"
      aria-live="polite"
      style={{ "--verdict-accent": accentColor } as React.CSSProperties}
    >
      <h3 className="verdict-panel__title">📍 Selected Destination</h3>

      {isLoading ? (
        <p className="verdict-panel__loading">Computing route…</p>
      ) : (
        <>
          <p className="verdict-panel__distance">
            Distance:{" "}
            <span className="verdict-panel__value tabular-nums">
              {distance_miles.toFixed(1)} miles
            </span>
          </p>
          <p className="verdict-panel__verdict" aria-label={verdictText}>
            {within_limit ? (
              <>
                <span className="verdict-panel__icon" aria-hidden>✅</span>{" "}
                {verdictText}
              </>
            ) : (
              <>
                <span className="verdict-panel__icon" aria-hidden>❌</span>{" "}
                {verdictText}
                <span className="verdict-panel__note">
                  {" "}— Spots inside the shaded area can exceed 3 mi by road
                </span>
              </>
            )}
          </p>
        </>
      )}

      <button
        type="button"
        className="verdict-panel__reset"
        onClick={onReset}
      >
        Reset View
      </button>
    </div>
  );
}
