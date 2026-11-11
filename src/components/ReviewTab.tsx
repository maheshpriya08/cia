/*
 * Review tab — nine-criteria review of the typed questions against the
 * uploaded syllabus, with two PDF outputs:
 *   Output 1  <FacultyID>-<CourseCode>-Detailed-Analysis-DDMMYY.pdf
 *   Output 2  <FacultyID>-<CourseCode>-Summary-DDMMYY.pdf
 *
 * The syllabus is shared with the Coverage tab (same localStorage entry), so
 * a syllabus uploaded there is used here, and unit scope / unit corrections
 * made there are respected. All scoring lives in lib/review.ts.
 *
 * The report blocks use inline hex colours on purpose: html2canvas cannot
 * read the oklch() colours Tailwind v4 emits by default.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Upload, Download, Loader2, FileText, Trash2, ClipboardCheck, Edit3, Info } from 'lucide-react';
// @ts-ignore — html2pdf ships no usable types
import html2pdf from 'html2pdf.js';
import { ExamData } from '../types';
import { MathText } from './MathText';
import { readSyllabusFile } from '../lib/syllabusFile';
import { reviewPaper, CRITERIA, LIKERT_LABEL, CriterionKey, PaperReview } from '../lib/review';

interface ReviewTabProps {
  examData: ExamData;
  onGoToEdit: () => void;
  onGoToCoverage: () => void;
}

const SYL_KEY = 'cia-syllabus-v1';
const META_KEY = 'cia-review-v1';

interface SavedSyllabus { text: string; fileName: string; scope: Record<string, boolean>; overrides: Record<string, string> }

function loadSyllabus(): SavedSyllabus {
  try {
    const p = JSON.parse(localStorage.getItem(SYL_KEY) ?? 'null');
    if (p) return { text: p.text ?? '', fileName: p.fileName ?? '', scope: p.scope ?? {}, overrides: p.overrides ?? {} };
  } catch { /* unreadable: start empty */ }
  return { text: '', fileName: '', scope: {}, overrides: {} };
}
function loadFaculty(): string {
  try { return JSON.parse(localStorage.getItem(META_KEY) ?? '{}').facultyId ?? ''; } catch { return ''; }
}

const C = {
  ink: '#0f172a', body: '#334155', muted: '#64748b', line: '#e2e8f0', soft: '#f8fafc', indigo: '#4f46e5', green: '#059669',
};
const LIKERT_COLOR: Record<number, { fg: string; bg: string }> = {
  5: { fg: '#047857', bg: '#d1fae5' },
  4: { fg: '#4d7c0f', bg: '#ecfccb' },
  3: { fg: '#b45309', bg: '#fef3c7' },
  2: { fg: '#c2410c', bg: '#ffedd5' },
  1: { fg: '#be123c', bg: '#ffe4e6' },
};
const likertStyle = (v: number | null) => (v == null ? { fg: C.muted, bg: C.soft } : LIKERT_COLOR[Math.min(5, Math.max(1, Math.round(v)))]);

const th: React.CSSProperties = { border: `1px solid ${C.line}`, padding: '5px 7px', background: C.soft, textAlign: 'left', fontWeight: 600, color: C.ink, fontSize: 11 };
const td: React.CSSProperties = { border: `1px solid ${C.line}`, padding: '5px 7px', verticalAlign: 'top', fontSize: 11 };

const ddmmyy = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}${p(d.getMonth() + 1)}${String(d.getFullYear()).slice(-2)}`;
};
const safe = (s: string) => s.trim().replace(/[^\w.-]+/g, '_');

/* ------------------------------------------------------------------ */
/* spider (radar) plot                                                 */
/* ------------------------------------------------------------------ */

const Radar: React.FC<{ rev: PaperReview; size?: number }> = ({ rev, size = 340 }) => {
  const cx = size / 2, cy = size / 2, R = size / 2 - 52;
  const n = CRITERIA.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const r = (v / 5) * R;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  const poly = (vals: (number | null)[]) => vals.map((v, i) => pt(i, v ?? 0).join(',')).join(' ');
  const un = CRITERIA.map((c) => rev.avgUnweighted[c.key]);
  const wt = CRITERIA.map((c) => rev.avgWeighted[c.key]);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', margin: '0 auto' }}>
      {[1, 2, 3, 4, 5].map((r) => (
        <polygon key={r} points={CRITERIA.map((_, i) => pt(i, r).join(',')).join(' ')} fill="none" stroke={r === 4 ? '#94a3b8' : '#e2e8f0'} strokeWidth={r === 4 ? 1.2 : 1} strokeDasharray={r === 4 ? '4 3' : undefined} />
      ))}
      {CRITERIA.map((c, i) => {
        const [x, y] = pt(i, 5);
        const [lx, ly] = pt(i, 5.75);
        return (
          <g key={c.key}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="#e2e8f0" />
            <text x={lx} y={ly} fontSize={10} fill="#334155" textAnchor={lx < cx - 4 ? 'end' : lx > cx + 4 ? 'start' : 'middle'} dominantBaseline="middle">
              {c.no}. {c.short}
            </text>
          </g>
        );
      })}
      {[1, 2, 3, 4, 5].map((r) => <text key={r} x={cx + 3} y={cy - (r / 5) * R} fontSize={8} fill="#94a3b8">{r}</text>)}
      <polygon points={poly(wt)} fill="rgba(5,150,105,0.12)" stroke="#059669" strokeWidth={1.8} strokeDasharray="5 3" />
      <polygon points={poly(un)} fill="rgba(79,70,229,0.18)" stroke="#4f46e5" strokeWidth={2} />
      {un.map((v, i) => { const [x, y] = pt(i, v ?? 0); return <circle key={i} cx={x} cy={y} r={3} fill="#4f46e5" />; })}
    </svg>
  );
};

const RadarLegend: React.FC = () => (
  <div style={{ display: 'flex', gap: 16, justifyContent: 'center', fontSize: 10, color: C.muted, marginTop: 4, flexWrap: 'wrap' }}>
    <span><b style={{ color: '#4f46e5' }}>━</b> Average (each question equal)</span>
    <span><b style={{ color: '#059669' }}>┅</b> Average weighted by marks</span>
    <span><b style={{ color: '#94a3b8' }}>┅</b> Benchmark (4 = Good)</span>
  </div>
);

/* ------------------------------------------------------------------ */
/* report pieces                                                       */
/* ------------------------------------------------------------------ */

const Chip: React.FC<{ v: number | null; big?: boolean }> = ({ v, big }) => {
  const s = likertStyle(v);
  return (
    <span style={{ display: 'inline-block', minWidth: big ? 34 : 26, textAlign: 'center', borderRadius: 6, padding: '2px 6px', fontWeight: 700, fontSize: big ? 13 : 11, background: s.bg, color: s.fg }}>
      {v == null ? 'n/a' : v}
    </span>
  );
};

interface Meta { facultyId: string; fileName: string; reportDate: string }

const PaperDetails: React.FC<{ data: ExamData; rev: PaperReview; meta: Meta }> = ({ data, rev, meta }) => {
  const rows: [string, string][] = [
    ['Institution', data.collegeName || '—'],
    ['Programme / semester', [data.program, data.semester].filter(Boolean).join(' · ') || '—'],
    ['Course', [data.courseCode, data.courseName].filter(Boolean).join(' — ') || '—'],
    ['Examination', [data.examTitle, [data.month, data.year].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || '—'],
    ['Duration · maximum marks', `${data.duration || '—'} · ${data.maxMarks || '—'}`],
    ['Structure', data.parts.map((p) => `${p.name}: ${p.questionCount} × ${p.marksPerQuestion}${p.questionsToAnswer && p.questionsToAnswer < p.questionCount ? ` (answer ${p.questionsToAnswer})` : ''}`).join('; ')],
    ['Questions reviewed', `${rev.questions.length}${rev.blankCount ? ` (${rev.blankCount} blank skipped)` : ''}`],
    ['Syllabus', meta.fileName || (rev.hasSyllabus ? 'pasted text' : 'not supplied')],
    ['Faculty ID', meta.facultyId || '—'],
    ['Report date', meta.reportDate],
  ];
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', margin: '10px 0' }}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td style={{ ...td, width: 170, background: C.soft, fontWeight: 600, color: C.ink }}>{k}</td>
            <td style={td}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const Banner: React.FC<{ title: string; kind: string }> = ({ title, kind }) => (
  <div style={{ borderBottom: `2px solid ${C.ink}`, paddingBottom: 10 }}>
    <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: C.muted, fontWeight: 600 }}>{kind}</div>
    <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, marginTop: 2 }}>{title}</div>
  </div>
);

const H: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 style={{ fontSize: 13, fontWeight: 700, color: C.ink, margin: '18px 0 6px', textTransform: 'uppercase', letterSpacing: 0.5 }}>{children}</h3>
);

const SummaryMatrix: React.FC<{ rev: PaperReview }> = ({ rev }) => (
  <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
    <thead>
      <tr>
        <th style={{ ...th, width: 44 }}>Q</th>
        <th style={{ ...th, width: 38 }}>Marks</th>
        {CRITERIA.map((c) => <th key={c.key} style={{ ...th, textAlign: 'center', fontSize: 9.5 }}>{c.no}. {c.short}</th>)}
        <th style={{ ...th, textAlign: 'center', width: 44 }}>Avg</th>
      </tr>
    </thead>
    <tbody>
      {rev.questions.map((q) => (
        <tr key={q.questionId}>
          <td style={{ ...td, fontWeight: 600 }}>Q{q.number}</td>
          <td style={td}>{q.marks}</td>
          {CRITERIA.map((c) => <td key={c.key} style={{ ...td, textAlign: 'center' }}><Chip v={q.results[c.key].score} /></td>)}
          <td style={{ ...td, textAlign: 'center' }}><Chip v={q.average} /></td>
        </tr>
      ))}
      {([['Average (each question equal)', rev.avgUnweighted, rev.overall], ['Average (weighted by marks)', rev.avgWeighted, rev.overallWeighted]] as const).map(([label, vals, all]) => (
        <tr key={label}>
          <td style={{ ...td, fontWeight: 700, background: C.soft }} colSpan={2}>{label}</td>
          {CRITERIA.map((c) => <td key={c.key} style={{ ...td, textAlign: 'center', background: C.soft }}><Chip v={(vals as Record<CriterionKey, number | null>)[c.key]} /></td>)}
          <td style={{ ...td, textAlign: 'center', background: C.soft }}><Chip v={all} big /></td>
        </tr>
      ))}
    </tbody>
  </table>
);

const Narrative: React.FC<{ rev: PaperReview; compact?: boolean }> = ({ rev, compact }) => (
  <>
    <H>Summary of question paper quality</H>
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, lineHeight: 1.5 }}>
      {rev.summary.map((s, i) => <li key={i} style={{ marginBottom: 2 }}>{s}</li>)}
    </ul>
    <H>Recommendations for the paper</H>
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, lineHeight: 1.5 }}>
      {rev.topRecommendations.map((s, i) => <li key={i} style={{ marginBottom: 2 }}>{s}</li>)}
    </ul>
    {!compact && rev.hasSyllabus && (
      <>
        <H>Unit-wise distribution of marks</H>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Unit</th><th style={th}>In CIA scope</th><th style={th}>Marks</th><th style={th}>Share</th><th style={th}>Expected</th><th style={th}>Topics covered</th></tr></thead>
          <tbody>
            {rev.units.map((u) => (
              <tr key={u.label}>
                <td style={td}>{u.label}{u.title ? ` — ${u.title}` : ''}</td>
                <td style={td}>{u.inScope ? 'Yes' : 'No'}</td>
                <td style={td}>{u.marks}</td>
                <td style={td}>{u.inScope ? `${u.sharePct}%` : '—'}</td>
                <td style={td}>{u.expectedPct != null ? `${u.expectedPct}%` : '—'}</td>
                <td style={td}>{u.topicsCovered}{u.topicsPartial ? ` (+${u.topicsPartial} partly)` : ''} of {u.topicsTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rev.outcomes.length > 0 && (
          <>
            <H>Course Outcome coverage</H>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ ...th, width: 50 }}>CO</th><th style={th}>Outcome (from syllabus)</th><th style={{ ...th, width: 90 }}>Questions</th></tr></thead>
              <tbody>
                {rev.outcomes.map((o) => (
                  <tr key={o.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{o.id}</td>
                    <td style={td}>{o.text}</td>
                    <td style={{ ...td, color: o.questions.length ? C.body : '#be123c' }}>{o.questions.length ? o.questions.map((n) => `Q${n}`).join(', ') : 'none'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </>
    )}
  </>
);

const BENCH_WRAP: React.CSSProperties = { background: '#fff', color: C.body, border: `1px solid ${C.line}`, borderRadius: 16, padding: 28, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12 };

const SummaryReport = React.forwardRef<HTMLDivElement, { data: ExamData; rev: PaperReview; meta: Meta }>(({ data, rev, meta }, ref) => (
  <div ref={ref} style={BENCH_WRAP}>
    <Banner kind="Question paper quality — summary" title={[data.courseCode, data.courseName].filter(Boolean).join(' — ') || 'Question paper'} />
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', margin: '12px 0', flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: 40, fontWeight: 700, color: C.indigo, lineHeight: 1 }}>{rev.overall ?? '—'}<span style={{ fontSize: 16, color: C.muted }}> / 5</span></div>
        <div style={{ color: C.muted, marginTop: 4 }}>Overall average · {rev.grade}{rev.overallWeighted != null && <> · weighted by marks {rev.overallWeighted}</>}</div>
      </div>
      <div style={{ flex: 1, minWidth: 260 }}><Radar rev={rev} size={300} /><RadarLegend /></div>
    </div>
    <PaperDetails data={data} rev={rev} meta={meta} />
    <div className="avoid-break">
      <H>Question number vs criterion (Likert 1–5)</H>
      <SummaryMatrix rev={rev} />
      <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>5 Very good · 4 Good · 3 Adequate · 2 Weak · 1 Poor · n/a not rated (needs syllabus or duration).</div>
    </div>
    <Narrative rev={rev} compact />
  </div>
));

const DetailedReport = React.forwardRef<HTMLDivElement, { data: ExamData; rev: PaperReview; meta: Meta }>(({ data, rev, meta }, ref) => (
  <div ref={ref} style={BENCH_WRAP}>
    <Banner kind="Question paper quality — detailed analysis" title={[data.courseCode, data.courseName].filter(Boolean).join(' — ') || 'Question paper'} />
    <H>Question paper details</H>
    <PaperDetails data={data} rev={rev} meta={meta} />

    <div className="avoid-break">
      <H>Method, Likert scale and benchmarks</H>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={{ ...th, width: 150 }}>Criterion</th><th style={th}>Benchmark used (5 = meets it fully, 1 = far from it)</th></tr></thead>
        <tbody>{CRITERIA.map((c) => <tr key={c.key}><td style={{ ...td, fontWeight: 600 }}>{c.no}. {c.name}</td><td style={td}>{c.benchmark}</td></tr>)}</tbody>
      </table>
      <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
        {rev.assumptions.map((a, i) => <li key={i}>{a}</li>)}
      </ul>
    </div>

    <H>Question-wise analysis</H>
    {rev.questions.map((q) => (
      <div key={q.questionId} className="avoid-break" style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div style={{ fontWeight: 700, color: C.ink }}>Q{q.number} <span style={{ fontWeight: 400, color: C.muted }}>· {q.partName} · {q.marks} marks</span></div>
          <div style={{ fontSize: 11, color: C.muted }}>Average <Chip v={q.average} big /></div>
        </div>
        <div style={{ margin: '6px 0 8px', fontSize: 12, color: C.ink, lineHeight: 1.55 }}><MathText text={q.text} /></div>
        <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>
          Unit: {q.unitLabel} · CO: {q.co} · Bloom: {q.rbtCode} {q.rbtLabel} · Type: {q.qtype} · Difficulty: {q.difficultyLabel} ({q.difficulty.toFixed(2)}) ·
          Est. time {q.estMin} min{q.allotMin != null ? ` of ${q.allotMin}` : ''} · Think {q.thinkMin} / ink {q.inkMin} min
          {q.topics.length > 0 && <> · Topics: {q.topics.join('; ')}</>}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={{ ...th, width: 120 }}>Criterion</th><th style={{ ...th, width: 62 }}>Likert</th><th style={th}>Rationale</th></tr></thead>
          <tbody>
            {CRITERIA.map((c) => {
              const r = q.results[c.key];
              return (
                <tr key={c.key}>
                  <td style={{ ...td, fontWeight: 600 }}>{c.no}. {c.short}</td>
                  <td style={td}><Chip v={r.score} /> <span style={{ fontSize: 9.5, color: C.muted }}>{r.score ? LIKERT_LABEL[r.score] : ''}</span></td>
                  <td style={td}>{r.rationale}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 8, fontSize: 11 }}>
          <b style={{ color: C.ink }}>Recommendations</b>
          <ul style={{ margin: '3px 0 0', paddingLeft: 18, lineHeight: 1.5 }}>{q.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      </div>
    ))}

    <div className="avoid-break">
      <H>Summary table</H>
      <SummaryMatrix rev={rev} />
    </div>
    <div className="avoid-break">
      <H>Spider web plot</H>
      <Radar rev={rev} />
      <RadarLegend />
    </div>
    <Narrative rev={rev} />
  </div>
));

/* ------------------------------------------------------------------ */
/* the tab                                                             */
/* ------------------------------------------------------------------ */

export const ReviewTab: React.FC<ReviewTabProps> = ({ examData, onGoToEdit, onGoToCoverage }) => {
  const [syl, setSyl] = useState<SavedSyllabus>(loadSyllabus);
  const [facultyId, setFacultyId] = useState<string>(loadFaculty);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'detailed' | 'summary'>('');
  const fileRef = useRef<HTMLInputElement>(null);
  const detailedRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { localStorage.setItem(META_KEY, JSON.stringify({ facultyId })); } catch { /* blocked */ } }, [facultyId]);
  useEffect(() => { try { localStorage.setItem(SYL_KEY, JSON.stringify(syl)); } catch { /* blocked */ } }, [syl]);

  const rev = useMemo(() => reviewPaper(examData, syl.text, syl.scope, syl.overrides), [examData, syl]);

  const onFile = async (file?: File) => {
    if (!file) return;
    setError(''); setReading(true);
    try { setSyl({ text: await readSyllabusFile(file), fileName: file.name, scope: {}, overrides: {} }); }
    catch (e: any) { setError(e?.message ?? 'Could not read that file.'); }
    finally { setReading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const meta: Meta = { facultyId: facultyId.trim(), fileName: syl.fileName, reportDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) };
  const course = safe(examData.courseCode || 'Course');

  const exportPdf = async (which: 'detailed' | 'summary') => {
    const el = (which === 'detailed' ? detailedRef : summaryRef).current;
    if (!el || !facultyId.trim()) return;
    flushSync(() => setBusy(which));
    try {
      await html2pdf().set({
        margin: [8, 8, 8, 8],
        filename: `${safe(facultyId)}-${course}-${which === 'detailed' ? 'Detailed-Analysis' : 'Summary'}-${ddmmyy()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['.avoid-break', 'tr'] },
      } as any).from(el).save();
    } finally { setBusy(''); }
  };

  if (rev.questions.length === 0) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <ClipboardCheck size={36} className="mx-auto text-slate-300" />
        <h2 className="mt-3 text-lg font-semibold text-slate-900">Nothing to review yet</h2>
        <p className="mt-1 text-sm text-slate-500">Type some questions on the Edit tab, then come back to review them against the syllabus.</p>
        <button onClick={onGoToEdit} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          <Edit3 size={16} /> Go to Edit
        </button>
      </div>
    );
  }

  const canExport = facultyId.trim().length > 0;
  const notRated = CRITERIA.filter((c) => rev.avgUnweighted[c.key] == null).map((c) => c.name);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold text-slate-900">Review against the syllabus</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Rates every typed question on nine criteria (1–5), with rationale and recommendations. Works offline; the same paper gives the same result.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Faculty ID <span className="text-rose-500">*</span></span>
            <input
              value={facultyId}
              onChange={(e) => setFacultyId(e.target.value)}
              placeholder="e.g. F1234"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <span className="mt-1 block text-xs text-slate-400">Used in the PDF file names.</span>
          </label>
          <div className="text-sm">
            <span className="font-medium text-slate-700">Syllabus</span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              <button onClick={() => fileRef.current?.click()} disabled={reading} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                {reading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {syl.text ? 'Replace' : 'Upload syllabus'}
              </button>
              {syl.fileName && <span className="inline-flex items-center gap-1.5 text-slate-600"><FileText size={14} className="text-slate-400" />{syl.fileName}</span>}
              {syl.text && (
                <button onClick={() => setSyl({ text: '', fileName: '', scope: {}, overrides: {} })} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-600">
                  <Trash2 size={13} /> Remove
                </button>
              )}
            </div>
            <span className="mt-1 block text-xs text-slate-400">
              Shared with the Coverage tab. Units in scope and unit corrections are set there
              <button onClick={onGoToCoverage} className="ml-1 underline hover:text-indigo-600">open Coverage</button>.
            </span>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        {notRated.length > 0 && (
          <p className="mt-4 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <Info size={16} className="mt-0.5 shrink-0" />
            <span>Not rated: {notRated.join(', ')}. {!rev.hasSyllabus ? 'Upload the syllabus to enable the syllabus-based criteria. ' : ''}{rev.durationMin == null ? 'Enter a readable duration (e.g. “1.30 hours”) on the Edit tab for the time criterion.' : ''}</span>
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={() => exportPdf('detailed')} disabled={!canExport || !!busy} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {busy === 'detailed' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Output 1 — Detailed analysis (PDF)
          </button>
          <button onClick={() => exportPdf('summary')} disabled={!canExport || !!busy} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50">
            {busy === 'summary' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Output 2 — Summary (PDF)
          </button>
          {!canExport && <span className="text-xs text-slate-400">Enter the Faculty ID to enable downloads.</span>}
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Output 2 · Summary preview</p>
        <SummaryReport ref={summaryRef} data={examData} rev={rev} meta={meta} />
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Output 1 · Detailed analysis preview</p>
        <DetailedReport ref={detailedRef} data={examData} rev={rev} meta={meta} />
      </section>
    </div>
  );
};
