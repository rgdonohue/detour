import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

interface ShareModalProps {
  url: string;
  title: string;
  onClose: () => void;
}

const QR_PIXEL_SIZE = 220;

export function ShareModal({ url, title, onClose }: ShareModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  // Web Share API is gated behind canShare — desktop browsers expose share but
  // throw NotAllowedError on invocation. Render the button only on mobile-ish.
  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ url, title });

  // Render the QR code each time the url changes.
  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: QR_PIXEL_SIZE,
      margin: 1,
      // Match the app's warm-earth palette
      color: { dark: "#2c1810", light: "#fdfaf3" },
    }).catch(() => {
      // QR errors are unrecoverable here; the URL is still copyable.
    });
  }, [url]);

  // Initial focus + Escape-to-close
  useEffect(() => {
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — user can still long-press the URL.
    }
  };

  const handleNativeShare = async () => {
    try {
      await navigator.share({ url, title });
    } catch {
      // User dismissed or share failed — silently no-op.
    }
  };

  return (
    <div
      className="share-modal__backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="share-modal__card">
        <button
          ref={closeBtnRef}
          type="button"
          className="share-modal__close"
          onClick={onClose}
          aria-label="Close share dialog"
        >
          ×
        </button>
        <h2 id="share-modal-title" className="share-modal__title">
          Share this tour
        </h2>
        <p className="share-modal__subtitle">{title}</p>
        <canvas
          ref={canvasRef}
          className="share-modal__qr"
          width={QR_PIXEL_SIZE}
          height={QR_PIXEL_SIZE}
          aria-label={`QR code for ${url}`}
        />
        <p className="share-modal__url" title={url}>
          {url}
        </p>
        <div className="share-modal__actions">
          <button
            type="button"
            className="share-modal__btn-primary"
            onClick={handleCopy}
            aria-live="polite"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          {canShare && (
            <button
              type="button"
              className="share-modal__btn-secondary"
              onClick={handleNativeShare}
            >
              Share…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
