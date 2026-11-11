/**
 * classifyRbt — suggests a Revised Bloom's Taxonomy level (L1–L6) for a
 * question, by reading its task verbs.
 *
 * Deliberately a SUGGESTION, not a verdict. It returns a confidence and,
 * where the evidence is genuinely split, an alternative — because verb
 * matching gets a real share of exam questions wrong, and an RBT column is
 * an accreditation artifact. See `needsReview` and the notes in the README.
 *
 * Two things make this better than a plain verb lookup:
 *
 *   1. Position weighting. The imperative verb that opens a sentence is the
 *      task. Verbs buried in subordinate clauses ("…, explaining how…",
 *      "…to show that…") describe the method, not the demand, and are scored
 *      far lower.
 *
 *   2. Maths-sense disambiguation. "Evaluate" is an L5 judgement verb in
 *      general education and an L3 computation verb in a maths paper —
 *      "Evaluate the integral" is Apply, not Evaluate. Same for determine,
 *      find, verify, show and prove. Since this app serves a mathematics
 *      programme, those cases are detected and re-scored.
 */

export type RbtLevel = 1 | 2 | 3 | 4 | 5 | 6;

export const RBT_LABELS: Record<RbtLevel, string> = {
  1: 'Remember',
  2: 'Understand',
  3: 'Apply',
  4: 'Analyse',
  5: 'Evaluate',
  6: 'Create',
};

export interface RbtSuggestion {
  level: RbtLevel;
  /** "L4" — the string that goes in the table cell. */
  code: string;
  /** "Analyse" */
  label: string;
  /** 0–1. Below ~0.55 the author really should look at it. */
  confidence: number;
  /** Verbs found, strongest first. */
  matchedVerbs: string[];
  /** Second-best reading, when one exists. */
  alternative?: { level: RbtLevel; code: string; label: string; reason: string };
  /** Plain-language explanation to show in the UI. */
  reasoning: string;
  /** True when the author should confirm before this reaches the paper. */
  needsReview: boolean;
}

/* ------------------------------------------------------------------ */
/* verb tables                                                         */
/* ------------------------------------------------------------------ */

const VERBS: Record<RbtLevel, string[]> = {
  1: [
    'define', 'list', 'state', 'recall', 'name', 'identify', 'label',
    'recognise', 'recognize', 'reproduce', 'match', 'recite', 'record',
    'enumerate', 'mention', 'quote', 'tabulate', 'what is', 'who is',
    'when did', 'write short notes',
  ],
  2: [
    'explain', 'describe', 'summarise', 'summarize', 'interpret', 'classify',
    'discuss', 'illustrate', 'paraphrase', 'restate', 'express', 'review',
    'outline', 'give an account', 'give examples', 'elaborate', 'clarify',
    'translate', 'convert', 'generalise', 'generalize', 'infer', 'predict',
    'indicate', 'report', 'exemplify',
  ],
  3: [
    'apply', 'solve', 'compute', 'calculate', 'demonstrate', 'implement',
    'execute', 'employ', 'operate', 'sketch', 'draw', 'construct', 'use',
    'modify', 'carry out', 'perform', 'simulate', 'estimate', 'obtain',
    'work out', 'update', 'train', 'code', 'program',
    // Ambiguous verbs — listed here so they match at all; MATHS_SENSE
    // then re-scores them by context, which is where the level is decided.
    'show', 'find', 'determine', 'verify', 'derive',
  ],
  4: [
    'analyse', 'analyze', 'differentiate', 'distinguish', 'examine',
    'deconstruct', 'categorise', 'categorize', 'investigate', 'attribute',
    'organise', 'organize', 'correlate', 'diagnose', 'break down',
    'contrast', 'compare', 'relate', 'infer why', 'deduce', 'trace',
    'dissect', 'test', 'discriminate',
  ],
  5: [
    'evaluate', 'judge', 'justify', 'critique', 'assess', 'defend', 'argue',
    'appraise', 'recommend', 'prioritise', 'prioritize', 'validate',
    'conclude', 'support', 'rate', 'rank', 'comment on', 'criticise',
    'criticize', 'weigh', 'debate', 'select the best', 'which is better',
    'prove',
  ],
  6: [
    'design', 'create', 'develop', 'formulate', 'propose', 'compose',
    'devise', 'generate', 'synthesise', 'synthesize', 'invent', 'produce',
    'plan', 'build', 'architect', 'model a', 'construct a new', 'adapt',
    'reorganise', 'reorganize', 'hypothesise', 'hypothesize',
  ],
};

/**
 * Verbs whose Bloom level flips depending on the subject.
 * In a mathematics or engineering paper these usually mean "compute".
 */
const MATHS_SENSE: Record<
  string,
  { mathsLevel: RbtLevel; generalLevel: RbtLevel; mathsNote: string; generalNote: string }
> = {
  evaluate: {
    mathsLevel: 3, generalLevel: 5,
    mathsNote: '"Evaluate" before an expression means compute, so Apply (L3)',
    generalNote: 'No maths in the question, so "evaluate" reads as judgement (L5)',
  },
  determine: {
    mathsLevel: 3, generalLevel: 4,
    mathsNote: '"Determine" a quantity is Apply (L3)',
    generalNote: '"Determine" without a quantity reads as Analyse (L4)',
  },
  find: {
    mathsLevel: 3, generalLevel: 1,
    mathsNote: '"Find" a quantity is Apply (L3)',
    generalNote: '"Find" without a computation reads as recall (L1)',
  },
  verify: {
    mathsLevel: 3, generalLevel: 5,
    mathsNote: '"Verify" by substitution is Apply (L3)',
    generalNote: 'Verifying a claim critically is Evaluate (L5)',
  },
  show: {
    mathsLevel: 3, generalLevel: 1,
    mathsNote: '"Show that" is a derivation, so Apply (L3)',
    generalNote: '"Show" without maths usually means state or list (L1)',
  },
  prove: {
    mathsLevel: 4, generalLevel: 5,
    mathsNote: '"Prove" is a constructed argument, so Analyse (L4)',
    generalNote: '"Prove" a position is Evaluate (L5)',
  },
  derive: {
    mathsLevel: 3, generalLevel: 4,
    mathsNote: 'Deriving a standard result is Apply (L3)',
    generalNote: 'Deriving a relationship is Analyse (L4)',
  },
};

/** Verbs mapped to different levels by different published rubrics. */
const CONTESTED: Record<string, { primary: RbtLevel; other: RbtLevel; reason: string }> = {
  compare: { primary: 4, other: 2, reason: 'some rubrics place "compare" at Understand (L2)' },
  contrast: { primary: 4, other: 2, reason: 'some rubrics place "contrast" at Understand (L2)' },
  outline: { primary: 2, other: 1, reason: '"outline" is Remember (L1) in some rubrics' },
  illustrate: { primary: 2, other: 3, reason: 'illustrating by worked example is Apply (L3)' },
  construct: { primary: 3, other: 6, reason: 'constructing something novel is Create (L6)' },
  predict: { primary: 2, other: 3, reason: 'predicting from a model is Apply (L3)' },
  test: { primary: 4, other: 3, reason: 'running a prescribed test is Apply (L3)' },
  interpret: { primary: 2, other: 4, reason: 'interpreting results critically reaches L4' },
  discuss: { primary: 2, other: 5, reason: '"discuss critically" reaches Evaluate (L5)' },
};

/* ------------------------------------------------------------------ */
/* scoring                                                             */
/* ------------------------------------------------------------------ */

interface Hit {
  verb: string;
  level: RbtLevel;
  weight: number;
  note?: string;
}

/** Does the sentence contain maths, or read like a computation? */
function isMathsContext(text: string): boolean {
  if (/\$[^$]+\$/.test(text)) return true;
  if (/\\(int|sum|frac|sqrt|lim|partial|prod)/.test(text)) return true;
  return /\b(integral|derivative|equation|matrix|value of|to \d+ decimal|numerically|gradient|weight|compute)\b/i.test(
    text
  );
}

/** Strip maths so verbs inside expressions aren't matched as task verbs. */
function stripMath(text: string): string {
  return text.replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\$[^$\n]*\$/g, ' ');
}

function sentences(text: string): string[] {
  return stripMath(text)
    .split(/(?<=[.;:?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function classifyRbt(questionText: string): RbtSuggestion {
  const source = questionText ?? '';
  const maths = isMathsContext(source);
  const parts = sentences(source);
  const hits: Hit[] = [];

  parts.forEach((sentence, sentenceIndex) => {
    const lower = ' ' + sentence.toLowerCase() + ' ';

    (Object.keys(VERBS) as unknown as string[]).forEach((key) => {
      const level = Number(key) as RbtLevel;

      for (const verb of VERBS[level]) {
        // Match the verb as a whole word. A plain prefix match let participles
        // through — "shown below" scored as the verb "show", "defined by" as
        // "define", "stated" as "state" — and tagged ordinary questions L1.
        let idx = -1;
        for (let from = 0; ; ) {
          const found = lower.indexOf(' ' + verb, from);
          if (found < 0) break;
          const next = lower.charAt(found + 1 + verb.length);
          if (!/[a-z]/.test(next)) { idx = found; break; }
          from = found + 1;
        }
        if (idx < 0) continue;

        // Position weighting: an imperative opening the first sentence is
        // the actual task; later or embedded verbs describe the method.
        const opensSentence = idx <= 1;
        let weight = opensSentence ? 1.0 : 0.35;
        if (sentenceIndex > 0) weight *= 0.75;
        // "...explaining how", "...to show that" — subordinate, not the task.
        if (/(?:,\s*|by\s+|while\s+|thereby\s+)$/.test(lower.slice(0, idx + 1))) weight *= 0.4;
        if (verb.endsWith('ing')) weight *= 0.5;

        let effectiveLevel = level;
        let note: string | undefined;

        const sense = MATHS_SENSE[verb];
        if (sense) {
          effectiveLevel = maths ? sense.mathsLevel : sense.generalLevel;
          note = maths ? sense.mathsNote : sense.generalNote;
          // "Evaluate how/why X works" asks for a mechanism, not a judgement.
          if (verb === 'evaluate' && /evaluate\s+(how|why|whether|the extent)/i.test(sentence)) {
            effectiveLevel = 4;
            note = '"Evaluate how…" asks for a mechanism, so Analyse (L4), not L5';
          }
        }

        hits.push({ verb, level: effectiveLevel, weight, note });
      }
    });
  });

  if (hits.length === 0) {
    return {
      level: 2,
      code: 'L2',
      label: RBT_LABELS[2],
      confidence: 0.2,
      matchedVerbs: [],
      reasoning: 'No recognised task verb. Defaulted to L2 — please set this manually.',
      needsReview: true,
    };
  }

  // Sum weights per level; keep the strongest verb for each.
  const scores = new Map<RbtLevel, number>();
  const strongest = new Map<RbtLevel, Hit>();

  for (const hit of hits) {
    scores.set(hit.level, (scores.get(hit.level) ?? 0) + hit.weight);
    const current = strongest.get(hit.level);
    if (!current || hit.weight > current.weight) strongest.set(hit.level, hit);
  }

  const ranked = [...scores.entries()].sort((a, b) => {
    if (Math.abs(b[1] - a[1]) > 1e-9) return b[1] - a[1];
    return b[0] - a[0]; // tie: the higher cognitive demand wins
  });

  const [topLevel, topScore] = ranked[0];
  const runnerUp = ranked[1];
  const total = [...scores.values()].reduce((a, b) => a + b, 0);

  let confidence = topScore / total;
  // A lone weak match shouldn't read as certain.
  if (topScore < 0.5) confidence *= 0.6;

  const topHit = strongest.get(topLevel)!;
  const orderedVerbs = hits
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((h) => h.verb)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  let alternative: RbtSuggestion['alternative'];
  const contested = CONTESTED[topHit.verb];
  const senseFlip = MATHS_SENSE[topHit.verb];

  if (contested && contested.primary === topLevel) {
    alternative = {
      level: contested.other,
      code: `L${contested.other}`,
      label: RBT_LABELS[contested.other],
      reason: contested.reason,
    };
    confidence = Math.min(confidence, 0.6);
  } else if (senseFlip && senseFlip.mathsLevel !== senseFlip.generalLevel) {
    // The level here rests on whether the question counts as maths — an
    // inference, so offer the other reading rather than hiding it.
    const other = maths ? senseFlip.generalLevel : senseFlip.mathsLevel;
    alternative = {
      level: other,
      code: `L${other}`,
      label: RBT_LABELS[other],
      reason: maths
        ? `read as a general-education question, "${topHit.verb}" would be L${other}`
        : `read as a computation, "${topHit.verb}" would be L${other}`,
    };
    confidence = Math.min(confidence, 0.7);
  } else if (runnerUp && runnerUp[1] / topScore > 0.6) {
    alternative = {
      level: runnerUp[0],
      code: `L${runnerUp[0]}`,
      label: RBT_LABELS[runnerUp[0]],
      reason: `"${strongest.get(runnerUp[0])!.verb}" also appears and points to L${runnerUp[0]}`,
    };
    confidence = Math.min(confidence, 0.65);
  }

  const reasoningParts = [`Task verb "${topHit.verb}" → L${topLevel} ${RBT_LABELS[topLevel]}`];
  if (topHit.note) reasoningParts.push(topHit.note);
  if (hits.length > 3) {
    reasoningParts.push(`${hits.length} verbs found — multi-part question, level taken from the strongest`);
  }

  return {
    level: topLevel,
    code: `L${topLevel}`,
    label: RBT_LABELS[topLevel],
    confidence: Math.round(Math.min(confidence, 0.95) * 100) / 100,
    matchedVerbs: orderedVerbs,
    alternative,
    reasoning: reasoningParts.join('. '),
    needsReview: confidence < 0.55 || Boolean(alternative),
  };
}

/* ------------------------------------------------------------------ */
/* paper-level check                                                   */
/* ------------------------------------------------------------------ */

export interface PaperBalance {
  counts: Record<string, number>;
  /** Levels with no question at all. */
  missing: string[];
  /** Human-readable warnings for the author. */
  warnings: string[];
}

/**
 * Most CIA rubrics expect a spread across levels rather than a paper
 * bunched at one. This reports the distribution so the author can see it
 * before the paper is finalised.
 */
export function analysePaper(levels: RbtLevel[]): PaperBalance {
  const counts: Record<string, number> = {};
  for (const level of levels) {
    const code = `L${level}`;
    counts[code] = (counts[code] ?? 0) + 1;
  }

  const missing = ([1, 2, 3, 4, 5, 6] as RbtLevel[])
    .filter((l) => !counts[`L${l}`])
    .map((l) => `L${l}`);

  const warnings: string[] = [];
  const total = levels.length;

  if (total > 0) {
    const distinct = Object.keys(counts).length;
    if (distinct === 1) {
      warnings.push(`Every question is at ${Object.keys(counts)[0]}. Most rubrics expect a spread.`);
    }
    const lowCount = levels.filter((l) => l <= 2).length;
    if (lowCount === 0 && total >= 3) {
      warnings.push('No L1 or L2 question — weaker students have no entry point.');
    }
    const highCount = levels.filter((l) => l >= 4).length;
    if (highCount === total && total >= 3) {
      warnings.push('Every question is L4 or above. Check this matches the marks and the time allowed.');
    }
  }

  return { counts, missing, warnings };
}
