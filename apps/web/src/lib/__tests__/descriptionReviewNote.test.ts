import { describe, it, expect } from "vitest";
import { descriptionReviewNote, DRAFT_NOTE } from "../descriptionReviewNote";

describe("descriptionReviewNote", () => {
  it("returns the draft note for unreviewed descriptions", () => {
    expect(descriptionReviewNote("unreviewed", true)).toBe(DRAFT_NOTE);
  });

  it("returns the draft note for generated_draft and needs_revision", () => {
    expect(descriptionReviewNote("generated_draft", true)).toBe(DRAFT_NOTE);
    expect(descriptionReviewNote("needs_revision", true)).toBe(DRAFT_NOTE);
  });

  it("returns the draft note when status is absent but a description exists", () => {
    expect(descriptionReviewNote(null, true)).toBe(DRAFT_NOTE);
    expect(descriptionReviewNote(undefined, true)).toBe(DRAFT_NOTE);
  });

  it("returns the draft note for any other non-approved status", () => {
    expect(descriptionReviewNote("pending", true)).toBe(DRAFT_NOTE);
  });

  it("returns null when there is no description", () => {
    expect(descriptionReviewNote("unreviewed", false)).toBeNull();
    expect(descriptionReviewNote(null, false)).toBeNull();
  });

  it("returns null for reviewed and approved statuses", () => {
    expect(descriptionReviewNote("reviewed", true)).toBeNull();
    expect(descriptionReviewNote("approved", true)).toBeNull();
  });

  it("treats status case-insensitively", () => {
    expect(descriptionReviewNote("Reviewed", true)).toBeNull();
    expect(descriptionReviewNote("APPROVED", true)).toBeNull();
  });
});
