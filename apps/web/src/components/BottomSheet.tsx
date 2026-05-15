import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  computeTargetSnap,
  nextSnapCycle,
  type SnapName,
} from "../lib/bottomSheet";
import { useMediaQuery } from "../hooks/useMediaQuery";

interface BottomSheetProps {
  initialSnap?: SnapName;
  peekSummary?: ReactNode;
  onSnapChange?: (snap: SnapName) => void;
  /** Imperative ref to control the sheet from a parent. */
  controlRef?: { current: { setSnap: (snap: SnapName) => void } | null };
  children: ReactNode;
}

const SNAP_VH = { peek: 0, half: 45, full: 90 } as const; // peek uses px below
const PEEK_PX = 80;
const DRAG_THRESHOLD_PX = 6;
const TRANSITION_MS = 220;

function getSnapPx(snap: SnapName): number {
  if (snap === "peek") return PEEK_PX;
  const vh = SNAP_VH[snap];
  return (window.innerHeight * vh) / 100;
}

export function BottomSheet({
  initialSnap = "half",
  peekSummary,
  onSnapChange,
  controlRef,
  children,
}: BottomSheetProps) {
  const isMobile = useMediaQuery("(max-width: 768px)");

  const [snap, setSnap] = useState<SnapName>(initialSnap);
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const lastYRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const currentHeightRef = useRef(0);

  // Expose imperative setSnap to parents via controlRef
  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = {
      setSnap: (s) => {
        setSnap(s);
      },
    };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef]);

  // Apply snap height to DOM whenever snap changes (idle state)
  useEffect(() => {
    if (!isMobile) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const h = getSnapPx(snap);
    currentHeightRef.current = h;
    sheet.style.transition = `transform ${TRANSITION_MS}ms cubic-bezier(.2,.8,.2,1)`;
    sheet.style.transform = `translateY(calc(100% - ${h}px))`;
    sheet.style.setProperty("--sheet-height", `${h}px`);
    document.documentElement.style.setProperty("--sheet-height", `${h}px`);
    if (onSnapChange) onSnapChange(snap);
  }, [snap, isMobile, onSnapChange]);

  // Recompute snap heights on viewport resize
  useEffect(() => {
    if (!isMobile) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const sheet = sheetRef.current;
        if (!sheet) return;
        const h = getSnapPx(snap);
        currentHeightRef.current = h;
        sheet.style.transform = `translateY(calc(100% - ${h}px))`;
        sheet.style.setProperty("--sheet-height", `${h}px`);
        document.documentElement.style.setProperty("--sheet-height", `${h}px`);
      }, 100);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timer) clearTimeout(timer);
    };
  }, [isMobile, snap]);

  if (!isMobile) {
    return <>{children}</>;
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    draggingRef.current = true;
    startYRef.current = e.clientY;
    lastYRef.current = e.clientY;
    lastTimeRef.current = performance.now();
    startHeightRef.current = currentHeightRef.current || getSnapPx(snap);
    const sheet = sheetRef.current;
    if (sheet) sheet.style.transition = "none";
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const dy = e.clientY - startYRef.current; // positive = moved down = sheet shrinks
    const newHeight = Math.max(
      PEEK_PX,
      Math.min(getSnapPx("full"), startHeightRef.current - dy),
    );
    currentHeightRef.current = newHeight;
    const sheet = sheetRef.current;
    if (sheet) {
      sheet.style.transform = `translateY(calc(100% - ${newHeight}px))`;
      sheet.style.setProperty("--sheet-height", `${newHeight}px`);
      document.documentElement.style.setProperty("--sheet-height", `${newHeight}px`);
    }
    const now = performance.now();
    const dt = now - lastTimeRef.current;
    if (dt > 0) {
      velocityRef.current = (e.clientY - lastYRef.current) / dt;
    }
    lastYRef.current = e.clientY;
    lastTimeRef.current = now;
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const totalDy = Math.abs(e.clientY - startYRef.current);
    const heightPx = currentHeightRef.current;
    if (totalDy < DRAG_THRESHOLD_PX) {
      setSnap((s) => nextSnapCycle(s));
      return;
    }
    const target = computeTargetSnap(heightPx, velocityRef.current, {
      peek: PEEK_PX,
      half: getSnapPx("half"),
      full: getSnapPx("full"),
    });
    setSnap(target);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSnap((s) => nextSnapCycle(s));
    } else if (e.key === "Escape") {
      setSnap("peek");
    }
  };

  return (
    <div className="bottom-sheet" ref={sheetRef} role="region" aria-label="Detail panel">
      <div
        ref={headerRef}
        className="bottom-sheet__header"
        role="button"
        tabIndex={0}
        aria-label="Drag to resize panel, or press Enter to cycle"
        aria-expanded={snap === "full"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={onKeyDown}
      >
        <span className="bottom-sheet__handle" aria-hidden="true" />
        {snap === "peek" && peekSummary && (
          <div className="bottom-sheet__peek-summary">{peekSummary}</div>
        )}
      </div>
      <div className="bottom-sheet__body">{children}</div>
    </div>
  );
}
