import { useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, isOpen, onClose);

  if (!isOpen) return null;

  return createPortal(
    <>
      <div
        className="about-overlay"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="about-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="about-modal__header">
          <h2 id="about-title" className="about-modal__title">
            About Santa Fe Detour
          </h2>
          <button
            type="button"
            className="about-modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            &#215;
          </button>
        </div>

        <div className="about-modal__body">
          <section className="about-modal__section">
            <h3>Vision</h3>
            <p>
              Santa Fe is a layered city — Indigenous, Spanish colonial,
              territorial, and modern histories overlap on every block. Detour
              is a mapping tool that helps people navigate those layers. Instead
              of listing attractions, it surfaces locations that tell the story
              of the place: why a building sits where it does, what happened on
              a corner, how the landscape shaped the city.
            </p>
          </section>

          <section className="about-modal__section">
            <h3>Current Status</h3>
            <p>
              This is an early prototype. The map, place data, and interface are
              under active development. Feedback from tour guides working in
              Santa Fe and from the visitors they serve is welcome and will
              shape what this becomes.
            </p>
          </section>

          <section className="about-modal__section">
            <h3>Methodology</h3>
            <p>
              Place descriptions are generated through an evidence-weighted
              process that draws on official records, GIS data, and source
              metadata — then distills that material into short, grounded
              summaries. Stronger corroboration is preferred: register data,
              official sources, and specific documentation take precedence. No
              dates, events, or claims are invented. This layer is an editorial
              bridge — better than generic templates, but still subject to
              review and refinement.
            </p>
          </section>

          <footer className="about-modal__footer">
            Created, designed, and developed by Richard Donohue, PhD
            <br />
            <a href="https://smallbatchmaps.com" target="_blank" rel="noopener noreferrer">
              smallbatchmaps.com
            </a>
          </footer>
        </div>
      </div>
    </>,
    document.body,
  );
}
