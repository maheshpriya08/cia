/**
 * latexToOmml — converts the LaTeX subset used in the question box into
 * Office MathML (OMML), the equation format Word actually edits.
 *
 * Why this exists: KaTeX renders to HTML, which cannot go into a .docx.
 * Without this step, a question typed as "$\int_0^1 x^2\,dx$" reaches the
 * printed paper as the literal characters $\int_0^1 x^2\,dx$.
 *
 * Output is a bare XML string using the `m:` prefix. The generated
 * document.xml already declares
 *   xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
 * on its root element, so the fragment can be injected as-is.
 *
 *   toOmmlRun('\\frac{a}{b}')            -> <m:oMath>…</m:oMath>       (inline)
 *   toOmmlParagraph('\\sum_{i=1}^{n} i') -> <m:oMathPara>…</m:oMathPara> (display, centred)
 *
 * Scope: everything the toolbar in QuestionBox can insert, which is the
 * realistic ceiling for exam questions. Anything unrecognised degrades to
 * upright text rather than throwing, so a paper never fails to generate.
 */

/* ------------------------------------------------------------------ */
/* symbol tables                                                       */
/* ------------------------------------------------------------------ */

/** Letters — italic, the way Word sets variables. */
const LETTERS: Record<string, string> = {
  // Greek, lower
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  // Greek, upper
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // blackboard and script constants
  hbar: 'ℏ', ell: 'ℓ', aleph: 'ℵ',
};

/** Operators, relations and punctuation — upright. */
const SYMBOLS: Record<string, string> = {
  times: '×', div: '÷', cdot: '⋅', pm: '±', mp: '∓', ast: '∗',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
  approx: '≈', equiv: '≡', sim: '∼', propto: '∝', ll: '≪', gg: '≫',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  leftrightarrow: '↔', Leftrightarrow: '⇔', mapsto: '↦',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅', setminus: '∖',
  infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃',
  neg: '¬', land: '∧', lor: '∨', therefore: '∴', because: '∵',
  angle: '∠', perp: '⊥', parallel: '∥', degree: '°', prime: '′',
  ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
  Re: 'ℜ', Im: 'ℑ',
  quad: '\u2003', qquad: '\u2003\u2003',
};

/** \mathbb{R} and friends — map to the Unicode letter Word expects. */
const DOUBLE_STRUCK: Record<string, string> = {
  R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', E: '𝔼', H: 'ℍ', F: '𝔽',
};

/** Operators that take limits above/below (n-ary). */
const NARY: Record<string, string> = {
  sum: '∑', prod: '∏', coprod: '∐',
  int: '∫', iint: '∬', iiint: '∭', oint: '∮',
  bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂',
};

/** Named functions typeset upright. */
const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'exp', 'det', 'dim', 'gcd', 'deg', 'arg',
]);

/** Limit-style operators: label sits underneath. */
const UNDER_OPS: Record<string, string> = {
  lim: 'lim', limsup: 'lim sup', liminf: 'lim inf',
  max: 'max', min: 'min', sup: 'sup', inf: 'inf',
  argmax: 'arg max', argmin: 'arg min',
};

/** Spacing commands — collapse to a thin space or nothing. */
const SPACING: Record<string, string> = {
  ',': '\u2009', ';': '\u2005', ':': '\u2005', '!': '', ' ': ' ',
};

const MATRIX_DELIMS: Record<string, [string, string]> = {
  matrix: ['', ''],
  pmatrix: ['(', ')'],
  bmatrix: ['[', ']'],
  Bmatrix: ['{', '}'],
  vmatrix: ['|', '|'],
  Vmatrix: ['‖', '‖'],
};

/* ------------------------------------------------------------------ */
/* tokenizer                                                           */
/* ------------------------------------------------------------------ */

type Token =
  | { kind: 'char'; value: string }
  | { kind: 'command'; value: string }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'sup' }
  | { kind: 'sub' }
  | { kind: 'amp' }
  | { kind: 'rowbreak' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === '\\') {
      // Row break inside matrices/cases.
      if (input[i + 1] === '\\') {
        tokens.push({ kind: 'rowbreak' });
        i += 2;
        continue;
      }
      const match = /^[a-zA-Z]+/.exec(input.slice(i + 1));
      if (match) {
        tokens.push({ kind: 'command', value: match[0] });
        i += 1 + match[0].length;
      } else {
        // Escaped punctuation or a spacing command such as \, or \{
        tokens.push({ kind: 'command', value: input[i + 1] ?? '' });
        i += 2;
      }
      continue;
    }

    if (ch === '{') { tokens.push({ kind: 'open' }); i += 1; continue; }
    if (ch === '}') { tokens.push({ kind: 'close' }); i += 1; continue; }
    if (ch === '^') { tokens.push({ kind: 'sup' }); i += 1; continue; }
    if (ch === '_') { tokens.push({ kind: 'sub' }); i += 1; continue; }
    if (ch === '&') { tokens.push({ kind: 'amp' }); i += 1; continue; }

    tokens.push({ kind: 'char', value: ch });
    i += 1;
  }

  return tokens;
}

/* ------------------------------------------------------------------ */
/* XML helpers                                                         */
/* ------------------------------------------------------------------ */

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Italic maths run (variables). */
function run(text: string): string {
  if (!text) return '';
  return `<m:r><m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
}

/** Upright run — \text{}, function names, digits kept literal. */
function uprightRun(text: string): string {
  if (!text) return '';
  return `<m:r><m:rPr><m:nor/></m:rPr><m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
}

/* ------------------------------------------------------------------ */
/* parser                                                              */
/* ------------------------------------------------------------------ */

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(latex: string) {
    this.tokens = tokenize(latex);
  }

  parse(): string {
    return this.parseSequence(() => this.pos >= this.tokens.length);
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  /** Parse until `stop()` is true, applying ^ and _ to the preceding atom. */
  private parseSequence(stop: () => boolean): string {
    let out = '';
    let lastAtom = '';

    const flush = () => { out += lastAtom; lastAtom = ''; };

    while (!stop() && this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];

      if (token.kind === 'sup' || token.kind === 'sub') {
        this.pos += 1;
        const first = token.kind;
        const firstArg = this.parseGroup();

        // Catch the paired script if it follows: x_i^2
        let second: { kind: 'sup' | 'sub'; xml: string } | null = null;
        const next = this.peek();
        if (next && (next.kind === 'sup' || next.kind === 'sub') && next.kind !== first) {
          this.pos += 1;
          second = { kind: next.kind, xml: this.parseGroup() };
        }

        const base = lastAtom || run('');
        lastAtom = second
          ? this.subSup(
              base,
              first === 'sub' ? firstArg : second.xml,
              first === 'sup' ? firstArg : second.xml
            )
          : first === 'sup'
            ? `<m:sSup><m:e>${base}</m:e><m:sup>${firstArg}</m:sup></m:sSup>`
            : `<m:sSub><m:e>${base}</m:e><m:sub>${firstArg}</m:sub></m:sSub>`;
        continue;
      }

      flush();
      lastAtom = this.parseAtom();
    }

    flush();
    return out;
  }

  private subSup(base: string, sub: string, sup: string): string {
    return `<m:sSubSup><m:e>${base}</m:e><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup></m:sSubSup>`;
  }

  /** One argument: a braced group, a single command, or a single character. */
  private parseGroup(): string {
    const token = this.peek();
    if (!token) return run('');

    if (token.kind === 'open') {
      this.pos += 1;
      const depthAtEntry = 1;
      let depth = depthAtEntry;
      const start = this.pos;

      // Find the matching close so the group parses as its own sequence.
      while (this.pos < this.tokens.length && depth > 0) {
        const t = this.tokens[this.pos];
        if (t.kind === 'open') depth += 1;
        else if (t.kind === 'close') depth -= 1;
        if (depth > 0) this.pos += 1;
      }
      const end = this.pos;
      const inner = new Parser('');
      inner.tokens = this.tokens.slice(start, end);
      inner.pos = 0;
      this.pos += 1; // consume the close
      return inner.parseSequence(() => inner.pos >= inner.tokens.length);
    }

    return this.parseAtom();
  }

  /** Read an optional [n] argument, used by \sqrt[3]{x}. */
  private parseOptional(): string | null {
    const token = this.peek();
    if (!token || token.kind !== 'char' || token.value !== '[') return null;

    this.pos += 1;
    const collected: Token[] = [];
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos];
      if (t.kind === 'char' && t.value === ']') { this.pos += 1; break; }
      collected.push(t);
      this.pos += 1;
    }
    const inner = new Parser('');
    inner.tokens = collected;
    inner.pos = 0;
    return inner.parseSequence(() => inner.pos >= inner.tokens.length);
  }

  private parseAtom(): string {
    const token = this.tokens[this.pos];
    if (!token) return '';

    if (token.kind === 'char') {
      this.pos += 1;
      // Digits and punctuation are upright; letters stay italic like Word does.
      return /[0-9.,;:!?()[\]|+\-=<>/]/.test(token.value)
        ? uprightRun(token.value)
        : run(token.value);
    }

    if (token.kind === 'open') return this.parseGroup();

    if (token.kind === 'close' || token.kind === 'amp' || token.kind === 'rowbreak') {
      this.pos += 1;
      return '';
    }

    if (token.kind === 'command') {
      this.pos += 1;
      return this.parseCommand(token.value);
    }

    this.pos += 1;
    return '';
  }

  private parseCommand(name: string): string {
    if (name in SPACING) return uprightRun(SPACING[name]);

    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const num = this.parseGroup();
      const den = this.parseGroup();
      return `<m:f><m:fPr><m:type m:val="bar"/></m:fPr><m:num>${num}</m:num><m:den>${den}</m:den></m:f>`;
    }

    if (name === 'sqrt') {
      const degree = this.parseOptional();
      const body = this.parseGroup();
      return degree
        ? `<m:rad><m:radPr><m:degHide m:val="0"/></m:radPr><m:deg>${degree}</m:deg><m:e>${body}</m:e></m:rad>`
        : `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${body}</m:e></m:rad>`;
    }

    if (name in NARY) return this.nary(NARY[name]);

    if (name in UNDER_OPS) return this.underOp(UNDER_OPS[name]);

    if (FUNCTIONS.has(name)) {
      const arg = this.parseGroup();
      return `<m:func><m:fName>${uprightRun(name)}</m:fName><m:e>${arg}</m:e></m:func>`;
    }

    if (name === 'text' || name === 'mathrm' || name === 'operatorname') {
      return uprightRun(this.readRawGroup());
    }

    if (name === 'left') return this.delimited();

    if (name === 'right' || name === 'big' || name === 'Big' || name === 'bigg') {
      // \right is consumed by delimited(); a stray one is harmless.
      return '';
    }

    if (name === 'begin') return this.environment();

    if (name === 'end') { this.readRawGroup(); return ''; }

    if (name === 'bar' || name === 'overline') {
      return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${this.parseGroup()}</m:e></m:bar>`;
    }

    if (name === 'hat' || name === 'vec' || name === 'tilde' || name === 'dot') {
      const chr = { hat: '̂', vec: '⃗', tilde: '̃', dot: '̇' }[name] as string;
      return `<m:acc><m:accPr><m:chr m:val="${chr}"/></m:accPr><m:e>${this.parseGroup()}</m:e></m:acc>`;
    }

    if (name === 'mathbb') {
      const raw = this.readRawGroup();
      return run([...raw].map((c) => DOUBLE_STRUCK[c] ?? c).join(''));
    }

    if (name === 'mathbf' || name === 'boldsymbol') {
      const raw = this.readRawGroup();
      return `<m:r><m:rPr><m:sty m:val="b"/></m:rPr><m:t xml:space="preserve">${esc(raw)}</m:t></m:r>`;
    }

    if (name === 'mathcal' || name === 'mathscr') {
      return run(this.readRawGroup());
    }

    if (name === 'mathit') return run(this.readRawGroup());

    if (name in LETTERS) return run(LETTERS[name]);

    if (name in SYMBOLS) return uprightRun(SYMBOLS[name]);

    // Unknown command: show its name upright rather than losing the content.
    return uprightRun(name);
  }

  /** \sum_{i=1}^{n} …  — limits above and below. */
  private nary(chr: string): string {
    let sub = '';
    let sup = '';

    for (let guard = 0; guard < 2; guard += 1) {
      const token = this.peek();
      if (token?.kind === 'sub') { this.pos += 1; sub = this.parseGroup(); continue; }
      if (token?.kind === 'sup') { this.pos += 1; sup = this.parseGroup(); continue; }
      break;
    }

    // Integrals put limits at the side; sums put them above and below.
    const limLoc = chr === '∫' || chr === '∬' || chr === '∭' || chr === '∮' ? 'subSup' : 'undOvr';
    const body = this.parseGroup();

    return (
      `<m:nary><m:naryPr><m:chr m:val="${chr}"/><m:limLoc m:val="${limLoc}"/>` +
      `<m:subHide m:val="${sub ? 0 : 1}"/><m:supHide m:val="${sup ? 0 : 1}"/></m:naryPr>` +
      `<m:sub>${sub}</m:sub><m:sup>${sup}</m:sup><m:e>${body}</m:e></m:nary>`
    );
  }

  /** \lim_{x \to 0} — label with the condition underneath. */
  private underOp(label: string): string {
    let sub = '';
    if (this.peek()?.kind === 'sub') { this.pos += 1; sub = this.parseGroup(); }
    const head = `<m:limLow><m:e>${uprightRun(label)}</m:e><m:lim>${sub}</m:lim></m:limLow>`;
    return head + this.parseGroup();
  }

  /** \left( … \right) — auto-sized delimiters. */
  private delimited(): string {
    const open = this.readDelimiter();
    const body = this.parseSequence(() => {
      const t = this.peek();
      return t?.kind === 'command' && t.value === 'right';
    });
    let close = ')';
    if (this.peek()?.kind === 'command') { this.pos += 1; close = this.readDelimiter(); }
    return (
      `<m:d><m:dPr><m:begChr m:val="${esc(open)}"/><m:endChr m:val="${esc(close)}"/></m:dPr>` +
      `<m:e>${body}</m:e></m:d>`
    );
  }

  private readDelimiter(): string {
    const token = this.peek();
    if (!token) return '';
    this.pos += 1;
    if (token.kind === 'char') return token.value === '.' ? '' : token.value;
    if (token.kind === 'open') return '{';
    if (token.kind === 'close') return '}';
    if (token.kind === 'command') {
      const map: Record<string, string> = {
        lbrace: '{', rbrace: '}', langle: '⟨', rangle: '⟩',
        lvert: '|', rvert: '|', lVert: '‖', rVert: '‖', '|': '‖',
      };
      return map[token.value] ?? SYMBOLS[token.value] ?? '';
    }
    return '';
  }

  /** \begin{pmatrix} … \end{pmatrix} and \begin{cases} … \end{cases}. */
  private environment(): string {
    const env = this.readRawGroup();
    const rows: string[][] = [[]];
    let cell: Token[] = [];

    const pushCell = () => { rows[rows.length - 1].push(this.renderTokens(cell)); cell = []; };

    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];

      if (token.kind === 'command' && token.value === 'end') {
        this.pos += 1;
        this.readRawGroup();
        break;
      }
      if (token.kind === 'amp') { this.pos += 1; pushCell(); continue; }
      if (token.kind === 'rowbreak') { this.pos += 1; pushCell(); rows.push([]); continue; }

      cell.push(token);
      this.pos += 1;
    }
    pushCell();

    const filled = rows.filter((row) => row.some((c) => c.length > 0) || row.length > 1);

    if (env === 'cases') {
      const lines = filled
        .map((row) => `<m:e>${row.join(uprightRun('\u2003'))}</m:e>`)
        .join('');
      return (
        '<m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/></m:dPr><m:e>' +
        `<m:eqArr>${lines}</m:eqArr></m:e></m:d>`
      );
    }

    const [open, close] = MATRIX_DELIMS[env] ?? ['', ''];
    const body =
      `<m:m><m:mPr><m:mcs><m:mc><m:mcPr>` +
      `<m:count m:val="${Math.max(1, ...filled.map((r) => r.length))}"/>` +
      `<m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>` +
      filled.map((row) => `<m:mr>${row.map((c) => `<m:e>${c}</m:e>`).join('')}</m:mr>`).join('') +
      '</m:m>';

    return open
      ? `<m:d><m:dPr><m:begChr m:val="${esc(open)}"/><m:endChr m:val="${esc(close)}"/></m:dPr><m:e>${body}</m:e></m:d>`
      : body;
  }

  private renderTokens(tokens: Token[]): string {
    const inner = new Parser('');
    inner.tokens = tokens;
    inner.pos = 0;
    return inner.parseSequence(() => inner.pos >= inner.tokens.length);
  }

  /** Read {…} as plain text — for \text{} and environment names. */
  private readRawGroup(): string {
    if (this.peek()?.kind !== 'open') return '';
    this.pos += 1;
    let depth = 1;
    let text = '';
    while (this.pos < this.tokens.length && depth > 0) {
      const token = this.tokens[this.pos];
      if (token.kind === 'open') { depth += 1; text += '{'; }
      else if (token.kind === 'close') { depth -= 1; if (depth > 0) text += '}'; }
      else if (token.kind === 'char') text += token.value;
      else if (token.kind === 'command') {
        text += LETTERS[token.value] ?? SYMBOLS[token.value] ?? SPACING[token.value] ?? '';
      }
      this.pos += 1;
    }
    return text;
  }
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/** Inline equation — sits in the flow of a sentence. */
export function toOmmlRun(latex: string): string {
  try {
    return `<m:oMath>${new Parser(latex).parse()}</m:oMath>`;
  } catch {
    return `<w:r><w:t xml:space="preserve">${esc(latex)}</w:t></w:r>`;
  }
}

/** Display equation — its own centred line. */
export function toOmmlParagraph(latex: string): string {
  try {
    return (
      '<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>' +
      `<m:oMath>${new Parser(latex).parse()}</m:oMath></m:oMathPara>`
    );
  } catch {
    return `<w:r><w:t xml:space="preserve">${esc(latex)}</w:t></w:r>`;
  }
}

export { esc as escapeXml };
