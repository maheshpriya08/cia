/*
 * Page geometry — A4 landscape, two sequential columns.
 *
 * Shared by the exam preview (App.tsx) and the RBT sheet (RbtTab.tsx) so both
 * fragment content against exactly the same column box. If these two ever
 * disagree, a paper that fits on screen would overflow on paper.
 */

/** CSS px per millimetre at 96dpi. */
export const MM = 96 / 25.4;

export const PAGE = {
  width: 297,   // A4 landscape
  height: 210,
  padTop: 12,
  padBottom: 10,
  padLeft: 10,
  padRight: 10,
  gap: 8,
};

/** Height available inside the sheet padding. */
export const USABLE_H = PAGE.height - PAGE.padTop - PAGE.padBottom; // 188mm

/** One COLUMN is one page of the paper; a sheet holds two side by side. */
export const COL_W =
  (PAGE.width - PAGE.padLeft - PAGE.padRight - PAGE.gap) / 2; // 134.5mm

export const mm = (v: number) => `${v}mm`;

/**
 * How many columns a flowed multi-column box ended up needing.
 * A fixed-height multicol box one column wide pushes the surplus into overflow
 * columns to the right, so scrollWidth gives the total directly.
 */
export function countColumns(host: HTMLElement | null): number {
  if (!host) return 1;
  const colPx = COL_W * MM;
  const gapPx = PAGE.gap * MM;
  const total = host.scrollWidth;
  return Math.max(1, Math.round((total + gapPx) / (colPx + gapPx)));
}
