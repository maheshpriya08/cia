/**
 * Question-paper quality checker.
 *
 * Rule-based and fully offline: no API key, same result every run. It looks
 * for things a reviewer would flag on a first read — blank or placeholder
 * questions, vague wording, unbalanced maths, marks that do not add up,
 * references to a figure that is not there, near-duplicate questions, and a
 * level of demand that does not fit the marks.
 *
 * It is a first-pass reviewer, not a subject expert. It cannot tell whether a
 * question is mathematically correct or whether it matches the syllabus.
 */
import type { ExamData, ExamPart, Question } from '../types';
import { classifyRbt, analysePaper, RBT_LABELS, RbtLevel } from './bloom';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  /** Short category shown as a tag, e.g. "Clarity". */
  category: string;
  message: string;
  /** What to do about it. */
  fix?: string;
}

export type Grade = 'Excellent' | 'Good' | 'Needs work' | 'Poor';

export interface QuestionReport {
  number: number;
  partId: string;
  partName: string;
  questionId: string;
  text: string;
  marks: number;
  wordCount: number;
  rbtCode?: string;
  rbtLabel?: string;
  score: number;
  grade: Grade;
  issues: Issue[];
  isEmpty: boolean;
}

export interface PaperReport {
  /** null when there is nothing filled in yet to score. */
  score: number | null;
  grade: Grade | null;
  questions: QuestionReport[];
  paperIssues: Issue[];
  totals: { questions: number; filled: number; errors: number; warnings: number; infos: number };
  rbtCounts: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* text helpers                                                        */
/* ------------------------------------------------------------------ */

const DEDUCTION: Record<Severity, number> = { error: 25, warning: 12, info: 4 };

export function gradeFor(score: number): Grade {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 50) return 'Needs work';
  return 'Poor';
}

/** Text with maths replaced by a placeholder, so word counts and wording checks ignore LaTeX. */
function proseOnly(text: string): string {
  return text.replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, ' MATH ').replace(/\s+/g, ' ').trim();
}

function wordsOf(text: string): string[] {
  return proseOnly(text).split(/\s+/).filter((w) => /[A-Za-z]/.test(w) && w !== 'MATH');
}

function fullText(q: Question): string {
  return [q.text, ...(q.subQuestions ?? []).map((s) => s.text)].filter((t) => t && t.trim()).join(' ');
}

function tokens(text: string): Set<string> {
  const t = text.toLowerCase().replace(/\$/g, ' ');
  return new Set(t.match(/\\[a-z]+|[a-z0-9]+|[^\sa-z0-9]/g) ?? []);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((x) => { if (b.has(x)) inter++; });
  return inter / (a.size + b.size - inter);
}

const MISSPELLINGS: Record<string, string> = {
  recieve: 'receive', seperate: 'separate', occured: 'occurred', occurence: 'occurrence',
  definately: 'definitely', calculte: 'calculate', calcualte: 'calculate', evalute: 'evaluate',
  evaulate: 'evaluate', explian: 'explain', explaine: 'explain', discribe: 'describe',
  desribe: 'describe', defination: 'definition', difinition: 'definition', theorm: 'theorem',
  fuction: 'function', funtion: 'function', intergral: 'integral', integeral: 'integral',
  matirx: 'matrix', metrix: 'matrix', vecter: 'vector', probablity: 'probability',
  probabilty: 'probability', diffrent: 'different', diferent: 'different', beteween: 'between',
  wheather: 'whether', wich: 'which', thier: 'their', untill: 'until', comparision: 'comparison',
  relevent: 'relevant', neccessary: 'necessary', necesary: 'necessary', coefficent: 'coefficient',
  convergance: 'convergence', divergance: 'divergence', sequense: 'sequence', seqence: 'sequence',
  proove: 'prove', slove: 'solve', obtian: 'obtain', verfiy: 'verify',
};
const REAL_MISSPELLINGS = Object.entries(MISSPELLINGS);

/* ------------------------------------------------------------------ */
/* per-question checks                                                 */
/* ------------------------------------------------------------------ */

function checkQuestion(q: Question, part: ExamPart): { issues: Issue[]; rbt?: ReturnType<typeof classifyRbt>; words: number } {
  const issues: Issue[] = [];
  const text = fullText(q);
  const prose = proseOnly(text);
  const words = wordsOf(text);
  const marks = part.marksPerQuestion;
  const subs = q.subQuestions ?? [];
  const add = (severity: Severity, category: string, message: string, fix?: string) =>
    issues.push({ severity, category, message, fix });

  if (!text.trim()) {
    add('error', 'Completeness', 'This question is blank.', 'Type the question, or reduce the question count for this part.');
    return { issues, words: 0 };
  }

  // Placeholder / test text
  if (/\b(lorem|ipsum|asdf|qwerty|xxx+|todo|tbd|test question|sample question|dummy)\b/i.test(prose)) {
    add('error', 'Completeness', 'Looks like placeholder or test text.', 'Replace it with the real question.');
  }

  // Too short
  const hasMath = /\$/.test(text);
  if (words.length < 3 && !(hasMath && words.length >= 1)) {
    add('warning', 'Clarity', `Very short (${words.length} word${words.length === 1 ? '' : 's'}). Students may not know what is being asked.`,
      'State the task and the object it applies to, e.g. “Define a group and give one example.”');
  }

  // Too long
  if (words.length > 70) {
    add('warning', 'Length', `Long stem (${words.length} words). Long questions cost reading time and hide the actual task.`,
      'Trim the setup, or move data into a table and keep the question itself short.');
  } else if (marks > 0 && marks <= 2 && words.length > 35) {
    add('info', 'Length', `${words.length} words for a ${marks}-mark question is long.`);
  }

  // Bloom analysis
  const rbt = classifyRbt(text);
  const level = rbt.level as RbtLevel;

  // No clear task verb
  const endsWithQuestion = /\?\s*$/.test(prose);
  if (rbt.matchedVerbs.length === 0 && !endsWithQuestion) {
    add('warning', 'Clarity', 'No clear task verb found (define, explain, solve, prove…).',
      'Open with the action you want, so it is obvious what the student must do.');
  }

  // Several tasks stuffed into one stem
  if (subs.length === 0 && rbt.matchedVerbs.length >= 3) {
    add(marks <= 4 ? 'warning' : 'info', 'Clarity',
      `Packs ${rbt.matchedVerbs.length} tasks into one stem (${rbt.matchedVerbs.slice(0, 3).join(', ')}).`,
      'Split into (a), (b), (c) and give marks for each, so students and markers know the split.');
  }

  // Vague wording
  const vague: [RegExp, string, string][] = [
    [/\bwrite (?:about|on)\b/i, '“Write about” has no boundary.', 'Name the specific aspect to cover.'],
    [/\bwhat do you (?:know|understand)\b/i, '“What do you know/understand” cannot be marked objectively.', 'Replace with a concrete task such as “State…” or “Explain…”.'],
    [/\b(etc\.?|and so on|and so forth)\b/i, '“etc.” leaves the expected scope open.', 'List what you actually expect.'],
    [/\b(some|several|various|a few|many)\b/i, 'Unquantified wording (“some / several / various”).', 'Give a number, e.g. “two examples”.'],
    [/\b(good|appropriate|suitable|proper|nice)\b/i, 'Subjective word that a marker cannot check.', 'Say what makes an answer acceptable.'],
  ];
  for (const [re, msg, fix] of vague) {
    if (re.test(prose)) add('warning', 'Clarity', msg, fix);
  }
  if (/^\s*discuss\b/i.test(prose) && words.length < 8) {
    add('warning', 'Clarity', '“Discuss” on its own is open-ended.', 'Say what to discuss, and from which angle.');
  }
  if (/\bbriefly\b/i.test(prose) && marks >= 8) {
    add('warning', 'Marks', `“Briefly” sits oddly with a ${marks}-mark question.`, 'Either drop “briefly” or lower the marks.');
  }

  // Missing figure / table
  const refersToFigure =
    /\b(?:given|shown|following|above|below|in the)\s+(?:figure|fig\.?|diagram|graph|table|circuit|network)\b|\b(?:figure|fig\.?|diagram|graph|table|circuit|network)\s+(?:given|shown|below|above)\b|\bfig(?:ure)?\.?\s*\d+/i.test(prose);
  if (refersToFigure && (q.images?.length ?? 0) === 0 && (q.tables?.length ?? 0) === 0) {
    add('warning', 'Completeness', 'Refers to a figure, graph or table, but none is attached to this question.',
      'Add the image or table in the Edit tab, or reword the question.');
  }

  // Blank sub-question
  if (subs.some((s) => !s.text.trim())) {
    add('warning', 'Completeness', 'One or more sub-questions are blank.', 'Fill them in or delete them.');
  }

  // Sub-question marks
  if (subs.length > 0) {
    const withMarks = subs.filter((s) => typeof s.marks === 'number' && s.marks > 0);
    if (withMarks.length === subs.length) {
      const sum = withMarks.reduce((a, s) => a + (s.marks ?? 0), 0);
      if (marks > 0 && sum !== marks) {
        add('error', 'Marks', `Sub-question marks add up to ${sum}, but this part gives ${marks} per question.`,
          `Adjust the sub-question marks so they total ${marks}.`);
      }
    } else if (withMarks.length > 0) {
      add('warning', 'Marks', 'Marks are given on some sub-questions but not all.', 'Give every sub-question a mark, or none.');
    }
  }

  // Level of demand vs marks
  if (marks > 0 && marks <= 2 && level >= 5) {
    add('warning', 'Marks', `Reads as ${rbt.code} (${RBT_LABELS[level]}) but carries only ${marks} mark${marks === 1 ? '' : 's'}.`,
      'Higher-order tasks need more marks and time, or a simpler task.');
  }
  if (marks >= 8 && level <= 2 && subs.length === 0) {
    add('warning', 'Marks', `Reads as ${rbt.code} (${RBT_LABELS[level]}) but is worth ${marks} marks.`,
      'Add an application or analysis step, or move it to a lower-mark part.');
  }

  // Mechanical / typing errors
  const dup = prose.match(/\b([A-Za-z]{2,})\s+\1\b/i);
  if (dup && !/^(that|had)$/i.test(dup[1])) {
    add('warning', 'Typing', `Repeated word: “${dup[0]}”.`, 'Delete the duplicate.');
  }
  const lower = prose.toLowerCase();
  const found = REAL_MISSPELLINGS.filter(([wrong]) => new RegExp(`\\b${wrong}\\b`).test(lower));
  for (const [wrong, right] of found.slice(0, 3)) {
    add('warning', 'Typing', `Possible misspelling: “${wrong}” → “${right}”.`);
  }
  if (/\$(?!\$)/.test(text.replace(/\$\$/g, ''))) {
    const singles = (text.replace(/\$\$/g, '').match(/\$/g) ?? []).length;
    if (singles % 2 !== 0) {
      add('error', 'Maths', 'Unbalanced $ — the maths will not render properly.', 'Every formula needs an opening and a closing $.');
    }
  }
  if ((text.match(/\$\$/g) ?? []).length % 2 !== 0) {
    add('error', 'Maths', 'Unbalanced $$ — the display formula will not render.', 'Close the formula with $$.');
  }
  const noMath = text.replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, '');
  const open = (noMath.match(/\(/g) ?? []).length;
  const close = (noMath.match(/\)/g) ?? []).length;
  if (open !== close) {
    add('warning', 'Typing', 'Brackets do not match.', 'Check for a missing “(” or “)”.');
  }
  if (/\s{2,}/.test(q.text.trim())) {
    add('info', 'Typing', 'Double spaces in the question.');
  }
  if (/\s[,.;?]/.test(prose)) {
    add('info', 'Typing', 'Space before a punctuation mark.');
  }
  if (/^[a-z]/.test(q.text.trim())) {
    add('info', 'Typing', 'Does not start with a capital letter.');
  }
  const endsOk = /[.?:)]\s*$|\$\s*$/.test(q.text.trim()) || subs.length > 0;
  if (!endsOk) {
    add('info', 'Typing', 'No closing punctuation.', 'End with a full stop or question mark.');
  }
  if (/^(what|why|how|which|when|who|is|are|does|do|can|if)\b/i.test(prose) && !/[?]\s*$/.test(prose) && subs.length === 0 && /[.]\s*$/.test(prose)) {
    add('info', 'Typing', 'Phrased as a question but ends with a full stop.', 'Use a question mark.');
  }

  // Negative wording
  if (/\b(not|except|never|cannot|n't)\b/i.test(prose) && /\b(which|following|statement)\b/i.test(prose)) {
    add('info', 'Clarity', 'Negative wording (“which is NOT…”) trips up careful students.', 'Put the negative word in capitals or rephrase positively.');
  }

  return { issues, rbt, words: words.length };
}

/* ------------------------------------------------------------------ */
/* paper-level checks                                                  */
/* ------------------------------------------------------------------ */

function parseMarks(s: string): number | null {
  const m = (s ?? '').match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function checkPaper(data: ExamData): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, category: string, message: string, fix?: string) =>
    issues.push({ severity, category, message, fix });

  // Header
  const missing: string[] = [];
  if (!data.courseCode?.trim()) missing.push('course code');
  if (!data.courseName?.trim()) missing.push('course name');
  if (!data.semester?.trim()) missing.push('semester');
  if (!data.duration?.trim()) missing.push('duration');
  if (!data.maxMarks?.trim()) missing.push('maximum marks');
  if (missing.length) {
    add('warning', 'Header', `Header is missing: ${missing.join(', ')}.`, 'Fill these in on the Edit tab.');
  }

  // Marks arithmetic
  let sum = 0;
  for (const part of data.parts) {
    const attempt = part.questionsToAnswer ?? part.questionCount;
    const expected = attempt * part.marksPerQuestion;
    sum += expected;

    if (part.totalMarks !== expected) {
      add('error', 'Marks', `${part.name}: total is ${part.totalMarks}, but ${attempt} × ${part.marksPerQuestion} = ${expected}.`,
        'Correct the marks per question or the number to answer.');
    }
    if (part.questions.length !== part.questionCount) {
      add('warning', 'Structure', `${part.name}: says ${part.questionCount} questions but contains ${part.questions.length}.`);
    }
    if (attempt > part.questions.length) {
      add('error', 'Structure', `${part.name}: students must answer ${attempt}, but only ${part.questions.length} are set.`);
    }
    if (!part.instructions?.trim()) {
      add('info', 'Instructions', `${part.name} has no instruction line.`, 'Add one, e.g. “Answer all the questions”.');
    } else {
      const any = part.instructions.match(/any\s+(\d+)/i);
      if (any && parseInt(any[1], 10) !== attempt) {
        add('error', 'Instructions', `${part.name}: instruction says “any ${any[1]}” but the part is set to answer ${attempt}.`,
          'Make the instruction and the question count agree.');
      }
      if (/answer all/i.test(part.instructions) && attempt !== part.questionCount) {
        add('error', 'Instructions', `${part.name}: says “Answer all” but only ${attempt} of ${part.questionCount} are to be answered.`);
      }
    }
  }
  const max = parseMarks(data.maxMarks);
  if (max !== null && sum !== max) {
    add('error', 'Marks', `Parts add up to ${sum} marks, but the header says ${max}.`,
      'Either the header or the part marks need correcting.');
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

export function analyseQuality(data: ExamData): PaperReport {
  const reports: QuestionReport[] = [];
  const levels: RbtLevel[] = [];
  const levelById: Record<string, RbtLevel> = {};
  const tokenCache: { idx: number; set: Set<string> }[] = [];

  let n = 1;
  for (const part of data.parts) {
    for (const q of part.questions) {
      const { issues, rbt, words } = checkQuestion(q, part);
      const text = fullText(q);
      const isEmpty = !text.trim();
      if (rbt && !isEmpty) {
        levels.push(rbt.level as RbtLevel);
        levelById[q.id] = rbt.level as RbtLevel;
      }
      const idx = reports.length;
      reports.push({
        number: n++,
        partId: part.id,
        partName: part.name,
        questionId: q.id,
        text,
        marks: part.marksPerQuestion,
        wordCount: words,
        rbtCode: rbt && !isEmpty ? rbt.code : undefined,
        rbtLabel: rbt && !isEmpty ? rbt.label : undefined,
        score: 100,
        grade: 'Excellent',
        issues,
        isEmpty,
      });
      if (!isEmpty) tokenCache.push({ idx, set: tokens(text) });
    }
  }

  // OR-choice fairness: an alternative should demand about the same as its twin.
  let flat = 0;
  for (const part of data.parts) {
    part.questions.forEach((q, i) => {
      const r = reports[flat + i];
      if (q.isOr && i > 0) {
        const prev = part.questions[i - 1];
        const a = levelById[prev.id];
        const b = levelById[q.id];
        if (a && b && Math.abs(a - b) >= 2) {
          r.issues.push({
            severity: 'warning', category: 'Fairness',
            message: `This is the “OR” choice for Q${reports[flat + i - 1].number}, but one is L${a} and the other L${b}. Students will pick the easier one.`,
            fix: 'Keep OR alternatives at the same level of demand.',
          });
        }
      }
    });
    flat += part.questions.length;
  }

  // Duplicates
  for (let i = 0; i < tokenCache.length; i++) {
    for (let j = i + 1; j < tokenCache.length; j++) {
      const a = tokenCache[i], b = tokenCache[j];
      if (a.set.size < 4 || b.set.size < 4) continue;
      const sim = jaccard(a.set, b.set);
      if (sim >= 0.8) {
        reports[b.idx].issues.push({
          severity: 'error', category: 'Duplicate',
          message: `Almost identical to Q${reports[a.idx].number} (${Math.round(sim * 100)}% overlap).`,
          fix: 'Replace one of them.',
        });
      } else if (sim >= 0.6) {
        reports[b.idx].issues.push({
          severity: 'warning', category: 'Duplicate',
          message: `Very similar to Q${reports[a.idx].number} (${Math.round(sim * 100)}% overlap).`,
          fix: 'Check these test different things.',
        });
      }
    }
  }

  // Scores
  for (const r of reports) {
    if (r.isEmpty) { r.score = 0; r.grade = 'Poor'; continue; }
    const cut = r.issues.reduce((a, i) => a + DEDUCTION[i.severity], 0);
    r.score = Math.max(0, 100 - cut);
    r.grade = gradeFor(r.score);
  }

  // Paper-level
  const paperIssues = checkPaper(data);
  const balance = analysePaper(levels);
  for (const w of balance.warnings) {
    paperIssues.push({ severity: 'warning', category: 'Balance', message: w });
  }
  const filledReports = reports.filter((r) => !r.isEmpty);
  const blank = reports.length - filledReports.length;
  if (blank > 0 && filledReports.length > 0) {
    paperIssues.push({
      severity: 'warning', category: 'Completeness',
      message: `${blank} of ${reports.length} questions are still blank.`,
    });
  }

  let score: number | null = null;
  if (filledReports.length > 0) {
    const avg = filledReports.reduce((a, r) => a + r.score, 0) / filledReports.length;
    const cut = paperIssues.reduce((a, i) => a + (i.severity === 'error' ? 5 : i.severity === 'warning' ? 3 : 0), 0);
    score = Math.max(0, Math.round(avg - cut));
  }

  const all = [...reports.flatMap((r) => r.issues), ...paperIssues];
  return {
    score,
    grade: score === null ? null : gradeFor(score),
    questions: reports,
    paperIssues,
    totals: {
      questions: reports.length,
      filled: filledReports.length,
      errors: all.filter((i) => i.severity === 'error').length,
      warnings: all.filter((i) => i.severity === 'warning').length,
      infos: all.filter((i) => i.severity === 'info').length,
    },
    rbtCounts: balance.counts,
  };
}

/** Plain-text version of the report, for copying into an email or notes. */
export function reportToText(data: ExamData, report: PaperReport): string {
  const lines: string[] = [];
  lines.push(`Quality check — ${data.courseCode} ${data.courseName}`.trim());
  lines.push(report.score === null ? 'Nothing to score yet.' : `Overall: ${report.score}/100 (${report.grade})`);
  lines.push(`${report.totals.errors} errors, ${report.totals.warnings} warnings, ${report.totals.infos} notes`);
  if (report.paperIssues.length) {
    lines.push('', 'PAPER');
    report.paperIssues.forEach((i) => lines.push(`  [${i.severity}] ${i.message}`));
  }
  let part = '';
  for (const q of report.questions) {
    if (q.partName !== part) { part = q.partName; lines.push('', part.toUpperCase()); }
    lines.push(`Q${q.number}: ${q.isEmpty ? 'blank' : `${q.score}/100 ${q.grade}${q.rbtCode ? ` · ${q.rbtCode}` : ''}`}`);
    q.issues.forEach((i) => {
      lines.push(`  [${i.severity}] ${i.message}`);
      if (i.fix) lines.push(`      → ${i.fix}`);
    });
  }
  return lines.join('\n');
}
