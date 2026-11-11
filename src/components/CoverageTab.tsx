/*
 * Coverage tab — upload the syllabus, see how much of it the paper covers.
 *
 * Flow: upload (or paste) the syllabus → units and topics are read from it →
 * tick the units this exam is meant to cover → the report shows, per unit,
 * the share of topics covered and the share of marks, plus findings. The
 * report can be downloaded as a PDF. All matching lives in lib/syllabus.ts.
 *
 * The report block uses inline hex colours on purpose: html2canvas cannot
 * read the oklch() colours Tailwind v4 emits by default.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Upload, Trash2, Download, Loader2, FileText, AlertCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
// @ts-ignore — html2pdf ships no usable types
import html2pdf from 'html2pdf.js';
import { ExamData } from '../types';
import { cn } from '../utils';
import { MathText } from './MathText';
import { parseSyllabus, analyseCoverage, OUTSIDE, TopicStatus } from '../lib/syllabus';
import { readSyllabusFile } from '../lib/syllabusFile';

interface CoverageTabProps {
  examData: ExamData;
  onGoToEdit: () => void;
}

interface Saved {
  text: string;
  fileName: string;
  scope: Record<string, boolean>;
  overrides: Record<string, string>;
}

const STORAGE_KEY = 'cia-syllabus-v1';

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { text: p.text ?? '', fileName: p.fileName ?? '', scope: p.scope ?? {}, overrides: p.overrides ?? {} };
    }
  } catch { /* unreadable or blocked: start empty */ }
  return { text: '', fileName: '', scope: {}, overrides: {} };
}

/* hex palette for the exported report */
const C = {
  ink: '#0f172a', body: '#334155', muted: '#64748b', line: '#e2e8f0', soft: '#f8fafc',
  green: '#059669', greenBg: '#d1fae5', amber: '#d97706', amberBg: '#fef3c7',
  rose: '#e11d48', roseBg: '#ffe4e6', blue: '#2563eb', blueBg: '#dbeafe', indigo: '#4f46e5', bar: '#e2e8f0',
};

const STATUS: Record<TopicStatus, { label: string; fg: string; bg: string }> = {
  covered: { label: 'Covered', fg: C.green, bg: C.greenBg },
  partial: { label: 'Partly', fg: C.amber, bg: C.amberBg },
  missed: { label: 'Not covered', fg: C.rose, bg: C.roseBg },
};

const Pill: React.FC<{ fg: string; bg: string; children: React.ReactNode }> = ({ fg, bg, children }) => (
  <span style={{ background: bg, color: fg, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
    {children}
  </span>
);

const Bar: React.FC<{ pct: number; partial?: number; color: string }> = ({ pct, partial = 0, color }) => (
  <div style={{ display: 'flex', height: 8, width: '100%', background: C.bar, borderRadius: 4, overflow: 'hidden' }}>
    <div style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    {partial > 0 && <div style={{ width: `${Math.min(100 - pct, partial)}%`, background: '#fcd34d' }} />}
  </div>
);

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const qList = (xs: number[]) => xs.map((n) => `Q${n}`).join(', ');

export const CoverageTab: React.FC<CoverageTabProps> = ({ examData, onGoToEdit }) => {
  const [saved, setSaved] = useState<Saved>(load);
  const { text, fileName, scope, overrides } = saved;
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* storage full or blocked */ }
  }, [saved]);

  const units = useMemo(() => parseSyllabus(text), [text]);
  const report = useMemo(() => analyseCoverage(examData, units, scope, overrides), [examData, units, scope, overrides]);
  const topicCount = units.reduce((a, u) => a + u.topics.length, 0);

  const onFile = async (file?: File) => {
    if (!file) return;
    setError('');
    setReading(true);
    try {
      const t = await readSyllabusFile(file);
      setSaved({ text: t, fileName: file.name, scope: {}, overrides: {} });
    } catch (e: any) {
      setError(e?.message ?? 'Could not read that file.');
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const clear = () => { setSaved({ text: '', fileName: '', scope: {}, overrides: {} }); setError(''); };
  const setScope = (id: string, on: boolean) => setSaved((s) => ({ ...s, scope: { ...s.scope, [id]: on } }));
  const setOverride = (qid: string, value: string) =>
    setSaved((s) => {
      const next = { ...s.overrides };
      if (value) next[qid] = value; else delete next[qid];
      return { ...s, overrides: next };
    });

  const download = async () => {
    if (!reportRef.current) return;
    flushSync(() => setExporting(true)); // swap dropdowns for plain text before capture
    try {
      await html2pdf()
        .set({
          margin: [8, 8, 8, 8],
          filename: `${examData.courseCode || 'CIA'}_Syllabus_Coverage.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'], avoid: ['.avoid-break', 'tr'] },
        } as any)
        .from(reportRef.current)
        .save();
    } finally {
      setExporting(false);
    }
  };

  const unitName = (id: string | null) => {
    const u = units.find((x) => x.id === id);
    return u ? u.label : '—';
  };

  const examLine = [examData.examTitle, [examData.month, examData.year].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  const scoped = report.units.filter((r) => r.inScope);
  const hasQuestions = report.assignments.length > 0;

  return (
    <div className="space-y-6">
      {/* 1. Upload */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Syllabus</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Upload the course syllabus (PDF, Word or text), or paste it below. Unit headings like
              “UNIT I: Title (9 Hours)” are picked up automatically.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,application/pdf"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={reading}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {reading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {reading ? 'Reading…' : 'Upload syllabus'}
            </button>
            {text && (
              <button
                onClick={clear}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                <Trash2 size={15} /> Clear
              </button>
            )}
          </div>
        </div>

        {fileName && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-600">
            <FileText size={15} className="text-slate-400" /> {fileName}
          </p>
        )}
        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        <textarea
          value={text}
          onChange={(e) => setSaved((s) => ({ ...s, text: e.target.value }))}
          rows={text ? 8 : 5}
          placeholder={'UNIT I: Introduction to Neural Networks (9 Hours)\nBiological neuron, perceptron model, activation functions (sigmoid, tanh, ReLU)…\n\nUNIT II: Training Neural Networks (9 Hours)\nGradient descent, back-propagation, dropout…'}
          className="mt-4 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 focus:border-indigo-400 focus:outline-none"
        />
        {text.trim() && (
          <p className={cn('mt-2 text-sm', units.length ? 'text-emerald-700' : 'text-amber-700')}>
            {units.length
              ? `Found ${units.length} unit${units.length === 1 ? '' : 's'} and ${topicCount} topics. You can edit the text above if anything was split wrongly.`
              : 'No units or topics found. Check the text, or add headings like “UNIT I”.'}
          </p>
        )}
      </section>

      {/* 2. Portion */}
      {units.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">Portion for this exam</h2>
              <p className="mt-0.5 text-sm text-slate-500">Tick the units this exam is meant to cover. A CIA usually covers only some of them.</p>
            </div>
            <div className="flex gap-3 text-sm">
              <button className="font-medium text-indigo-600 hover:text-indigo-800"
                onClick={() => setSaved((s) => ({ ...s, scope: {} }))}>All units</button>
            </div>
          </div>
          <ul className="mt-4 grid gap-2 md:grid-cols-2">
            {units.map((u) => {
              const on = scope[u.id] !== false;
              return (
                <li key={u.id}>
                  <label className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3',
                    on ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200 bg-white'
                  )}>
                    <input type="checkbox" checked={on} onChange={(e) => setScope(u.id, e.target.checked)} className="mt-1 rounded border-slate-300" />
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold text-slate-900">{u.label}</span>
                      {u.title && <span className="text-slate-700"> — {u.title}</span>}
                      <span className="block text-xs text-slate-500">
                        {u.topics.length} topics{u.hours !== null ? ` · ${u.hours} hours` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 3. Report */}
      {units.length > 0 && !hasQuestions && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="font-medium text-slate-900">No questions typed yet</p>
          <p className="mt-1 text-sm text-slate-500">Type the questions on the Edit tab, then come back to see the coverage.</p>
          <button onClick={onGoToEdit} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            Go to Edit
          </button>
        </div>
      )}

      {units.length > 0 && hasQuestions && (
        <>
          <div className="flex justify-end">
            <button
              onClick={download}
              disabled={exporting}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Download report (PDF)
            </button>
          </div>

          <div
            ref={reportRef}
            style={{ background: '#fff', color: C.body, border: `1px solid ${C.line}`, borderRadius: 16, padding: 28, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 13 }}
          >
            {/* header */}
            <div style={{ borderBottom: `2px solid ${C.ink}`, paddingBottom: 12 }}>
              <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: C.muted, fontWeight: 600 }}>Syllabus coverage report</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, marginTop: 2 }}>
                {[examData.courseCode, examData.courseName].filter(Boolean).join(' — ') || 'Question paper'}
              </div>
              {examLine && <div style={{ color: C.muted, marginTop: 2 }}>{examLine}</div>}
              {fileName && <div style={{ color: C.muted, marginTop: 2, fontSize: 11 }}>Syllabus: {fileName}</div>}
            </div>

            {/* headline */}
            <div style={{ display: 'flex', gap: 28, margin: '18px 0', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 38, fontWeight: 700, color: C.indigo, lineHeight: 1 }}>{report.overallCoveragePct}%</div>
                <div style={{ color: C.muted, marginTop: 4 }}>
                  of topics covered ({report.topicsCovered} of {report.topicsTotal})
                  {report.overallPartialPct > 0 && <> · +{report.overallPartialPct}% partly</>}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 38, fontWeight: 700, color: C.ink, lineHeight: 1 }}>{fmt(report.totalMarks)}</div>
                <div style={{ color: C.muted, marginTop: 4 }}>marks in the paper</div>
              </div>
              <div>
                <div style={{ fontSize: 38, fontWeight: 700, color: C.ink, lineHeight: 1 }}>{scoped.length}<span style={{ fontSize: 18, color: C.muted }}> / {units.length}</span></div>
                <div style={{ color: C.muted, marginTop: 4 }}>units in this exam’s portion</div>
              </div>
            </div>

            {/* unit table */}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: C.soft, color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {['Unit', 'Hours', 'Topics covered', 'Coverage', 'Questions', 'Marks', '% of marks'].map((h, i) => (
                    <th key={h} style={{ textAlign: i === 0 || i === 3 || i === 4 ? 'left' : 'right', padding: '8px 8px', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.units.map((r) => (
                  <tr key={r.unit.id} style={{ borderTop: `1px solid ${C.line}`, opacity: r.inScope ? 1 : 0.45 }}>
                    <td style={{ padding: '9px 8px' }}>
                      <div style={{ fontWeight: 600, color: C.ink }}>{r.unit.label}</div>
                      <div style={{ fontSize: 11, color: C.muted }}>{r.unit.title}{!r.inScope && ' (not in this exam)'}</div>
                    </td>
                    <td style={{ textAlign: 'right', padding: '9px 8px' }}>{r.unit.hours ?? '–'}</td>
                    <td style={{ textAlign: 'right', padding: '9px 8px' }}>{r.inScope ? `${r.covered} / ${r.total}` : '–'}</td>
                    <td style={{ padding: '9px 8px', width: 150 }}>
                      {r.inScope ? (
                        <>
                          <div style={{ fontWeight: 600, color: C.ink, marginBottom: 3 }}>
                            {r.coveragePct}%{r.partialPct > 0 && <span style={{ fontWeight: 400, color: C.muted }}> (+{r.partialPct}% partly)</span>}
                          </div>
                          <Bar pct={r.coveragePct} partial={r.partialPct} color={r.coveragePct >= 60 ? '#10b981' : r.coveragePct >= 30 ? '#f59e0b' : '#f43f5e'} />
                        </>
                      ) : '–'}
                    </td>
                    <td style={{ padding: '9px 8px', fontSize: 12 }}>{r.questions.length ? qList(r.questions) : <span style={{ color: C.muted }}>none</span>}</td>
                    <td style={{ textAlign: 'right', padding: '9px 8px' }}>{fmt(r.marks)}</td>
                    <td style={{ textAlign: 'right', padding: '9px 8px', fontWeight: 600, color: C.ink }}>{fmt(r.marksPct)}%</td>
                  </tr>
                ))}
                {(report.unmatched.length > 0 || report.assignments.some((a) => a.outsideSyllabus)) && (
                  <tr style={{ borderTop: `1px solid ${C.line}` }}>
                    <td style={{ padding: '9px 8px', fontWeight: 600, color: C.rose }} colSpan={4}>Not matched to the syllabus</td>
                    <td style={{ padding: '9px 8px', fontSize: 12 }}>
                      {qList([...report.unmatched, ...report.assignments.filter((a) => a.outsideSyllabus)].map((a) => a.number))}
                    </td>
                    <td style={{ textAlign: 'right', padding: '9px 8px' }}>{fmt(report.unmatchedMarks)}</td>
                    <td style={{ textAlign: 'right', padding: '9px 8px', fontWeight: 600, color: C.ink }}>
                      {report.totalMarks ? fmt(Math.round((1000 * report.unmatchedMarks) / report.totalMarks) / 10) : 0}%
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>
              Marks count a question by the share a student answers: for “any 3 of 4”, each question counts three-quarters; an OR pair counts half each.
            </div>

            {/* findings */}
            <div className="avoid-break" style={{ marginTop: 20 }}>
              <div style={{ fontWeight: 700, color: C.ink, fontSize: 14, marginBottom: 8 }}>Findings</div>
              {report.findings.length === 0 ? (
                <div style={{ color: C.green, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <CheckCircle2 size={15} /> Every unit in the portion is represented and no question falls outside it.
                </div>
              ) : (
                report.findings.map((f, i) => {
                  const Icon = f.severity === 'error' ? AlertCircle : f.severity === 'warning' ? AlertTriangle : Info;
                  const color = f.severity === 'error' ? C.rose : f.severity === 'warning' ? C.amber : C.blue;
                  return (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                      <Icon size={15} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ color: C.ink }}>{f.message}</span>
                    </div>
                  );
                })
              )}
            </div>

            {/* topic checklist */}
            <div style={{ marginTop: 22 }}>
              <div style={{ fontWeight: 700, color: C.ink, fontSize: 14, marginBottom: 8 }}>Topic by topic</div>
              {scoped.map((r) => (
                <div key={r.unit.id} className="avoid-break" style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, color: C.ink, marginBottom: 4 }}>
                    {r.unit.label}{r.unit.title && ` — ${r.unit.title}`}
                    <span style={{ fontWeight: 400, color: C.muted }}> · {r.covered} covered, {r.partial} partly, {r.total - r.covered - r.partial} not covered</span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {r.topics.map((t) => {
                        const s = STATUS[t.status];
                        return (
                          <tr key={t.topic.id} style={{ borderTop: `1px solid ${C.line}` }}>
                            <td style={{ padding: '5px 6px', width: 92 }}><Pill fg={s.fg} bg={s.bg}>{s.label}</Pill></td>
                            <td style={{ padding: '5px 6px', color: C.ink }}>{t.topic.text}</td>
                            <td style={{ padding: '5px 6px', textAlign: 'right', color: C.muted, fontSize: 12, whiteSpace: 'nowrap' }}>
                              {t.questions.length ? qList(t.questions) : ''}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            {/* question mapping */}
            <div style={{ marginTop: 22 }}>
              <div style={{ fontWeight: 700, color: C.ink, fontSize: 14, marginBottom: 2 }}>Which unit each question belongs to</div>
              {!exporting && (
                <div style={{ color: C.muted, fontSize: 11, marginBottom: 8 }}>
                  Matched by wording. If a question is put in the wrong unit, choose the right one from its dropdown.
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: C.soft, color: C.muted, fontSize: 11, textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', padding: '6px', width: 40 }}>Q</th>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Question</th>
                    <th style={{ textAlign: 'right', padding: '6px', width: 50 }}>Marks</th>
                    <th style={{ textAlign: 'left', padding: '6px', width: 190 }}>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {report.assignments.map((a) => {
                    const label = a.outsideSyllabus
                      ? 'Not in syllabus'
                      : a.unitId ? unitName(a.unitId) : 'No match';
                    const bad = a.outsideSyllabus || !a.unitId;
                    return (
                      <tr key={a.questionId} style={{ borderTop: `1px solid ${C.line}`, verticalAlign: 'top' }}>
                        <td style={{ padding: '6px', fontWeight: 600, color: C.ink }}>{a.number}</td>
                        <td style={{ padding: '6px', color: C.ink }}>
                          <div style={exporting ? undefined : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            <MathText text={a.text} />
                          </div>
                        </td>
                        <td style={{ padding: '6px', textAlign: 'right' }}>{fmt(a.marks)}</td>
                        <td style={{ padding: '6px' }}>
                          {exporting ? (
                            <span style={{ color: bad ? C.rose : C.ink, fontWeight: 600 }}>
                              {label}
                              {a.alsoUnitIds.length > 0 && <span style={{ fontWeight: 400, color: C.muted }}> (also {a.alsoUnitIds.map(unitName).join(', ')})</span>}
                            </span>
                          ) : (
                            <>
                              <select
                                value={overrides[a.questionId] ?? ''}
                                onChange={(e) => setOverride(a.questionId, e.target.value)}
                                style={{ width: '100%', border: `1px solid ${C.line}`, borderRadius: 6, padding: '3px 6px', fontSize: 12, color: bad ? C.rose : C.ink, background: '#fff' }}
                              >
                                <option value="">Auto: {a.autoUnitId ? unitName(a.autoUnitId) : 'no match'}</option>
                                {units.map((u) => <option key={u.id} value={u.id}>{u.label}{u.title ? ` – ${u.title}` : ''}</option>)}
                                <option value={OUTSIDE}>Not in the syllabus</option>
                              </select>
                              {a.alsoUnitIds.length > 0 && !a.overridden && (
                                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>also fits {a.alsoUnitIds.map(unitName).join(', ')}</div>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 20, paddingTop: 10, borderTop: `1px solid ${C.line}`, color: C.muted, fontSize: 11 }}>
              Automatic check by wording. It compares the words in each question with the words in each syllabus topic, so a question that
              describes a topic in very different words may be missed. Treat it as a first pass and confirm with the subject teacher.
            </div>
          </div>
        </>
      )}
    </div>
  );
};
