/**
 * Question-paper review against the syllabus — nine criteria, Likert 1–5.
 *
 * Rule-based and fully offline: same paper + same syllabus = same result.
 * Every rating carries a one-line rationale and, when the rating is 3 or
 * lower, a recommendation. The benchmarks below are WORKING BENCHMARKS used
 * by this tool (heuristics common in CIA review practice), not a published
 * standard — the report says so, and a department can change them here.
 *
 * Limits: topic and outcome matching is by wording, not meaning; the
 * think/ink and difficulty figures are estimates from the question's task
 * verb, steps, marks and type. Treat the result as a structured first
 * review for a human moderator, not a verdict.
 */
import type { ExamData, ExamPart, Question } from '../types';
import { classifyRbt, RBT_LABELS, RbtLevel } from './bloom';
import { parseSyllabus, analyseCoverage } from './syllabus';

export type CriterionKey =
  | 'breadth' | 'depth' | 'variety' | 'difficulty' | 'time'
  | 'effort' | 'bloom' | 'distribution' | 'outcome';

export const CRITERIA: { key: CriterionKey; no: number; name: string; short: string; needsSyllabus: boolean; benchmark: string }[] = [
  { key: 'breadth', no: 1, name: 'Breadth', short: 'Breadth', needsSyllabus: true,
    benchmark: 'About one syllabus topic per 4–5 marks: ≤3 marks → 1 topic; 4–7 → 1–2; 8–12 → 1–3; above 12 → 2–4.' },
  { key: 'depth', no: 2, name: 'Depth', short: 'Depth', needsSyllabus: false,
    benchmark: 'Cognitive level should fit the marks: ≤3 marks → L1–L2; 4–5 → L2–L3; 6–9 → L3–L4; 10+ → L3–L5.' },
  { key: 'variety', no: 3, name: 'Variety / heterogeneity (context and application)', short: 'Variety', needsSyllabus: false,
    benchmark: 'At least 3 of 4 task types in the paper (descriptive, numerical, derivation/proof, design/analysis); no type above 40–60%; questions of 5+ marks set in a concrete context.' },
  { key: 'difficulty', no: 4, name: 'Difficulty level', short: 'Difficulty', needsSyllabus: false,
    benchmark: 'Estimated difficulty index should rise with marks (≈0.28 at 2 marks, 0.40 at 5, 0.60 at 10+). Paper mix by marks ≈ 30% easy / 50% moderate / 20% difficult.' },
  { key: 'time', no: 5, name: 'Time duration and mark allotment', short: 'Time & marks', needsSyllabus: false,
    benchmark: 'Estimated answering time should be 70–100% of the time the marks allow (duration ÷ maximum marks × question marks); whole paper ≤ 100% of the duration.' },
  { key: 'effort', no: 6, name: 'Effort: thinking vs inking', short: 'Think : ink', needsSyllabus: false,
    benchmark: 'Thinking ÷ inking should sit in a band for the level: L1 0.03–0.25, L2 0.05–0.35, L3 0.15–0.5, L4 0.2–0.7, L5 0.3–0.9, L6 0.4–1.1.' },
  { key: 'bloom', no: 7, name: "Bloom's taxonomy", short: 'Bloom', needsSyllabus: false,
    benchmark: 'Task verb should identify one level clearly (confidence ≥ 70%) and agree with the level set on the RBT tab. Paper mix by marks ≈ 30% L1–L2 / 50% L3–L4 / 20% L5–L6.' },
  { key: 'distribution', no: 8, name: 'Distribution across syllabus units', short: 'Unit spread', needsSyllabus: true,
    benchmark: "A unit's share of marks within ±10 percentage points of its share of teaching hours (equal shares if hours are not stated), over the units in CIA scope." },
  { key: 'outcome', no: 9, name: 'Outcome alignment (CO and unit)', short: 'Outcome', needsSyllabus: true,
    benchmark: 'A CO is declared, exists in the syllabus, shares wording with it, and the question is not more than one Bloom level below the CO. Unit alignment is checked through criterion 8.' },
];

export type Likert = 1 | 2 | 3 | 4 | 5;
export const LIKERT_LABEL: Record<number, string> = { 5: 'Very good', 4: 'Good', 3: 'Adequate', 2: 'Weak', 1: 'Poor' };

export interface CriterionResult { score: Likert | null; rationale: string; recommendation?: string }

export interface QuestionReview {
  number: number;
  partName: string;
  questionId: string;
  text: string;
  marks: number;
  weight: number;
  unitLabel: string;
  co: string;
  rbtCode: string;
  rbtLabel: string;
  qtype: string;
  difficulty: number;
  difficultyLabel: 'Easy' | 'Moderate' | 'Difficult';
  thinkMin: number;
  inkMin: number;
  estMin: number;
  allotMin: number | null;
  topics: string[];
  results: Record<CriterionKey, CriterionResult>;
  average: number | null;
  recommendations: string[];
}

export interface UnitRow {
  label: string; title: string; inScope: boolean; marks: number; sharePct: number;
  expectedPct: number | null; topicsCovered: number; topicsPartial: number; topicsTotal: number;
}
export interface OutcomeRow { id: string; text: string; questions: number[] }
export interface Outcome { id: string; text: string }

export interface PaperReview {
  hasSyllabus: boolean;
  questions: QuestionReview[];
  blankCount: number;
  avgUnweighted: Record<CriterionKey, number | null>;
  avgWeighted: Record<CriterionKey, number | null>;
  overall: number | null;
  overallWeighted: number | null;
  grade: string;
  bloomMix: { low: number; mid: number; high: number };
  difficultyMix: { easy: number; moderate: number; hard: number };
  typeMix: Record<string, number>;
  units: UnitRow[];
  outcomes: OutcomeRow[];
  durationMin: number | null;
  maxMarks: number;
  minutesPerMark: number | null;
  paperLoadPct: number | null;
  summary: string[];
  topRecommendations: string[];
  assumptions: string[];
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const STOPW = new Set((
  'the and for with that this from into using use used are was were been can may will shall should would could not any all each ' +
  'its their than then such also over under about between within through based via per which what why how when where who whom whose ' +
  'give show write state explain describe discuss compute calculate find determine obtain solve prove derive evaluate'
).split(' '));

function kw(t: string): Set<string> {
  const words = t.toLowerCase().replace(/\$[^$]*\$/g, ' ').match(/[a-z][a-z-]{3,}/g) ?? [];
  return new Set(words.filter((w) => !STOPW.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, '')));
}

function fullText(q: Question): string {
  return [q.text, ...(q.subQuestions ?? []).map((s) => s.text)].filter((t) => t && t.trim()).join(' ');
}

function prose(text: string): string {
  return text.replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, ' MATH ').replace(/\s+/g, ' ').trim();
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const L = (n: number): Likert => clamp(Math.round(n), 1, 5) as Likert;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => Math.round(n);

/** "1.30 hours" → 90 (H.MM when the decimals are two digits), "90 minutes" → 90, "3 Hours" → 180. */
export function parseDurationMin(s: string): number | null {
  const t = (s ?? '').toLowerCase();
  const hmin = t.match(/(\d+)\s*(?:h|hr|hrs|hours?)\s*(?:and\s*)?(\d+)\s*(?:m|mins?|minutes?)/);
  if (hmin) return +hmin[1] * 60 + +hmin[2];
  const dec = t.match(/(\d+)\.(\d+)\s*(?:h|hr|hrs|hour|hours)/);
  if (dec) {
    const [, h, d] = dec;
    if (d.length === 2 && +d <= 59 && d !== '25' && d !== '75') return +h * 60 + +d; // Indian H.MM style
    return Math.round(parseFloat(`${h}.${d}`) * 60);
  }
  const hOnly = t.match(/(\d+)\s*(?:h|hr|hrs|hour|hours)\b/);
  if (hOnly) return +hOnly[1] * 60;
  const mOnly = t.match(/(\d+)\s*(?:m|min|mins|minutes)\b/);
  if (mOnly) return +mOnly[1];
  return null;
}

type QType = 'Descriptive' | 'Numerical' | 'Derivation/proof' | 'Design/analysis';

function questionType(text: string): QType {
  const t = text.toLowerCase();
  const hasNums = /\d/.test(prose(text).replace(/\bMATH\b/g, '')) || /\$/.test(text);
  const groups: [QType, RegExp][] = [
    ['Derivation/proof', /\b(derive|prove|show that|establish|deduce)\b/],
    ['Numerical', /\b(compute|calculate|solve|find|determine|obtain|evaluate|simplify|verify)\b/],
    ['Design/analysis', /\b(design|develop|construct|propose|analy[sz]e|compare|contrast|justify|critique|assess|examine|deconstruct|investigate)\b/],
    ['Descriptive', /\b(define|state|list|explain|describe|discuss|outline|differentiate|distinguish|illustrate|summari[sz]e|what|write)\b/],
  ];
  let best: QType = 'Descriptive';
  let at = Infinity;
  for (const [type, re] of groups) {
    const m = re.exec(t);
    if (!m || m.index >= at) continue;
    if (type === 'Numerical' && !hasNums) continue;
    best = type; at = m.index;
  }
  return best;
}

const CONTEXT = /\b(given|following|data|dataset|network|system|real|practical|application|scenario|case|suppose|consider|assume|topology|architecture|image|character|problem|training|input|weights?)\b/i;

const THINK: Record<RbtLevel, number> = { 1: 0.5, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 };
const INK_PER_MARK: Record<QType, number> = { Descriptive: 1.0, Numerical: 1.2, 'Derivation/proof': 1.3, 'Design/analysis': 1.1 };
const EFFORT_BAND: Record<RbtLevel, [number, number]> = { 1: [0.03, 0.25], 2: [0.05, 0.35], 3: [0.15, 0.5], 4: [0.2, 0.7], 5: [0.3, 0.9], 6: [0.4, 1.1] };
const TYPE_W: Record<QType, number> = { Descriptive: 0.2, Numerical: 0.6, 'Derivation/proof': 0.9, 'Design/analysis': 0.8 };

function depthBand(marks: number): [number, number] {
  if (marks <= 3) return [1, 2];
  if (marks <= 5) return [2, 3];
  if (marks <= 9) return [3, 4];
  return [3, 5];
}
function breadthBand(marks: number): [number, number] {
  if (marks <= 3) return [1, 1];
  if (marks <= 7) return [1, 2];
  if (marks <= 12) return [1, 3];
  return [2, 4];
}

export function parseOutcomes(text: string): Outcome[] {
  const found = new Map<string, string>();
  const re = /(?:^|\n|\s)CO\s*-?\s*(\d{1,2})\s*[:.)\-–—|]?\s+([A-Z][^\n]{14,300})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = `CO${+m[1]}`;
    const stmt = m[2].split(/\bCO\s*-?\d/)[0].trim();
    if (!/[a-z]{3,}\s+[a-z]{3,}/.test(stmt) || found.has(id)) continue;
    found.set(id, stmt);
  }
  return Array.from(found, ([id, t]) => ({ id, text: t })).sort((a, b) => +a.id.slice(2) - +b.id.slice(2));
}

function levelOf(code?: string): RbtLevel | null {
  const n = parseInt((code ?? '').replace(/\D/g, ''), 10);
  return n >= 1 && n <= 6 ? (n as RbtLevel) : null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function overallGrade(score: number | null): string {
  if (score == null) return '—';
  if (score >= 4.5) return 'Excellent';
  if (score >= 3.75) return 'Good';
  if (score >= 3) return 'Adequate';
  if (score >= 2) return 'Needs improvement';
  return 'Poor';
}

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

export function reviewPaper(
  data: ExamData,
  syllabusText: string,
  scope: Record<string, boolean>,
  overrides: Record<string, string>,
): PaperReview {
  const units = parseSyllabus(syllabusText);
  const hasSyllabus = units.length > 0;
  const outcomesList = hasSyllabus ? parseOutcomes(syllabusText) : [];
  const cov = hasSyllabus ? analyseCoverage(data, units, scope, overrides) : null;

  const durationMin = parseDurationMin(data.duration);

  // flatten the paper
  interface Flat { number: number; part: ExamPart; q: Question; text: string; marks: number; weight: number }
  const flat: Flat[] = [];
  let n = 1;
  for (const part of data.parts) {
    const count = Math.max(1, part.questions.length);
    const toAnswer = part.questionsToAnswer ?? part.questionCount ?? count;
    const share = Math.min(1, toAnswer / count);
    for (const q of part.questions) {
      flat.push({ number: n++, part, q, text: fullText(q), marks: part.marksPerQuestion, weight: part.marksPerQuestion * share });
    }
  }
  const filled = flat.filter((f) => f.text.trim());
  const totalWeight = filled.reduce((a, f) => a + f.weight, 0);
  const parsedMax = parseFloat((data.maxMarks ?? '').replace(/[^\d.]/g, ''));
  const maxMarks = parsedMax > 0 ? parsedMax : totalWeight;
  const minutesPerMark = durationMin && maxMarks ? durationMin / maxMarks : null;

  // per-question pre-computation
  const pre = filled.map((f) => {
    const meta = data.rbtMap?.[f.q.id];
    const auto = classifyRbt(f.text);
    const authorLevel = levelOf(meta?.rbt);
    const level = (authorLevel ?? auto.level) as RbtLevel;
    const type = questionType(f.text);
    const p = prose(f.text);
    const sentences = p.split(/[.?!]\s+/).filter((s) => s.trim().length > 8).length;
    const steps = Math.max(1, (f.q.subQuestions ?? []).length, sentences);
    const words = p.split(/\s+/).filter((w) => /[A-Za-z]/.test(w) && w !== 'MATH').length;
    const mathCount = (f.text.match(/\$[^$]+\$/g) ?? []).length;
    const hasContext = CONTEXT.test(f.text) || (f.text.match(/\d+(?:\.\d+)?/g) ?? []).length >= 2;
    const think = THINK[level] + 0.5 * (steps - 1);
    const ink = INK_PER_MARK[type] * f.marks;
    const d = clamp(
      0.35 * ((level - 1) / 5) + 0.25 * Math.min(1, (steps - 1) / 4) + 0.15 * Math.min(1, mathCount / 4) + 0.15 * TYPE_W[type] + 0.1 * Math.min(1, words / 80),
      0, 1);
    return { f, meta, auto, authorLevel, level, type, steps, words, hasContext, think, ink, d };
  });

  const typeCount: Record<string, number> = {};
  pre.forEach((x) => { typeCount[x.type] = (typeCount[x.type] ?? 0) + 1; });

  // unit shares (syllabus)
  const assignByNo = new Map(cov?.assignments.map((a) => [a.number, a]) ?? []);
  const unitById = new Map(units.map((u) => [u.id, u]));
  const inScopeUnits = units.filter((u) => scope[u.id] !== false);
  const unitWeight = new Map<string, number>();
  let assignedWeight = 0;
  pre.forEach(({ f }) => {
    const a = assignByNo.get(f.number);
    if (a && a.unitId && !a.outsideSyllabus && unitById.get(a.unitId) && scope[a.unitId] !== false) {
      unitWeight.set(a.unitId, (unitWeight.get(a.unitId) ?? 0) + f.weight);
      assignedWeight += f.weight;
    }
  });
  const hoursOk = inScopeUnits.length > 0 && inScopeUnits.every((u) => u.hours != null && u.hours > 0);
  const hoursSum = inScopeUnits.reduce((a, u) => a + (u.hours ?? 0), 0);
  const expectedPct = (u: { id: string; hours: number | null }) =>
    inScopeUnits.length === 0 ? null : hoursOk ? ((u.hours ?? 0) / hoursSum) * 100 : 100 / inScopeUnits.length;

  // topics per question
  const topicsByNo = new Map<number, string[]>();
  cov?.units.forEach((ur) => ur.topics.forEach((t) => t.questions.forEach((no) => {
    topicsByNo.set(no, [...(topicsByNo.get(no) ?? []), t.topic.text]);
  })));

  // CO → questions, for the paper-level coverage table
  const coQuestions = new Map<string, number[]>();

  const questions: QuestionReview[] = pre.map((x) => {
    const { f, meta, auto, authorLevel, level, type, steps, hasContext, think, ink, d } = x;
    const a = assignByNo.get(f.number);
    const unit = a?.unitId ? unitById.get(a.unitId) : undefined;
    const topics = (topicsByNo.get(f.number) ?? []).slice(0, 6);
    const res = {} as Record<CriterionKey, CriterionResult>;
    const label = RBT_LABELS[level];

    // 1 Breadth
    if (!hasSyllabus) {
      res.breadth = { score: null, rationale: 'Needs the syllabus (upload it on the Coverage tab or here).' };
    } else {
      const k = topics.length;
      const [lo, hi] = breadthBand(f.marks);
      let s: number; let rec: string | undefined;
      let why = `Touches ${k} syllabus topic${k === 1 ? '' : 's'} (wording match) for ${f.marks} marks; benchmark ${lo === hi ? lo : `${lo}–${hi}`}.`;
      if (k === 0) { s = 1; why = `Could not be traced to any topic of the syllabus (wording match) — ${f.marks} marks.`; rec = 'Tie the question to a named syllabus topic, using the syllabus wording.'; }
      else if (k >= lo && k <= hi) s = 5;
      else if (k === hi + 1) { s = 3; rec = 'Slightly broad for the marks: narrow it to fewer topics or raise the marks.'; }
      else if (k > hi) { s = 2; rec = 'Too broad for the marks: split it or focus on one or two topics.'; }
      else { s = 3; rec = 'Narrow for the marks: bring in a second related topic or lower the marks.'; }
      res.breadth = { score: L(s), rationale: why, recommendation: rec };
    }

    // 2 Depth
    {
      const [lo, hi] = depthBand(f.marks);
      const gap = level < lo ? lo - level : level > hi ? level - hi : 0;
      const s = [5, 4, 2, 1, 1][Math.min(gap, 4)];
      res.depth = {
        score: L(s),
        rationale: `Demand is L${level} ${label} for ${f.marks} marks; expected L${lo}–L${hi}.`,
        recommendation: gap === 0 ? undefined
          : level < lo ? 'Demand is low for the marks: ask for application or analysis (apply, compare, justify) or lower the marks.'
            : 'Demand is high for the marks: simplify the task or raise the marks.',
      };
    }

    // 3 Variety
    {
      const share = typeCount[type] / pre.length;
      let s = 5;
      const notes: string[] = [];
      if (pre.length >= 4) {
        if (share > 0.6) { s -= 2; notes.push('this type dominates the paper'); }
        else if (share > 0.4) { s -= 1; notes.push('this type is over-represented'); }
      }
      if (f.marks >= 5 && !hasContext) { s -= 1; notes.push('no concrete context or application'); }
      res.variety = {
        score: L(s),
        rationale: `Type: ${type} (${typeCount[type]} of ${pre.length} questions). Applied context: ${hasContext ? 'present' : 'absent'}.`,
        recommendation: s >= 4 ? undefined : `Vary the paper: ${notes.join('; ')}. Try a different task type or set it in a concrete case, dataset or scenario.`,
      };
    }

    // 4 Difficulty
    const diffLabel = d < 0.3 ? 'Easy' : d < 0.55 ? 'Moderate' : 'Difficult';
    {
      const exp = clamp(0.2 + f.marks * 0.04, 0.2, 0.65);
      const s = 5 - Math.round(Math.abs(d - exp) / 0.12);
      res.difficulty = {
        score: L(s),
        rationale: `Estimated difficulty ${d.toFixed(2)} (${diffLabel}); about ${exp.toFixed(2)} expected for ${f.marks} marks.`,
        recommendation: L(s) >= 4 ? undefined
          : d > exp ? 'Harder than the marks suggest: remove a step, give more data, or raise the marks.'
            : 'Easier than the marks suggest: add a reasoning step or an unfamiliar case, or lower the marks.',
      };
    }

    // 5 Time & marks
    const est = think + ink;
    const allot = minutesPerMark ? f.marks * minutesPerMark : null;
    if (allot == null) {
      res.time = { score: null, rationale: `Estimated answering time ≈ ${r1(est)} min. Enter a duration on the Edit tab to compare it with the time allowed.` };
    } else {
      const r = est / allot;
      const s = r >= 0.7 && r <= 1.0 ? 5 : (r >= 0.55 && r < 0.7) || (r > 1.0 && r <= 1.15) ? 4
        : (r >= 0.4 && r < 0.55) || (r > 1.15 && r <= 1.35) ? 3 : (r >= 0.25 && r < 0.4) || (r > 1.35 && r <= 1.6) ? 2 : 1;
      res.time = {
        score: L(s),
        rationale: `Estimated ≈ ${r1(est)} min against ≈ ${r1(allot)} min allowed for ${f.marks} marks (${pct(r * 100)}%).`,
        recommendation: s >= 4 ? undefined
          : r > 1 ? 'Takes longer than the marks allow: cut a step, shorten the data, or raise the marks.'
            : 'Takes much less time than the marks allow: add content or lower the marks.',
      };
    }

    // 6 Effort
    {
      const ratio = think / Math.max(ink, 0.1);
      const [lo, hi] = EFFORT_BAND[level];
      const dist = ratio < lo ? (lo - ratio) / lo : ratio > hi ? (ratio - hi) / hi : 0;
      const s = dist === 0 ? 5 : dist < 0.25 ? 4 : dist < 0.5 ? 3 : dist < 1 ? 2 : 1;
      res.effort = {
        score: L(s),
        rationale: `Thinking ≈ ${r1(think)} min, inking ≈ ${r1(ink)} min → think : ink = 1 : ${r1(ink / Math.max(think, 0.1))} (ratio ${ratio.toFixed(2)}; L${level} band ${lo}–${hi}).`,
        recommendation: s >= 4 ? undefined
          : ratio < lo ? 'Mostly writing, little thinking: add a justify/compare/apply element, or reduce the marks.'
            : 'Heavy thinking for little writing: raise the marks, or ask for working to be shown.',
      };
    }

    // 7 Bloom
    {
      let s = auto.matchedVerbs.length === 0 ? 2 : auto.confidence >= 0.7 ? 5 : auto.confidence >= 0.55 ? 4 : auto.confidence >= 0.4 ? 3 : 2;
      const notes: string[] = [];
      if (authorLevel && authorLevel !== auto.level) {
        const diff = Math.abs(authorLevel - auto.level);
        s = Math.max(1, s - (diff >= 2 ? 2 : 1));
        notes.push(`RBT tab says L${authorLevel}, wording suggests L${auto.level}`);
      }
      res.bloom = {
        score: L(s),
        rationale: `${auto.matchedVerbs.length ? `Task verb “${auto.matchedVerbs[0]}”` : 'No recognised task verb'} → L${auto.level} ${auto.label} (confidence ${pct(auto.confidence * 100)}%).${notes.length ? ' ' + notes.join('; ') + '.' : ''}`,
        recommendation: s >= 4 ? undefined
          : notes.length ? 'Reconcile the RBT level with the wording: change the level, or reword the task verb to match.'
            : 'Open the question with one clear task verb (e.g. “Explain”, “Compute”, “Compare”) so the level is unambiguous.',
      };
    }

    // 8 Distribution
    if (!hasSyllabus) {
      res.distribution = { score: null, rationale: 'Needs the syllabus.' };
    } else if (!a || !a.unitId || a.outsideSyllabus || !unit) {
      res.distribution = { score: 1, rationale: 'Not placed in any syllabus unit (or marked as outside the syllabus).', recommendation: 'Align with a syllabus unit, or correct the unit on the Coverage tab if it was mis-detected.' };
    } else if (scope[unit.id] === false) {
      res.distribution = { score: 2, rationale: `${unit.label} is outside the units selected for this CIA.`, recommendation: 'Move the question into a unit in scope for this CIA, or add the unit to the scope on the Coverage tab.' };
    } else {
      const share = assignedWeight ? ((unitWeight.get(unit.id) ?? 0) / assignedWeight) * 100 : 0;
      const exp = expectedPct(unit) ?? 0;
      const dev = Math.abs(share - exp);
      const s = dev <= 10 ? 5 : dev <= 20 ? 4 : dev <= 30 ? 3 : dev <= 40 ? 2 : 1;
      res.distribution = {
        score: L(s),
        rationale: `${unit.label} carries ${pct(share)}% of the marks against ${pct(exp)}% expected (${hoursOk ? 'by teaching hours' : 'equal share'}); ${pct(dev)} points apart.`,
        recommendation: s >= 4 ? undefined : share > exp ? `${unit.label} is over-weighted: shift marks to under-covered units.` : `${unit.label} is under-weighted: add or enlarge a question from it.`,
      };
    }

    // 9 Outcome
    const declared = Array.from(new Set(((meta?.co ?? '').match(/CO\s*-?\s*\d+/gi) ?? []).map((c) => `CO${+c.replace(/\D/g, '')}`)));
    declared.forEach((id) => coQuestions.set(id, [...(coQuestions.get(id) ?? []), f.number]));
    if (!hasSyllabus) {
      res.outcome = { score: null, rationale: 'Needs the syllabus.' };
    } else if (declared.length === 0) {
      res.outcome = { score: 2, rationale: 'No CO is set for this question.', recommendation: 'Set the CO on the RBT tab so alignment can be checked.' };
    } else if (outcomesList.length === 0) {
      res.outcome = { score: 3, rationale: `${declared.join(', ')} declared, but no Course Outcomes could be read from the syllabus to verify it.`, recommendation: 'Include the CO statements (“CO1: …”) in the syllabus text to enable the check.' };
    } else {
      const qk = kw(f.text);
      const overlapOf = (o: Outcome) => { const ck = kw(o.text); let h = 0; ck.forEach((w) => { if (qk.has(w)) h++; }); return ck.size ? h / ck.size : 0; };
      const found = declared.map((id) => outcomesList.find((o) => o.id === id));
      if (found.some((o) => !o)) {
        res.outcome = { score: 1, rationale: `${declared.filter((id, i) => !found[i]).join(', ')} is not in the syllabus.`, recommendation: 'Use a CO that exists in the syllabus.' };
      } else {
        const best = (found as Outcome[]).map((o) => ({ o, ov: overlapOf(o) })).sort((p, q) => q.ov - p.ov)[0];
        const alt = outcomesList.filter((o) => !declared.includes(o.id)).map((o) => ({ o, ov: overlapOf(o) })).sort((p, q) => q.ov - p.ov)[0];
        let s = best.ov >= 0.2 ? 5 : best.ov >= 0.1 ? 4 : best.ov >= 0.04 ? 3 : 2;
        const notes: string[] = [];
        const coLevel = classifyRbt(best.o.text).level;
        if (level < coLevel - 1) { s -= 1; notes.push(`the question (L${level}) asks for less than ${best.o.id} (L${coLevel})`); }
        if (alt && alt.ov >= 0.1 && alt.ov - best.ov >= 0.15) { s -= 1; notes.push(`${alt.o.id} matches the wording better`); }
        res.outcome = {
          score: L(s),
          rationale: `${declared.join(', ')}: wording overlap with ${best.o.id} ≈ ${pct(best.ov * 100)}%${unit ? `; unit match ${unit.label}` : ''}.${notes.length ? ' ' + notes.join('; ') + '.' : ''}`,
          recommendation: s >= 4 ? undefined : 'Check the CO mapping, or reword the question so it clearly exercises the outcome (use the CO’s key terms and demand level).',
        };
      }
    }

    const scores = Object.values(res).map((r) => r.score).filter((v): v is Likert => v != null);
    const recs = Array.from(new Set(Object.values(res).map((r) => r.recommendation).filter((v): v is string => !!v)));
    return {
      number: f.number, partName: f.part.name, questionId: f.q.id, text: f.text, marks: f.marks, weight: f.weight,
      unitLabel: unit?.label ?? '—', co: declared.join(', ') || '—',
      rbtCode: `L${level}`, rbtLabel: label, qtype: type,
      difficulty: r1(d * 100) / 100, difficultyLabel: diffLabel,
      thinkMin: r1(think), inkMin: r1(ink), estMin: r1(est), allotMin: allot == null ? null : r1(allot),
      topics, results: res, average: mean(scores) == null ? null : r1(mean(scores)!),
      recommendations: recs.length ? recs : ['No change needed — meets the benchmarks on every criterion that could be checked.'],
    };
  });

  /* ---- paper-level ---- */
  const avg = (weighted: boolean) => {
    const out = {} as Record<CriterionKey, number | null>;
    CRITERIA.forEach(({ key }) => {
      const rows = questions.filter((q) => q.results[key].score != null);
      if (!rows.length) { out[key] = null; return; }
      const w = rows.reduce((a, q) => a + (weighted ? q.weight : 1), 0) || 1;
      out[key] = r1(rows.reduce((a, q) => a + (q.results[key].score as number) * (weighted ? q.weight : 1), 0) / w);
    });
    return out;
  };
  const avgUnweighted = avg(false);
  const avgWeighted = avg(true);
  const vals = (o: Record<CriterionKey, number | null>) => Object.values(o).filter((v): v is number => v != null);
  const overall = mean(vals(avgUnweighted)) == null ? null : r1(mean(vals(avgUnweighted))!);
  const overallWeighted = mean(vals(avgWeighted)) == null ? null : r1(mean(vals(avgWeighted))!);

  const w = (pred: (q: QuestionReview) => boolean) => (totalWeight ? (questions.filter(pred).reduce((a, q) => a + q.weight, 0) / totalWeight) * 100 : 0);
  const lvl = (q: QuestionReview) => parseInt(q.rbtCode.slice(1), 10);
  const bloomMix = { low: pct(w((q) => lvl(q) <= 2)), mid: pct(w((q) => lvl(q) === 3 || lvl(q) === 4)), high: pct(w((q) => lvl(q) >= 5)) };
  const difficultyMix = { easy: pct(w((q) => q.difficultyLabel === 'Easy')), moderate: pct(w((q) => q.difficultyLabel === 'Moderate')), hard: pct(w((q) => q.difficultyLabel === 'Difficult')) };

  const unitRows: UnitRow[] = units.map((u) => {
    const ur = cov?.units.find((x) => x.unit.id === u.id);
    const mk = unitWeight.get(u.id) ?? 0;
    const inScope = scope[u.id] !== false;
    return {
      label: u.label, title: u.title, inScope, marks: r1(mk), sharePct: assignedWeight && inScope ? pct((mk / assignedWeight) * 100) : 0,
      expectedPct: inScope && expectedPct(u) != null ? pct(expectedPct(u)!) : null,
      topicsCovered: ur?.covered ?? 0, topicsPartial: ur?.partial ?? 0, topicsTotal: ur?.total ?? u.topics.length,
    };
  });
  const outcomes: OutcomeRow[] = outcomesList.map((o) => ({ id: o.id, text: o.text, questions: coQuestions.get(o.id) ?? [] }));

  const paperLoadPct = durationMin ? pct((questions.reduce((a, q) => a + q.estMin * (q.weight / Math.max(q.marks, 0.0001)), 0) / durationMin) * 100) : null;

  /* ---- narrative ---- */
  const named = CRITERIA.filter((c) => avgUnweighted[c.key] != null).map((c) => ({ c, v: avgUnweighted[c.key] as number }));
  const summary: string[] = [];
  const recs: string[] = [];
  if (!questions.length) {
    summary.push('No questions have been typed yet, so there is nothing to review.');
  } else {
    const best = [...named].sort((a, b) => b.v - a.v)[0];
    const worst = [...named].sort((a, b) => a.v - b.v)[0];
    summary.push(`Overall rating ${overall} / 5 (${overallGrade(overall)}); weighted by marks ${overallWeighted} / 5. ${questions.length} question${questions.length === 1 ? '' : 's'} reviewed${filled.length < flat.length ? `, ${flat.length - filled.length} blank skipped` : ''}.`);
    if (best && worst) summary.push(`Strongest criterion: ${best.c.name} (${best.v}). Weakest: ${worst.c.name} (${worst.v}).`);
    summary.push(`Bloom's mix by marks: ${bloomMix.low}% L1–L2, ${bloomMix.mid}% L3–L4, ${bloomMix.high}% L5–L6 (benchmark about 30 / 50 / 20).`);
    summary.push(`Estimated difficulty by marks: ${difficultyMix.easy}% easy, ${difficultyMix.moderate}% moderate, ${difficultyMix.hard}% difficult (benchmark about 30 / 50 / 20).`);
    if (paperLoadPct != null) summary.push(`Estimated answering time is about ${paperLoadPct}% of the ${durationMin}-minute duration (benchmark 70–100%).`);
    summary.push(`Task types: ${Object.entries(typeCount).map(([t, c]) => `${t} ${c}`).join(', ')}.`);
    if (hasSyllabus) {
      const empty = unitRows.filter((u) => u.inScope && u.sharePct === 0);
      summary.push(empty.length ? `No marks fall in: ${empty.map((u) => u.label).join(', ')}.` : 'Every unit in scope receives some marks.');
      if (outcomesList.length) {
        const miss = outcomes.filter((o) => o.questions.length === 0).map((o) => o.id);
        summary.push(miss.length ? `Course Outcomes with no question mapped: ${miss.join(', ')}.` : 'Every Course Outcome in the syllabus has at least one question.');
      }
    } else {
      summary.push('Breadth, unit distribution and outcome alignment were not rated because no syllabus has been supplied.');
    }
    if (bloomMix.high === 0) recs.push('No question reaches L5–L6; consider one evaluate/create item if the course outcomes call for it.');
    if (bloomMix.low > 50) recs.push('More than half the marks sit at L1–L2; raise the demand of some questions.');
    if (paperLoadPct != null && paperLoadPct > 100) recs.push(`Estimated time is ${paperLoadPct}% of the duration: trim the paper or extend the time.`);
    if (paperLoadPct != null && paperLoadPct < 60) recs.push(`Estimated time is only ${paperLoadPct}% of the duration: the paper may be too light.`);
    if (hasSyllabus) unitRows.filter((u) => u.inScope && u.expectedPct != null && Math.abs(u.sharePct - u.expectedPct) > 20)
      .forEach((u) => recs.push(`${u.label} carries ${u.sharePct}% of marks vs ${u.expectedPct}% expected; rebalance.`));
    [...questions].sort((a, b) => (a.average ?? 9) - (b.average ?? 9)).slice(0, 3).filter((q) => (q.average ?? 5) < 4)
      .forEach((q) => recs.push(`Q${q.number} (average ${q.average}): ${q.recommendations[0]}`));
    if (!recs.length) recs.push('No paper-level changes needed; see the per-question notes for fine-tuning.');
  }

  const assumptions = [
    'Ratings are on a 1–5 Likert scale: 5 Very good, 4 Good, 3 Adequate, 2 Weak, 1 Poor.',
    'Benchmarks are working benchmarks used by this tool, not a published standard; adjust them in src/lib/review.ts to your department’s norms.',
    'Topic, unit and outcome matching is by wording, not meaning. The unit of a question can be corrected on the Coverage tab.',
    'Thinking and inking times, and the difficulty index, are estimates from the task verb, number of steps, question type and marks.',
    durationMin ? `Duration read as ${durationMin} minutes (“${data.duration}”; two-digit decimals such as 1.30 are read as hours.minutes).` : 'Duration could not be read, so time allowance was not compared.',
    'Unit-wise outcomes are checked through the unit match under criterion 8; Course Outcomes through criterion 9.',
    'Mark-weighted figures count a question’s marks by the share of the part the student must answer (choice questions count proportionally).',
  ];

  return {
    hasSyllabus, questions, blankCount: flat.length - filled.length, avgUnweighted, avgWeighted, overall, overallWeighted,
    grade: overallGrade(overall), bloomMix, difficultyMix, typeMix: typeCount, units: unitRows, outcomes,
    durationMin, maxMarks, minutesPerMark, paperLoadPct, summary, topRecommendations: recs, assumptions,
  };
}
