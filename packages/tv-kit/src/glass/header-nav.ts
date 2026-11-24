// Moving along the one header (Header.tsx) on a screen that does not own it, such as a catalog title page: the person,
// then the buttons left to right. Plain data, so it is tested without a DOM.

/** What has the remote in the header: the person, or a button's index. */
export type HeaderAt = "person" | number;

/** Where focus lands when Up opens the header: the person, else the first button. */
export const headerStart = (hasPerson: boolean, n: number): HeaderAt | null => (hasPerson ? "person" : n > 0 ? 0 : null);

/**
 * One key in the header. Left and Right move (and stop at the ends), Down and Back leave it ("leave": the screen
 * collapses the header and takes focus back); any other key returns `at` unchanged.
 */
export function stepHeader(at: HeaderAt, key: string, hasPerson: boolean, n: number): HeaderAt | "leave" {
  if (key === "Down" || key === "Back") return "leave";
  if (key !== "Left" && key !== "Right") return at;
  const order: HeaderAt[] = [...(hasPerson ? (["person"] as const) : []), ...Array.from({ length: n }, (_, k) => k)];
  const i = order.indexOf(at);
  const next = order[Math.max(0, Math.min(order.length - 1, i + (key === "Right" ? 1 : -1)))];
  return next ?? at;
}
