/**
 * LaTeX helpers for the question box.
 *
 * Convention used throughout the app:
 *   $ ... $    inline maths
 *   $$ ... $$  display maths (own line, centred)
 */

export interface Snippet {
  /** Button face. Rendered with KaTeX when `display` starts with a backslash. */
  label: string;
  /** Text inserted. `{|}` marks where the caret lands after insertion. */
  insert: string;
  title: string;
}

export interface SnippetGroup {
  group: string;
  items: Snippet[];
}

export const SNIPPETS: SnippetGroup[] = [
  {
    group: 'Structure',
    items: [
      { label: 'x²', insert: '^{|}', title: 'Superscript' },
      { label: 'xᵢ', insert: '_{|}', title: 'Subscript' },
      { label: 'a/b', insert: '\\frac{|}{}', title: 'Fraction' },
      { label: '√', insert: '\\sqrt{|}', title: 'Square root' },
      { label: 'ⁿ√', insert: '\\sqrt[|]{}', title: 'nth root' },
      { label: '( )', insert: '\\left(|\\right)', title: 'Auto-sized brackets' },
    ],
  },
  {
    group: 'Operators',
    items: [
      { label: '∑', insert: '\\sum_{|}^{}', title: 'Summation' },
      { label: '∏', insert: '\\prod_{|}^{}', title: 'Product' },
      { label: '∫', insert: '\\int_{|}^{}', title: 'Integral' },
      { label: '∮', insert: '\\oint_{|}', title: 'Contour integral' },
      { label: 'lim', insert: '\\lim_{|}', title: 'Limit' },
      { label: '∂', insert: '\\partial |', title: 'Partial derivative' },
    ],
  },
  {
    group: 'Relations',
    items: [
      { label: '≤', insert: '\\leq |', title: 'Less than or equal' },
      { label: '≥', insert: '\\geq |', title: 'Greater than or equal' },
      { label: '≠', insert: '\\neq |', title: 'Not equal' },
      { label: '≈', insert: '\\approx |', title: 'Approximately' },
      { label: '→', insert: '\\to |', title: 'Tends to' },
      { label: '∈', insert: '\\in |', title: 'Element of' },
    ],
  },
  {
    group: 'Greek',
    items: [
      { label: 'α', insert: '\\alpha ', title: 'alpha' },
      { label: 'β', insert: '\\beta ', title: 'beta' },
      { label: 'θ', insert: '\\theta ', title: 'theta' },
      { label: 'λ', insert: '\\lambda ', title: 'lambda' },
      { label: 'μ', insert: '\\mu ', title: 'mu' },
      { label: 'π', insert: '\\pi ', title: 'pi' },
      { label: 'σ', insert: '\\sigma ', title: 'sigma' },
      { label: 'ω', insert: '\\omega ', title: 'omega' },
    ],
  },
  {
    group: 'Layout',
    items: [
      { label: 'Matrix', insert: '\\begin{pmatrix} | & \\\\ & \\end{pmatrix}', title: '2×2 matrix' },
      { label: 'Cases', insert: '\\begin{cases} | & \\text{if } \\\\ & \\text{otherwise} \\end{cases}', title: 'Piecewise' },
      { label: 'Text', insert: '\\text{|}', title: 'Upright text inside maths' },
    ],
  },
];

/** Result of inserting a snippet: the new value plus where the caret goes. */
export function insertSnippet(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  snippet: string
): { value: string; caret: number } {
  const caretMarker = snippet.indexOf('|');
  const body = snippet.replace('|', '');
  const selected = value.slice(selectionStart, selectionEnd);

  // If the user highlighted something, drop it into the caret slot.
  const inserted = caretMarker >= 0 && selected ? body.slice(0, caretMarker) + selected + body.slice(caretMarker) : body;

  const next = value.slice(0, selectionStart) + inserted + value.slice(selectionEnd);
  const caret =
    caretMarker >= 0
      ? selectionStart + caretMarker + (selected ? selected.length : 0)
      : selectionStart + inserted.length;

  return { value: next, caret };
}

/** Wrap the current selection (or the caret) in $…$ or $$…$$. */
export function wrapMath(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  display = false
): { value: string; caret: number } {
  const fence = display ? '$$' : '$';
  const selected = value.slice(selectionStart, selectionEnd);
  const next =
    value.slice(0, selectionStart) + fence + selected + fence + value.slice(selectionEnd);
  return {
    value: next,
    caret: selectionStart + fence.length + selected.length,
  };
}

export type Segment =
  | { type: 'text'; content: string }
  | { type: 'math'; content: string; display: boolean };

/**
 * Split mixed prose + LaTeX into renderable segments.
 * Handles $…$, $$…$$, \( … \) and \[ … \].
 */
export function parseMathSegments(input: string): Segment[] {
  const pattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g;
  const segments: Segment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    if (match.index > cursor) {
      segments.push({ type: 'text', content: input.slice(cursor, match.index) });
    }
    const display = match[1] !== undefined || match[2] !== undefined;
    const content = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '';
    segments.push({ type: 'math', content: content.trim(), display });
    cursor = match.index + match[0].length;
  }

  if (cursor < input.length) {
    segments.push({ type: 'text', content: input.slice(cursor) });
  }
  return segments;
}

/** True when every $ fence in the string is closed. */
export function hasBalancedFences(input: string): boolean {
  const doubles = (input.match(/\$\$/g) || []).length;
  const singles = (input.replace(/\$\$/g, '').match(/\$/g) || []).length;
  return doubles % 2 === 0 && singles % 2 === 0;
}

/**
 * Optional: turn dictated maths into LaTeX.
 * Applied only when the mic is in "maths dictation" mode, so ordinary
 * question text is never mangled.
 *
 * "x squared plus alpha over two" -> "x^{2} + \alpha \frac{}{2}"-ish.
 * Deliberately conservative: it handles the phrases people actually say.
 */
const SPOKEN_MATH: Array<[RegExp, string]> = [
  [/\bsquared\b/gi, '^{2}'],
  [/\bcubed\b/gi, '^{3}'],
  [/\bto the power (?:of )?(\w+)\b/gi, '^{$1}'],
  [/\bsquare root of\b/gi, '\\sqrt'],
  [/\bintegral of\b/gi, '\\int'],
  [/\bsummation of\b/gi, '\\sum'],
  [/\bsum of\b/gi, '\\sum'],
  [/\bplus or minus\b/gi, '\\pm'],
  [/\bplus\b/gi, '+'],
  [/\bminus\b/gi, '-'],
  [/\btimes\b/gi, '\\times'],
  [/\bdivided by\b/gi, '/'],
  [/\bequals\b/gi, '='],
  [/\bnot equal to\b/gi, '\\neq'],
  [/\bless than or equal to\b/gi, '\\leq'],
  [/\bgreater than or equal to\b/gi, '\\geq'],
  [/\bless than\b/gi, '<'],
  [/\bgreater than\b/gi, '>'],
  [/\binfinity\b/gi, '\\infty'],
  [/\b(alpha|beta|gamma|delta|theta|lambda|mu|sigma|omega|phi|psi|pi)\b/gi, '\\$1'],
  [/\bopen bracket\b/gi, '('],
  [/\bclose bracket\b/gi, ')'],
];

export function speechToLatex(spoken: string): string {
  let out = spoken;
  for (const [pattern, replacement] of SPOKEN_MATH) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, ' ').trim();
}
