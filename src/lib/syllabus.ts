/**
 * Syllabus coverage.
 *
 * 1. parseSyllabus() turns syllabus text into units and topics. It looks for
 *    headings such as "UNIT I", "Unit 2" or "Module 3", reads the hours if
 *    they are written next to the heading, and splits the unit body into
 *    topics at commas, semicolons, bullets and line breaks.
 * 2. analyseCoverage() matches every question against every topic by wording
 *    (stemmed keywords, rarer words count for more) and reports, per unit:
 *    how many topics are covered, and what share of the paper's marks falls
 *    in that unit.
 *
 * It matches wording, not meaning. A question that says "backpropagation"
 * will match a topic written "error back-propagation", but a question that
 * only describes the idea in different words may be missed. The tab lets the
 * user correct which unit a question belongs to.
 */
import type { ExamData } from '../types';

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export interface SyllabusTopic {
  id: string;
  text: string;
  /** Words that must appear for the topic to count (outside brackets). */
  keywords: string[];
  /** Bracketed examples, e.g. (sigmoid, tanh, ReLU): they help a match but are not required. */
  extras: string[];
}

export interface SyllabusUnit {
  id: string;
  label: string; // "Unit I"
  title: string; // "Introduction to Neural Networks" (may be empty)
  hours: number | null;
  topics: SyllabusTopic[];
}

export type TopicStatus = 'covered' | 'partial' | 'missed';

export interface TopicResult {
  topic: SyllabusTopic;
  status: TopicStatus;
  score: number;
  questions: number[]; // question numbers that cover it
}

export interface UnitResult {
  unit: SyllabusUnit;
  inScope: boolean;
  topics: TopicResult[];
  covered: number;
  partial: number;
  total: number;
  coveragePct: number; // fully covered topics / total
  partialPct: number; // partly covered topics / total
  marks: number;
  marksPct: number;
  hoursPct: number | null;
  questions: number[];
}

export interface Assignment {
  number: number;
  questionId: string;
  partName: string;
  text: string;
  marks: number; // weighted marks (choice questions count for their share)
  autoUnitId: string | null;
  unitId: string | null; // after the user's override
  overridden: boolean;
  /** "none" = deliberately marked as not in the syllabus. */
  outsideSyllabus: boolean;
  alsoUnitIds: string[];
  score: number;
}

export interface Finding {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface CoverageReport {
  units: UnitResult[];
  assignments: Assignment[];
  unmatched: Assignment[];
  outsidePortion: Assignment[];
  totalMarks: number;
  unmatchedMarks: number;
  outsideMarks: number;
  overallCoveragePct: number;
  overallPartialPct: number;
  topicsTotal: number;
  topicsCovered: number;
  findings: Finding[];
}

/** Value to store in the overrides map for "this question is not in the syllabus". */
export const OUTSIDE = '__outside__';

/* ------------------------------------------------------------------ */
/* text → keywords                                                     */
/* ------------------------------------------------------------------ */

const STOP = new Set((
  'a an the of in on at to for from by with without and or nor but as is are was were be been being it its this that these those ' +
  'then than so such into onto over under about between among within through using use used based via per each any all both ' +
  'can may might will shall should would could do does did has have had not no yes if else when where which who whom whose what why how ' +
  'introduction intro basic basics concept concepts overview fundamental fundamentals general related different various types type ' +
  'application applications study simple working principle principles importance need role example examples ' +
  'unit module chapter topic topics hour hours explain define describe discuss write state give find ' +
  'model models modelling algorithm algorithms problem problems technique techniques method methods ' +
  'their there they them we you your our one two three four five also etc'
).split(/\s+/));

const SUFFIXES = [
  'izations', 'ization', 'isation', 'ational', 'ations', 'ation', 'ments', 'ment', 'ities', 'ity',
  'ings', 'ing', 'ness', 'ally', 'ies', 'ied', 'ed', 'es', 'ly', 's',
];

function stem(raw: string): string {
  let w = raw.replace(/'s$/, '');
  if (w.length <= 3) return w;
  for (const suf of SUFFIXES) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/** Strip LaTeX so formulas don't leak symbols into the word list. */
function stripMath(s: string): string {
  return s.replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, ' ').replace(/\\[a-zA-Z]+/g, ' ');
}

function wordsOf(s: string): string[] {
  return stripMath(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}

function keywordsOf(s: string): string[] {
  const all = wordsOf(s).map(stem);
  const kept = wordsOf(s).filter((w) => !STOP.has(w)).map(stem);
  const out = kept.length ? kept : all; // a topic like "Introduction" keeps its only word
  return Array.from(new Set(out));
}

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** Same stem, a shared long prefix (propag / propagat), or a compound that contains it. */
function tokenMatches(keyword: string, tokens: string[], set: Set<string>): boolean {
  if (set.has(keyword)) return true;
  for (const t of tokens) {
    const min = Math.min(keyword.length, t.length);
    const max = Math.max(keyword.length, t.length);
    const cp = commonPrefix(keyword, t);
    if (min >= 5 && cp >= Math.max(5, Math.ceil(min * 0.8)) && cp >= max * 0.7) return true;
    if (keyword.length >= 6 && t.length >= keyword.length + 4 && t.includes(keyword)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* parsing                                                             */
/* ------------------------------------------------------------------ */

const TRAILER = /\b(Text\s*Books?|TEXT\s*BOOKS?|Reference\s*Books?|REFERENCE\s*BOOKS?|References|REFERENCES|Course\s+Outcomes?|COURSE\s+OUTCOMES?|Course\s+Delivery|Suggested\s+Readings?)\b/;

const HEADING =
  /(?:^|[\s|(\[])((?:UNIT|Unit|MODULE|Module)\s*[-–—:.]?\s*(?:[IVX]{1,4}|\d{1,2}))(?![A-Za-z0-9])/g;

function splitTopics(body: string): string[] {
  // Protect commas inside brackets: "activation functions (sigmoid, tanh, ReLU)".
  const guarded = body.replace(/\(([^)]*)\)/g, (_, inner: string) => `(${inner.replace(/,/g, '§')})`);
  return guarded
    .split(/[;\n•●▪◦·|]|,|\.\s+(?=[A-Z0-9])|\s[–—-]\s/)
    .map((t) => t.replace(/§/g, ',').replace(/^\s*(?:\(?[a-z0-9]{1,2}[.)]\s+)/i, '').replace(/[.:]+$/, '').trim())
    .filter((t) => t.length >= 3 && /[A-Za-z]/.test(t));
}

function unitFromSegment(label: string, seg: string, index: number): SyllabusUnit {
  let text = seg.replace(/^[\s:.\-–—|]+/, '');

  // Hours, e.g. "(9 Hours)" — taken out so it doesn't become a topic.
  let hours: number | null = null;
  const hm = text.match(/[(\[]?[ ]*(\d{1,2})[ ]*(?:hours?|hrs?\.?|periods?|lectures?)[ ]*[)\]]?/i);
  if (hm) {
    hours = parseInt(hm[1], 10);
    text = text.replace(hm[0], ' ');
  }

  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  let title = '';
  let bodyLines = lines;
  if (lines.length > 1 && lines[0].length <= 90 && !/[,;]/.test(lines[0])) {
    title = lines[0].replace(/[:.\-–—|\s]+$/, '').trim();
    bodyLines = lines.slice(1);
  } else if (lines.length === 1) {
    const m = lines[0].match(/^([^:]{3,80}):\s*(.+)$/);
    if (m && !/[,;]/.test(m[1])) {
      title = m[1].trim();
      bodyLines = [m[2]];
    }
  }

  const seen = new Set<string>();
  const topics: SyllabusTopic[] = [];
  splitTopics(bodyLines.join('\n')).forEach((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const inside = Array.from(t.matchAll(/\(([^)]*)\)/g)).map((x) => x[1]).join(' ');
    const outside = t.replace(/\([^)]*\)/g, ' ');
    let keywords = keywordsOf(outside);
    let extras = keywordsOf(inside).filter((k) => !keywords.includes(k));
    if (keywords.length === 0) { keywords = extras; extras = []; }
    if (keywords.length === 0) return;
    topics.push({ id: `u${index}t${topics.length + 1}`, text: t, keywords, extras });
  });

  return { id: `u${index}`, label, title, hours, topics };
}

export function parseSyllabus(raw: string): SyllabusUnit[] {
  const text = (raw ?? '').replace(/\r/g, '\n').replace(/[\u00a0\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (!text) return [];

  const heads: { label: string; key: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  HEADING.lastIndex = 0;
  while ((m = HEADING.exec(text))) {
    const token = m[1];
    const start = m.index + m[0].indexOf(token);
    const num = token.replace(/^(?:UNIT|Unit|MODULE|Module)\s*[-–—:.]?\s*/, '').toUpperCase();
    const word = /^(?:MODULE|Module)/.test(token) ? 'Module' : 'Unit';
    heads.push({ label: `${word} ${num}`, key: `${word}-${num}`, start, end: start + token.length });
  }

  if (heads.length === 0) {
    // No headings: treat the whole text as one block so the tool still works.
    const cut = text.search(TRAILER);
    const u = unitFromSegment('Syllabus', cut > 0 ? text.slice(0, cut) : text, 1);
    return u.topics.length ? [u] : [];
  }

  const merged = new Map<string, { label: string; seg: string }>();
  heads.forEach((h, i) => {
    let seg = text.slice(h.end, i + 1 < heads.length ? heads[i + 1].start : text.length);
    if (i === heads.length - 1) {
      const cut = seg.search(TRAILER);
      if (cut >= 0) seg = seg.slice(0, cut);
    }
    const prev = merged.get(h.key);
    if (prev) prev.seg += '\n' + seg;
    else merged.set(h.key, { label: h.label, seg });
  });

  const units: SyllabusUnit[] = [];
  let idx = 1;
  merged.forEach(({ label, seg }) => {
    const u = unitFromSegment(label, seg, idx++);
    if (u.topics.length) units.push(u);
  });
  return units;
}

/* ------------------------------------------------------------------ */
/* analysis                                                            */
/* ------------------------------------------------------------------ */

const COVERED_AT = 0.5;
const PARTIAL_AT = 0.25;

function questionText(q: { text: string; subQuestions?: { text: string }[] }): string {
  return [q.text, ...(q.subQuestions ?? []).map((s) => s.text)].filter((t) => t && t.trim()).join(' ');
}

export function analyseCoverage(
  data: ExamData,
  units: SyllabusUnit[],
  scope: Record<string, boolean>,
  overrides: Record<string, string>,
): CoverageReport {
  const inScope = (u: SyllabusUnit) => scope[u.id] !== false;

  // Rarer keywords count for more: "perceptron" says more than "network".
  const df = new Map<string, number>();
  let topicCount = 0;
  units.forEach((u) => u.topics.forEach((t) => {
    topicCount++;
    t.keywords.forEach((k) => df.set(k, (df.get(k) ?? 0) + 1));
  }));
  const weight = (k: string) => Math.log(1 + topicCount / (df.get(k) ?? 1));

  // Flatten the paper.
  interface Q { number: number; id: string; partName: string; text: string; marks: number; tokens: string[]; set: Set<string> }
  const qs: Q[] = [];
  let n = 1;
  for (const part of data.parts) {
    const count = Math.max(1, part.questions.length);
    const toAnswer = part.questionsToAnswer ?? part.questionCount ?? count;
    const share = Math.min(1, toAnswer / count); // "any 3 of 4", or one of each OR pair
    for (const q of part.questions) {
      const text = questionText(q);
      const tokens = Array.from(new Set(wordsOf(text).map(stem)));
      qs.push({
        number: n++, id: q.id, partName: part.name, text,
        marks: part.marksPerQuestion * share, tokens, set: new Set(tokens),
      });
    }
  }
  const filled = qs.filter((q) => q.text.trim());

  // topic × question scores
  const score = new Map<string, number[]>(); // topic id → per-filled-question score
  units.forEach((u) => u.topics.forEach((t) => {
    const total = t.keywords.reduce((a, k) => a + weight(k), 0) || 1;
    score.set(t.id, filled.map((q) => {
      const got = t.keywords.reduce((a, k) => a + (tokenMatches(k, q.tokens, q.set) ? weight(k) : 0), 0);
      const bonus = t.extras.reduce((a, k) => a + (tokenMatches(k, q.tokens, q.set) ? weight(k) : 0), 0);
      return Math.min(1, (got + bonus) / total);
    }));
  }));

  // question → unit
  const assignments: Assignment[] = filled.map((q, qi) => {
    const unitScores = units.map((u) => ({
      id: u.id,
      s: u.topics.reduce((a, t) => {
        const v = score.get(t.id)![qi];
        return v >= PARTIAL_AT ? a + v * v : a;
      }, 0),
    }));
    unitScores.sort((a, b) => b.s - a.s);
    const best = unitScores[0];
    const autoUnitId = best && best.s >= 0.2 ? best.id : null;
    const also = autoUnitId
      ? unitScores.filter((u) => u.id !== autoUnitId && u.s >= best.s * 0.75).map((u) => u.id)
      : [];

    const ov = overrides[q.id];
    const outsideSyllabus = ov === OUTSIDE;
    const forced = ov && ov !== OUTSIDE && units.some((u) => u.id === ov) ? ov : null;
    return {
      number: q.number,
      questionId: q.id,
      partName: q.partName,
      text: q.text,
      marks: q.marks,
      autoUnitId,
      unitId: outsideSyllabus ? null : forced ?? autoUnitId,
      overridden: Boolean(forced) || outsideSyllabus,
      outsideSyllabus,
      alsoUnitIds: also,
      score: best?.s ?? 0,
    };
  });

  const totalMarks = assignments.reduce((a, x) => a + x.marks, 0);
  const unitById = new Map(units.map((u) => [u.id, u]));
  const scoped = units.filter(inScope);
  const hoursKnown = scoped.length > 0 && scoped.every((u) => u.hours !== null);
  const hoursSum = scoped.reduce((a, u) => a + (u.hours ?? 0), 0);

  const unitResults: UnitResult[] = units.map((u) => {
    const topics: TopicResult[] = u.topics.map((t) => {
      const row = score.get(t.id)!;
      let best = 0;
      const hits: number[] = [];
      row.forEach((v) => { if (v > best) best = v; });
      const status: TopicStatus = best >= COVERED_AT ? 'covered' : best >= PARTIAL_AT ? 'partial' : 'missed';
      const floor = status === 'covered' ? COVERED_AT : PARTIAL_AT;
      row.forEach((v, qi) => { if (v >= floor) hits.push(filled[qi].number); });
      return { topic: t, status, score: best, questions: status === 'missed' ? [] : hits };
    });
    const covered = topics.filter((t) => t.status === 'covered').length;
    const partial = topics.filter((t) => t.status === 'partial').length;
    const mine = assignments.filter((a) => a.unitId === u.id);
    const marks = mine.reduce((a, x) => a + x.marks, 0);
    return {
      unit: u,
      inScope: inScope(u),
      topics,
      covered,
      partial,
      total: topics.length,
      coveragePct: topics.length ? Math.round((100 * covered) / topics.length) : 0,
      partialPct: topics.length ? Math.round((100 * partial) / topics.length) : 0,
      marks,
      marksPct: totalMarks ? Math.round((1000 * marks) / totalMarks) / 10 : 0,
      hoursPct: hoursKnown && inScope(u) && hoursSum ? Math.round((1000 * (u.hours ?? 0)) / hoursSum) / 10 : null,
      questions: mine.map((a) => a.number),
    };
  });

  const unmatched = assignments.filter((a) => !a.unitId && !a.outsideSyllabus);
  const outsideFlagged = assignments.filter((a) => a.outsideSyllabus);
  const outsidePortion = assignments.filter((a) => a.unitId && !inScope(unitById.get(a.unitId)!));

  const scopedResults = unitResults.filter((r) => r.inScope);
  const topicsTotal = scopedResults.reduce((a, r) => a + r.total, 0);
  const topicsCovered = scopedResults.reduce((a, r) => a + r.covered, 0);
  const topicsPartial = scopedResults.reduce((a, r) => a + r.partial, 0);

  // Findings
  const findings: Finding[] = [];
  const list = (xs: Assignment[]) => xs.map((x) => `Q${x.number}`).join(', ');
  const inScopeMarks = scopedResults.reduce((a, r) => a + r.marks, 0);
  for (const r of scopedResults) {
    const name = r.unit.title ? `${r.unit.label} (${r.unit.title})` : r.unit.label;
    if (filled.length > 0 && r.questions.length === 0) {
      findings.push({ severity: 'error', message: `No question comes from ${name}.` });
    } else if (r.total > 0 && r.coveragePct < 30 && filled.length > 0) {
      findings.push({
        severity: 'warning',
        message: `Only ${r.coveragePct}% of ${name} topics are covered (${r.covered} of ${r.total}).`,
      });
    }
    // Compare like with like: this unit's share of the marks that fall inside the chosen portion.
    const share = inScopeMarks ? Math.round((1000 * r.marks) / inScopeMarks) / 10 : 0;
    if (r.hoursPct !== null && inScopeMarks > 0 && Math.abs(share - r.hoursPct) >= 12) {
      findings.push({
        severity: 'warning',
        message: share < r.hoursPct
          ? `${name} has ${r.hoursPct}% of the teaching hours but only ${share}% of the marks.`
          : `${name} has ${r.hoursPct}% of the teaching hours but ${share}% of the marks.`,
      });
    }
  }
  if (outsidePortion.length) {
    findings.push({
      severity: 'warning',
      message: `${list(outsidePortion)} look${outsidePortion.length === 1 ? 's' : ''} like ${outsidePortion.length === 1 ? 'it belongs' : 'they belong'} to a unit that is not part of this exam’s portion.`,
    });
  }
  if (unmatched.length) {
    findings.push({
      severity: 'warning',
      message: `${list(unmatched)} could not be matched to any syllabus topic. ${unmatched.length === 1 ? 'It' : 'They'} may be out of syllabus, or worded very differently from it.`,
    });
  }
  if (outsideFlagged.length) {
    findings.push({
      severity: 'info',
      message: `${list(outsideFlagged)} marked as not in the syllabus.`,
    });
  }

  return {
    units: unitResults,
    assignments,
    unmatched,
    outsidePortion,
    totalMarks,
    unmatchedMarks: [...unmatched, ...outsideFlagged].reduce((a, x) => a + x.marks, 0),
    outsideMarks: outsidePortion.reduce((a, x) => a + x.marks, 0),
    overallCoveragePct: topicsTotal ? Math.round((100 * topicsCovered) / topicsTotal) : 0,
    overallPartialPct: topicsTotal ? Math.round((100 * topicsPartial) / topicsTotal) : 0,
    topicsTotal,
    topicsCovered,
    findings,
  };
}
