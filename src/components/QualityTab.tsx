/*
 * Quality tab — a first-pass review of the typed questions.
 *
 * Shows an overall score, paper-level problems (marks that do not add up,
 * missing header fields, RBT balance), then each question with its own score
 * and the specific things wrong with it. All checks live in lib/quality.ts.
 */
import React, { useMemo, useState } from 'react';
import {
  ShieldCheck, AlertTriangle, AlertCircle, Info, CheckCircle2,
  ChevronDown, ChevronRight, ClipboardCopy, Edit3,
} from 'lucide-react';
import { ExamData } from '../types';
import { cn } from '../utils';
import { MathText } from './MathText';
import { analyseQuality, reportToText, Issue, Grade, Severity } from '../lib/quality';

interface QualityTabProps {
  examData: ExamData;
  onGoToEdit: () => void;
}

const GRADE_STYLE: Record<Grade, { text: string; bg: string; ring: string; bar: string }> = {
  Excellent: { text: 'text-emerald-700', bg: 'bg-emerald-50', ring: 'ring-emerald-200', bar: 'bg-emerald-500' },
  Good: { text: 'text-sky-700', bg: 'bg-sky-50', ring: 'ring-sky-200', bar: 'bg-sky-500' },
  'Needs work': { text: 'text-amber-700', bg: 'bg-amber-50', ring: 'ring-amber-200', bar: 'bg-amber-500' },
  Poor: { text: 'text-rose-700', bg: 'bg-rose-50', ring: 'ring-rose-200', bar: 'bg-rose-500' },
};

const SEVERITY_ICON: Record<Severity, React.ReactNode> = {
  error: <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />,
  warning: <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />,
  info: <Info size={16} className="text-sky-600 shrink-0 mt-0.5" />,
};

const IssueRow: React.FC<{ issue: Issue }> = ({ issue }) => (
  <li className="flex gap-2.5 text-sm">
    {SEVERITY_ICON[issue.severity]}
    <div className="min-w-0">
      <p className="text-slate-800">
        <span className="mr-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {issue.category}
        </span>
        {issue.message}
      </p>
      {issue.fix && <p className="mt-0.5 text-slate-500">→ {issue.fix}</p>}
    </div>
  </li>
);

export const QualityTab: React.FC<QualityTabProps> = ({ examData, onGoToEdit }) => {
  const report = useMemo(() => analyseQuality(examData), [examData]);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportToText(examData, report));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — nothing useful to do */
    }
  };

  const toggle = (id: string, defaultOpen: boolean) =>
    setOpen((o) => ({ ...o, [id]: !(o[id] ?? defaultOpen) }));

  const grade = report.grade ? GRADE_STYLE[report.grade] : null;

  if (report.totals.filled === 0) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <ShieldCheck size={36} className="mx-auto text-slate-300" />
        <h2 className="mt-3 text-lg font-semibold text-slate-900">Nothing to check yet</h2>
        <p className="mt-1 text-sm text-slate-500">Type some questions on the Edit tab, then come back for a quality review.</p>
        <button
          onClick={onGoToEdit}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Edit3 size={16} /> Go to Edit
        </button>
      </div>
    );
  }

  // Group questions by part, in order.
  const parts: { id: string; name: string; items: typeof report.questions }[] = [];
  for (const q of report.questions) {
    let p = parts.find((x) => x.id === q.partId);
    if (!p) { p = { id: q.partId, name: q.partName, items: [] }; parts.push(p); }
    p.items.push(q);
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <section className="grid gap-4 md:grid-cols-[280px_1fr]">
        <div className={cn('rounded-2xl p-6 ring-1', grade?.bg, grade?.ring)}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overall quality</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={cn('text-5xl font-bold tabular-nums', grade?.text)}>{report.score}</span>
            <span className="text-slate-400">/ 100</span>
          </div>
          <p className={cn('mt-1 text-lg font-semibold', grade?.text)}>{report.grade}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
            <div className={cn('h-full rounded-full', grade?.bar)} style={{ width: `${report.score}%` }} />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {report.totals.filled} of {report.totals.questions} questions checked
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-6">
              <Stat n={report.totals.errors} label="Errors" tone="text-rose-600" />
              <Stat n={report.totals.warnings} label="Warnings" tone="text-amber-600" />
              <Stat n={report.totals.infos} label="Notes" tone="text-sky-600" />
            </div>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={onlyProblems}
                  onChange={(e) => setOnlyProblems(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Only show problems
              </label>
              <button
                onClick={copy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <ClipboardCopy size={15} /> {copied ? 'Copied' : 'Copy report'}
              </button>
            </div>
          </div>

          {Object.keys(report.rbtCounts).length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">RBT spread</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((l) => (
                  <span
                    key={l}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium',
                      report.rbtCounts[l] ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-400'
                    )}
                  >
                    {l} · {report.rbtCounts[l] ?? 0}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Paper-level */}
      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold text-slate-900">Whole paper</h2>
        </div>
        <div className="px-6 py-4">
          {report.paperIssues.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 size={16} /> Marks, structure and header all check out.
            </p>
          ) : (
            <ul className="space-y-3">
              {report.paperIssues.map((i, k) => <IssueRow key={k} issue={i} />)}
            </ul>
          )}
        </div>
      </section>

      {/* Per question */}
      {parts.map((part) => {
        const items = onlyProblems ? part.items.filter((q) => q.issues.length > 0) : part.items;
        if (items.length === 0) return null;
        return (
          <section key={part.id} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{part.name}</h2>
            {items.map((q) => {
              const g = GRADE_STYLE[q.grade];
              const hasIssues = q.issues.length > 0;
              const isOpen = open[q.questionId] ?? hasIssues;
              return (
                <div key={q.questionId} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <button
                    onClick={() => toggle(q.questionId, hasIssues)}
                    className="flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-slate-50"
                  >
                    {isOpen ? <ChevronDown size={18} className="mt-0.5 shrink-0 text-slate-400" /> : <ChevronRight size={18} className="mt-0.5 shrink-0 text-slate-400" />}
                    <span className="mt-0.5 w-9 shrink-0 text-sm font-semibold text-slate-500">Q{q.number}</span>
                    <span className="min-w-0 flex-1 text-sm text-slate-800">
                      {q.isEmpty
                        ? <em className="text-slate-400">Blank</em>
                        : <span className="line-clamp-2"><MathText text={q.text} /></span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {q.rbtCode && (
                        <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{q.rbtCode}</span>
                      )}
                      <span className={cn('rounded px-2 py-0.5 text-xs font-semibold tabular-nums', g.bg, g.text)}>
                        {q.isEmpty ? '—' : q.score}
                      </span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-4">
                      {hasIssues ? (
                        <ul className="space-y-3">
                          {q.issues.map((i, k) => <IssueRow key={k} issue={i} />)}
                        </ul>
                      ) : (
                        <p className="flex items-center gap-2 text-sm text-emerald-700">
                          <CheckCircle2 size={16} /> No problems found.
                        </p>
                      )}
                      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                        <span>{q.wordCount} words · {q.marks} marks{q.rbtLabel ? ` · reads as ${q.rbtLabel}` : ''}</span>
                        <button onClick={onGoToEdit} className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-800">
                          <Edit3 size={12} /> Edit
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}

      <p className="pb-4 text-center text-xs text-slate-400">
        Automatic first-pass review. It checks wording, structure and marks — not whether the mathematics is correct or matches your syllabus.
      </p>
    </div>
  );
};

const Stat: React.FC<{ n: number; label: string; tone: string }> = ({ n, label, tone }) => (
  <div>
    <div className={cn('text-3xl font-bold tabular-nums', tone)}>{n}</div>
    <div className="text-xs text-slate-500">{label}</div>
  </div>
);
