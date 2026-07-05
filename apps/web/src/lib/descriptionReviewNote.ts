/**
 * Transparency note for curator-generated POI descriptions.
 *
 * Anything not explicitly marked reviewed/approved is treated as a draft —
 * including an absent status, since every description in the curator handoff
 * starts as a generated draft. Callers rendering hand-authored content (e.g.
 * gallery tours) should skip the call when no review_status field exists.
 */
export const DRAFT_NOTE = "Draft description, not yet reviewed";

const REVIEWED_STATUSES = new Set(["reviewed", "approved"]);

export function descriptionReviewNote(
  reviewStatus: string | null | undefined,
  hasDescription: boolean,
): string | null {
  if (!hasDescription) return null;
  if (reviewStatus && REVIEWED_STATUSES.has(reviewStatus.toLowerCase())) return null;
  return DRAFT_NOTE;
}
