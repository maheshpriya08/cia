/**
 * mathSpeech.ts
 * -------------
 * Converts a spoken (dictated) transcript into either plain prose with
 * punctuation commands applied, or into LaTeX suitable for the question
 * boxes of the CIA Exam Paper Generator.
 *
 * The converter runs in three ordered stages:
 *   1. normalise  - tidy whitespace/quotes, number-words -> digits
 *   2. symbolise  - fixed phrases and single words -> LaTeX tokens
 *   3. structure  - operand-consuming rules (fractions, roots, powers, ...)
 *
 * Letter case is deliberately preserved (A and a are different matrices), so
 * every rule matches case-insensitively instead of lower-casing the input.
 * Anything the converter cannot understand is left untouched, so the user can
 * always correct it by hand in the textarea.
 */

/* ------------------------------------------------------------------ */
/* Stage 0 - punctuation / dictation commands (used in prose mode too) */
/* ------------------------------------------------------------------ */

const PUNCTUATION: Array<[RegExp, string]> = [
  [/\b(?:full stop|fullstop|period)\b/gi, '.'],
  [/\bcomma\b/gi, ','],
  [/\bsemicolon\b/gi, ';'],
  [/\bcolon\b/gi, ':'],
  [/\bquestion mark\b/gi, '?'],
  [/\b(?:exclamation mark|exclamation point)\b/gi, '!'],
  [/\b(?:new line|newline|next line)\b/gi, '\n'],
  [/\bnew paragraph\b/gi, '\n\n'],
  [/\bhyphen\b/gi, '-'],
  [/\bdash\b/gi, '\u2014'],
];

export function applyPunctuation(text: string): string {
  let out = ` ${text} `;
  PUNCTUATION.forEach(([re, rep]) => {
    out = out.replace(re, rep);
  });
  out = out.replace(/[ \t]+([.,;:?!])/g, '$1');
  out = out.replace(/([.,;:?!])(?=[^\s.,;:?!])/g, '$1 ');
  out = out.replace(/[ \t]{2,}/g, ' ');
  return out.trim();
}

/* ------------------------------------------------------------------ */
/* Stage 1 - normalisation                                             */
/* ------------------------------------------------------------------ */

const NUMBER_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14',
  fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20', thirty: '30', forty: '40',
  fifty: '50', sixty: '60', seventy: '70', eighty: '80',
  ninety: '90', hundred: '100', thousand: '1000',
};

function normalise(text: string): string {
  let s = ` ${text.trim()} `;
  s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  Object.entries(NUMBER_WORDS).forEach(([word, digit]) => {
    s = s.replace(new RegExp(`\\b${word}\\b`, 'gi'), digit);
  });
  return s.replace(/\s{2,}/g, ' ');
}

/* ------------------------------------------------------------------ */
/* Stage 2 - phrase & word symbol table                                */
/* ------------------------------------------------------------------ */

/** Longest phrases first so "less than or equal to" wins over "less than". */
const SYMBOLS: Array<[string, string]> = [
  // --- relations ---------------------------------------------------
  ['is greater than or equal to', ' \\geq '],
  ['is less than or equal to', ' \\leq '],
  ['greater than or equal to', ' \\geq '],
  ['less than or equal to', ' \\leq '],
  ['is approximately equal to', ' \\approx '],
  ['approximately equal to', ' \\approx '],
  ['is not equal to', ' \\neq '],
  ['not equal to', ' \\neq '],
  ['is identical to', ' \\equiv '],
  ['is equal to', ' = '],
  ['equals to', ' = '],
  ['equal to', ' = '],
  ['is greater than', ' > '],
  ['is less than', ' < '],
  ['greater than', ' > '],
  ['less than', ' < '],
  ['equals', ' = '],

  // --- arithmetic ---------------------------------------------------
  ['plus or minus', ' \\pm '],
  ['minus or plus', ' \\mp '],
  ['multiplied by', ' \\times '],
  ['divided by', ' \\div '],
  ['dot product', ' \\cdot '],
  ['cross product', ' \\times '],
  ['times', ' \\times '],
  ['plus', ' + '],
  ['minus', ' - '],
  ['factorial', '!'],
  ['percent', ' \\% '],
  ['degrees', '^{\\circ}'],
  ['degree', '^{\\circ}'],

  // --- logic & sets -------------------------------------------------
  ['if and only if', ' \\iff '],
  ['implies that', ' \\Rightarrow '],
  ['implies', ' \\Rightarrow '],
  ['therefore', ' \\therefore '],
  ['for all', ' \\forall '],
  ['there exists', ' \\exists '],
  ['does not belong to', ' \\notin '],
  ['not an element of', ' \\notin '],
  ['belongs to', ' \\in '],
  ['element of', ' \\in '],
  ['is a subset of', ' \\subseteq '],
  ['subset of', ' \\subset '],
  ['superset of', ' \\supset '],
  ['union', ' \\cup '],
  ['intersection', ' \\cap '],
  ['empty set', ' \\emptyset '],
  ['null set', ' \\emptyset '],
  ['such that', ' \\mid '],

  // --- misc symbols -------------------------------------------------
  ['infinity', ' \\infty '],
  ['proportional to', ' \\propto '],
  ['tends to', ' \\to '],
  ['approaches', ' \\to '],
  ['maps to', ' \\mapsto '],
  ['right arrow', ' \\rightarrow '],
  ['left arrow', ' \\leftarrow '],
  ['double arrow', ' \\Leftrightarrow '],
  ['ellipsis', ' \\dots '],
  ['dot dot dot', ' \\dots '],
  ['nabla', ' \\nabla '],

  // --- Greek (capitals first) ---------------------------------------
  ['capital gamma', ' \\Gamma '],
  ['capital delta', ' \\Delta '],
  ['capital theta', ' \\Theta '],
  ['capital lambda', ' \\Lambda '],
  ['capital pi', ' \\Pi '],
  ['capital sigma', ' \\Sigma '],
  ['capital phi', ' \\Phi '],
  ['capital psi', ' \\Psi '],
  ['capital omega', ' \\Omega '],
  ['alpha', ' \\alpha '],
  ['beta', ' \\beta '],
  ['gamma', ' \\gamma '],
  ['delta', ' \\delta '],
  ['epsilon', ' \\epsilon '],
  ['zeta', ' \\zeta '],
  ['theta', ' \\theta '],
  ['iota', ' \\iota '],
  ['kappa', ' \\kappa '],
  ['lambda', ' \\lambda '],
  ['sigma', ' \\sigma '],
  ['upsilon', ' \\upsilon '],
  ['omega', ' \\omega '],
  ['phi', ' \\phi '],
  ['psi', ' \\psi '],
  ['chi', ' \\chi '],
  ['tau', ' \\tau '],
  ['rho', ' \\rho '],
  ['mu', ' \\mu '],
  ['nu', ' \\nu '],
  ['xi', ' \\xi '],
  ['pi', ' \\pi '],

  // --- brackets ------------------------------------------------------
  ['open parenthesis', ' ( '],
  ['close parenthesis', ' ) '],
  ['left parenthesis', ' ( '],
  ['right parenthesis', ' ) '],
  ['open square bracket', ' [ '],
  ['close square bracket', ' ] '],
  ['open bracket', ' ( '],
  ['close bracket', ' ) '],
  ['open brace', ' \\{ '],
  ['close brace', ' \\} '],

  // --- functions ------------------------------------------------------
  ['natural log of', ' \\ln '],
  ['natural log', ' \\ln '],
  ['sine of', ' \\sin '],
  ['cosine of', ' \\cos '],
  ['tangent of', ' \\tan '],
  ['cosecant of', ' \\csc '],
  ['secant of', ' \\sec '],
  ['cotangent of', ' \\cot '],
  ['sine', ' \\sin '],
  ['cosine', ' \\cos '],
  ['tangent', ' \\tan '],
  ['cosec', ' \\csc '],
  ['sec', ' \\sec '],
  ['cot', ' \\cot '],
  ['sin', ' \\sin '],
  ['cos', ' \\cos '],
  ['tan', ' \\tan '],
];

function symbolise(text: string): string {
  let s = text;
  SYMBOLS.forEach(([phrase, latex]) => {
    const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The leading group refuses a match that follows a backslash or a letter/
    // digit, so short names like "sin" cannot fire again inside the "\sin"
    // this table just produced. (Lookbehind is avoided for browser reach.)
    const re = new RegExp(`(^|[^\\\\A-Za-z0-9])${escaped}\\b`, 'gi');
    s = s.replace(re, `$1${latex}`);
  });
  // "n factorial" leaves "n !" because the guard keeps the preceding space;
  // reattach it before the structural rules try to bind operands.
  return s.replace(/\s+!/g, '!').replace(/\s{2,}/g, ' ');
}

/* ------------------------------------------------------------------ */
/* Stage 3 - structural rules that consume operands                    */
/* ------------------------------------------------------------------ */

/** One "atom": a bracketed group, or a single token of letters/digits/LaTeX. */
const ATOM = String.raw`(\([^()]*\)|\\?[A-Za-z0-9\\{}^_.'\-!]+)`;

const rx = (source: string) => new RegExp(source, 'gi');

/**
 * Order matters. Derivatives and integrals bind first, then sums and limits,
 * then roots, then powers/accents, and only then the loose "X over Y"
 * fraction rule - otherwise "x squared over y" would become \frac{squared}{y}.
 */
const STRUCTURE: Array<[RegExp, string]> = [
  // derivatives (the leading \\ is optional because "partial" is symbolised) --
  [rx(String.raw`\\?partial derivative of ${ATOM} with respect to ${ATOM}`),
    '\\frac{\\partial $1}{\\partial $2}'],
  [rx(String.raw`second (?:order )?derivative of ${ATOM} with respect to ${ATOM}`),
    '\\frac{d^{2}$1}{d$2^{2}}'],
  [rx(String.raw`derivative of ${ATOM} with respect to ${ATOM}`),
    '\\frac{d$1}{d$2}'],
  [rx(String.raw`\bd by d\s*([A-Za-z])\b`), '\\frac{d}{d$1}'],

  // integrals ---------------------------------------------------------
  [rx(String.raw`double integral of`), '\\iint '],
  [rx(String.raw`triple integral of`), '\\iiint '],
  [rx(String.raw`contour integral of`), '\\oint '],
  [rx(String.raw`(?:definite )?integral from ${ATOM} to ${ATOM} of`), '\\int_{$1}^{$2} '],
  [rx(String.raw`(?:indefinite )?integral of`), '\\int '],

  // sums, products, limits ---------------------------------------------
  [rx(String.raw`(?:sum|summation) from ${ATOM} (?:=|equals) ${ATOM} to ${ATOM} of`),
    '\\sum_{$1=$2}^{$3} '],
  [rx(String.raw`(?:sum|summation) from ${ATOM} to ${ATOM} of`), '\\sum_{$1}^{$2} '],
  [rx(String.raw`(?:sum|summation) of`), '\\sum '],
  [rx(String.raw`product from ${ATOM} to ${ATOM} of`), '\\prod_{$1}^{$2} '],
  [rx(String.raw`limit as ${ATOM} (?:\\to|to) ${ATOM} of`), '\\lim_{$1 \\to $2} '],
  [rx(String.raw`limit as ${ATOM} (?:\\to|to) ${ATOM}`), '\\lim_{$1 \\to $2}'],

  // roots ---------------------------------------------------------------
  [rx(String.raw`square root of ${ATOM}`), '\\sqrt{$1}'],
  [rx(String.raw`cube root of ${ATOM}`), '\\sqrt[3]{$1}'],
  [rx(String.raw`([A-Za-z0-9]+)(?:th|st|nd|rd) root of ${ATOM}`), '\\sqrt[$1]{$2}'],

  // powers, indices, accents --------------------------------------------
  [rx(String.raw`${ATOM} (?:to the power(?: of)?|raised to(?: the power(?: of)?)?) ${ATOM}`),
    '$1^{$2}'],
  [rx(String.raw`${ATOM} squared`), '$1^{2}'],
  [rx(String.raw`${ATOM} cubed`), '$1^{3}'],
  [rx(String.raw`${ATOM} inverse`), '$1^{-1}'],
  [rx(String.raw`${ATOM} transpose`), '$1^{T}'],
  [rx(String.raw`${ATOM} double prime`), "$1''"],
  [rx(String.raw`${ATOM} prime`), "$1'"],
  [rx(String.raw`${ATOM} (?:sub|subscript|suffix) ${ATOM}`), '$1_{$2}'],
  [rx(String.raw`vector ${ATOM}`), '\\vec{$1}'],
  [rx(String.raw`${ATOM} bar`), '\\bar{$1}'],
  [rx(String.raw`${ATOM} hat`), '\\hat{$1}'],
  [rx(String.raw`${ATOM} tilde`), '\\tilde{$1}'],
  [rx(String.raw`absolute value of ${ATOM}`), '\\left|$1\\right|'],
  [rx(String.raw`(?:modulus|magnitude) of ${ATOM}`), '\\left|$1\\right|'],
  [rx(String.raw`norm of ${ATOM}`), '\\left\\|$1\\right\\|'],
  [rx(String.raw`determinant of ${ATOM}`), '\\det($1)'],
  [rx(String.raw`log base ${ATOM}(?: of)?`), '\\log_{$1} '],
  [rx(String.raw`\blog of\b`), '\\log '],

  // fractions -----------------------------------------------------------
  // explicit marker: everything up to "over" is the numerator, the rest
  // (or up to "end fraction") is the denominator
  [rx(String.raw`\bfraction\s+(.+?)\s+over\s+(.+?)(?:\s+end fraction\b|$)`), '\\frac{$1}{$2}'],
  [rx(String.raw`${ATOM} over ${ATOM}`), '\\frac{$1}{$2}'],
  [rx(String.raw`\bone half\b`), '\\frac{1}{2}'],
  [rx(String.raw`\bone third\b`), '\\frac{1}{3}'],
  [rx(String.raw`\bone (?:fourth|quarter)\b`), '\\frac{1}{4}'],

  // differentials --------------------------------------------------------
  [rx(String.raw`\bd\s+([A-Za-z])\b`), '\\,d$1'],

  // leftover connector: "\frac{d}{dx} of x" -> "\frac{d}{dx} x"
  [rx(String.raw`(\}|\\[A-Za-z]+)\s+of\s+`), '$1 '],

  // matrices --------------------------------------------------------------
  [rx(String.raw`\b(?:2 by 2) matrix\b`), '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'],
  [rx(String.raw`\b(?:3 by 3) matrix\b`),
    '\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}'],
  [rx(String.raw`\bmatrix\b`), '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'],
  [rx(String.raw`\bnew row\b`), ' \\\\ '],
  [rx(String.raw`\bnext column\b`), ' & '],
];

function structure(text: string): string {
  let s = text;
  STRUCTURE.forEach(([re, rep]) => {
    // run twice so nested phrases resolve, e.g. "x squared over y squared"
    s = s.replace(re, rep).replace(re, rep);
  });
  return s;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

function tidyLatex(text: string): string {
  return text
    // collapse spacing inside groups first...
    .replace(/\{\s+/g, '{')
    .replace(/\s+\}/g, '}')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    // ...then bind super/subscripts tightly (order matters)
    .replace(/\s*\^\s*/g, '^')
    .replace(/\s*_\s*/g, '_')
    // drop parentheses that a group already provides: \sqrt{(x+1)} -> \sqrt{x+1}
    .replace(/\{\(([^()]*)\)\}/g, '{$1}')
    .replace(/\s+\\,/g, '\\,')
    .replace(/\s+([,;!])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Convert a dictated utterance into a LaTeX expression (no $ delimiters).
 * e.g. "integral from 0 to 1 of x squared d x" -> "\int_{0}^{1} x^{2}\,dx"
 */
export function speechToLatex(transcript: string): string {
  if (!transcript || !transcript.trim()) return '';
  return tidyLatex(structure(symbolise(normalise(transcript))));
}

/**
 * Convert a dictated utterance into prose, applying punctuation commands.
 * `capitalise` starts the chunk with a capital letter (first chunk only).
 */
export function speechToProse(transcript: string, capitalise = true): string {
  if (!transcript || !transcript.trim()) return '';
  let s = applyPunctuation(transcript.trim());
  if (capitalise) {
    s = s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p, c) => p + c.toUpperCase());
  } else {
    s = s.replace(/([.!?]\s+)([a-z])/g, (_m, p, c) => p + c.toUpperCase());
  }
  return s;
}

/**
 * Mixed mode used by the question boxes.
 *
 * The speaker switches into a formula by saying "equation" (or "formula",
 * "begin math", ...) and back out with "end equation". Anything between those
 * markers becomes LaTeX wrapped in $...$ so it renders in the live preview.
 * With no marker spoken, `mathMode` decides how the whole utterance is treated.
 */
export function speechToQuestionText(transcript: string, mathMode: boolean): string {
  if (!transcript || !transcript.trim()) return '';

  const OPEN = /\b(?:begin math|start math|math mode|open math|equation|formula)\b/i;
  const CLOSE = /\b(?:end math|close math|end equation|end formula|end of math)\b/i;

  if (!OPEN.test(transcript)) {
    return mathMode ? `$${speechToLatex(transcript)}$` : speechToProse(transcript);
  }

  const out: string[] = [];
  let rest = transcript;
  let first = true;

  while (rest.length) {
    const open = rest.match(OPEN);
    if (!open || open.index === undefined) {
      const prose = speechToProse(rest, first);
      if (prose) out.push(prose);
      break;
    }

    const before = rest.slice(0, open.index);
    if (before.trim()) {
      out.push(speechToProse(before, first));
      first = false;
    }

    const after = rest.slice(open.index + open[0].length);
    const close = after.match(CLOSE);
    if (!close || close.index === undefined) {
      const latex = speechToLatex(after);
      if (latex) out.push(`$${latex}$`);
      break;
    }

    const latex = speechToLatex(after.slice(0, close.index));
    if (latex) out.push(`$${latex}$`);
    first = false;
    rest = after.slice(close.index + close[0].length);
  }

  return out
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([.,;:?!])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Short cheat-sheet shown in the UI. */
export const VOICE_EXAMPLES: Array<{ say: string; get: string }> = [
  { say: 'x squared plus y squared equals r squared', get: 'x^{2} + y^{2} = r^{2}' },
  { say: 'integral from 0 to 1 of x squared d x', get: '\\int_{0}^{1} x^{2}\\,dx' },
  { say: 'fraction a plus b over c', get: '\\frac{a + b}{c}' },
  { say: 'square root of x', get: '\\sqrt{x}' },
  { say: 'sum from i equals 1 to n of x sub i', get: '\\sum_{i=1}^{n} x_{i}' },
  { say: 'limit as x tends to 0 of fraction sine x over x', get: '\\lim_{x \\to 0} \\frac{\\sin x}{x}' },
  { say: 'partial derivative of u with respect to t', get: '\\frac{\\partial u}{\\partial t}' },
  { say: 'A transpose, A inverse', get: "A^{T}, A^{-1}" },
  { say: 'alpha plus or minus beta', get: '\\alpha \\pm \\beta' },
  { say: 'open bracket x plus 1 close bracket cubed', get: '(x + 1)^{3}' },
  { say: '3 by 3 matrix', get: '3x3 pmatrix template' },
  { say: 'log base 2 of n', get: '\\log_{2} n' },
];
