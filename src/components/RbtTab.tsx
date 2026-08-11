/*
 * RBT tab — CO and RBT Level mapping.
 *
 * Two halves:
 *   1. An editor. CO is chosen by the author from the course's own CO list
 *      (which they can add to). RBT arrives pre-filled from the classifier and
 *      is a dropdown, never a fixed label.
 *   2. A printable sheet laid out like RBT_Template.docx — logo, header block,
 *      then a PART table per part with Q.No / Questions / CO / RBT Level.
 *
 * The sheet uses the same column geometry as the exam preview, so a long list
 * of questions flows onto as many sheets as it needs instead of being clipped.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Download, Printer, Table2, AlertTriangle } from 'lucide-react';
// @ts-ignore — html2pdf ships no types
import html2pdf from 'html2pdf.js';
import { ExamData, RbtMeta } from '../types';
import { cn } from '../utils';
import { MathText } from './MathText';
import { classifyRbt, analysePaper, RBT_LABELS, RbtLevel, RbtSuggestion } from '../lib/bloom';
import { MM, PAGE, USABLE_H, COL_W, mm, countColumns } from '../lib/page';

const RBT_OPTIONS: RbtLevel[] = [1, 2, 3, 4, 5, 6];

/** Column widths inside the RBT table, as a share of the text column. */
const COLS = { no: '11%', q: '63%', co: '12%', rbt: '14%' };

interface RowInfo {
  partId: string;
  partName: string;
  questionId: string;
  /** Continuous across parts: PART A 1-3, PART B 4, PART C 5. */
  number: number;
  text: string;
  suggestion: RbtSuggestion;
}

interface RbtTabProps {
  examData: ExamData;
  setExamData: React.Dispatch<React.SetStateAction<ExamData>>;
  formatDate: (dateStr: string, month?: string, year?: string) => string;
}

/**
 * The text the classifier reads: the question stem plus any sub-questions,
 * since "a) Define… b) Compare…" carries its demand in the parts, not the stem.
 */
function fullText(question: { text: string; subQuestions?: { text: string }[] }): string {
  const subs = (question.subQuestions ?? []).map((s) => s.text).filter(Boolean);
  return [question.text, ...subs].filter(Boolean).join(' ');
}

export const RbtTab: React.FC<RbtTabProps> = ({ examData, setExamData, formatDate }) => {
  const rbtMap = examData.rbtMap ?? {};
  const [columnCount, setColumnCount] = useState(1);
  const [previewScale, setPreviewScale] = useState(1);
  const measureRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  /* ---------------- rows and classification ---------------- */

  const rows: RowInfo[] = useMemo(() => {
    const list: RowInfo[] = [];
    let n = 1;
    for (const part of examData.parts) {
      for (const question of part.questions) {
        const text = fullText(question);
        list.push({
          partId: part.id,
          partName: part.name,
          questionId: question.id,
          number: n++,
          text,
          suggestion: classifyRbt(text),
        });
      }
    }
    return list;
  }, [examData.parts]);

  /* Pre-fill RBT for rows the author has not set by hand. */
  useEffect(() => {
    const missing = rows.filter((row) => {
      const meta = rbtMap[row.questionId];
      return !meta?.rbtConfirmed && !meta?.rbt;
    });
    if (missing.length === 0) return;

    setExamData((prev) => {
      const next = { ...(prev.rbtMap ?? {}) };
      for (const row of missing) {
        next[row.questionId] = { ...next[row.questionId], rbt: row.suggestion.code };
      }
      return { ...prev, rbtMap: next };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const setMeta = useCallback(
    (questionId: string, patch: Partial<RbtMeta>) => {
      setExamData((prev) => ({
        ...prev,
        rbtMap: {
          ...(prev.rbtMap ?? {}),
          [questionId]: { ...(prev.rbtMap ?? {})[questionId], ...patch },
        },
      }));
    },
    [setExamData]
  );

  /*
   * CO is typed, not chosen from a list — departments name outcomes their own
   * way ("CO1", "CO2.3", "PO4/CO1") and a fixed dropdown would be a cage.
   *
   * Whatever has already been typed on this paper is offered as a datalist
   * suggestion, so the second question onward can autocomplete instead of
   * retyping — a hint, never a restriction.
   */
  const coSuggestions = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) {
      const value = rbtMap[row.questionId]?.co?.trim();
      if (value) seen.add(value);
    }
    return Array.from(seen).sort();
  }, [rows, rbtMap]);

  /* ---------------- paper-level checks ---------------- */

  const levels = rows
    .map((row) => Number((rbtMap[row.questionId]?.rbt ?? row.suggestion.code).replace('L', '')) as RbtLevel)
    .filter((l) => l >= 1 && l <= 6);
  const balance = useMemo(() => analysePaper(levels), [levels.join(',')]);
  const missingCo = rows.filter((row) => !rbtMap[row.questionId]?.co).length;
  const needsReview = rows.filter(
    (row) => row.suggestion.needsReview && !rbtMap[row.questionId]?.rbtConfirmed
  ).length;

  /* ---------------- printable blocks ---------------- */

  const headerBlock = (
    <div className="rbt-header-block mb-3 border-b border-slate-900 pb-2">
      <div className="w-full flex justify-center mb-1.5">
        {examData.logoUrl ? (
          <img src={examData.logoUrl} alt="Institution logo" className="h-20 w-auto object-contain" />
        ) : (
          <div className="h-20 w-40 bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-[8px] text-slate-400 no-print">
            Add logo.png to /public
          </div>
        )}
      </div>

      {examData.collegeName?.trim() && (
        <h2 className="text-[11px] font-bold uppercase text-center mb-1">{examData.collegeName}</h2>
      )}

      <div className="text-[10px] font-bold leading-snug">
        <div className="flex justify-between">
          <span>Month and Year: {formatDate(examData.date, examData.month, examData.year)}</span>
          <span>Time: {examData.duration}</span>
        </div>
        <div className="flex justify-between">
          <span>CIA Test: {examData.examTitle}</span>
          <span>Max Marks: {examData.maxMarks}</span>
        </div>
        <div>Programme: {examData.program}</div>
        <div className="flex justify-between gap-3">
          <span>Course Code: {examData.courseCode}</span>
          <span className="text-left">Course Name: {examData.courseName}</span>
        </div>
      </div>
    </div>
  );

  /** One PART: a heading and its four-column table. */
  const partBlocks = examData.parts.map((part) => {
    const partRows = rows.filter((row) => row.partId === part.id);
    if (partRows.length === 0) return null;

    return (
      <div key={part.id} className="rbt-part-block mb-4">
        <h3 className="rbt-part-head text-[11px] font-bold text-center mb-1.5">{part.name}</h3>
        <table className="rbt-table w-full text-[9.5px] leading-snug">
          <thead>
            <tr>
              <th style={{ width: COLS.no }}>Q. No</th>
              <th style={{ width: COLS.q }}>Questions</th>
              <th style={{ width: COLS.co }}>CO</th>
              <th style={{ width: COLS.rbt }}>RBT Level</th>
            </tr>
          </thead>
          <tbody>
            {partRows.map((row) => {
              const meta = rbtMap[row.questionId] ?? {};
              return (
                <tr key={row.questionId}>
                  <td className="text-center align-middle">{row.number}</td>
                  <td className="text-justify">
                    <MathText text={row.text} />
                  </td>
                  <td className="text-center align-middle">{meta.co ?? ''}</td>
                  <td className="text-center align-middle">{meta.rbt ?? row.suggestion.code}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  });

  const sheetBlocks = [
    { key: 'rbt-header', node: headerBlock },
    ...partBlocks.filter(Boolean).map((node, i) => ({ key: `rbt-part-${i}`, node })),
  ];

  /* ---------------- pagination and scaling ---------------- */

  const paginate = useCallback(() => {
    setColumnCount(countColumns(measureRef.current));
  }, []);

  useLayoutEffect(() => {
    paginate();
  }, [paginate, rows, examData.rbtMap, examData.logoUrl]);

  useLayoutEffect(() => {
    const fit = () => {
      const el = areaRef.current;
      if (!el) return;
      const sheetPx = PAGE.width * MM;
      const available = el.clientWidth;
      setPreviewScale(available > 0 ? Math.min(1, available / sheetPx) : 1);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const sheetCount = Math.max(1, Math.ceil(columnCount / 2));
  /* Fits one column -> print both halves identical, cut for two copies. */
  const isDuplicated = columnCount <= 1;

  const flow = (shift: number, flowW: number) => (
    <div
      className="rbt-flow font-serif text-slate-900"
      style={{
        position: 'absolute',
        top: 0,
        left: mm(-shift),
        width: mm(flowW),
        height: mm(USABLE_H),
        columnWidth: mm(COL_W),
        columnGap: mm(PAGE.gap),
        columnFill: 'auto',
      }}
    >
      {sheetBlocks.map((b) => (
        <div key={b.key}>{b.node}</div>
      ))}
    </div>
  );

  const renderSheets = (scale: number, withPageBreaks: boolean) =>
    Array.from({ length: sheetCount }, (_, sheetIndex) => {
      const windowW = isDuplicated ? COL_W : 2 * COL_W + PAGE.gap;
      const flowW =
        Math.max(1, columnCount) * COL_W + Math.max(0, columnCount - 1) * PAGE.gap;
      const offset = isDuplicated ? 0 : sheetIndex * 2 * (COL_W + PAGE.gap);

      return (
        <React.Fragment key={sheetIndex}>
          <div
            className="rbt-sheet-scale"
            style={{ width: mm(PAGE.width * scale), height: mm(PAGE.height * scale) }}
          >
            <div
              className="print-page rbt-page bg-white font-serif text-slate-900 relative"
              style={{
                width: mm(PAGE.width),
                height: mm(PAGE.height),
                paddingTop: mm(PAGE.padTop),
                paddingBottom: mm(PAGE.padBottom),
                paddingLeft: mm(PAGE.padLeft),
                paddingRight: mm(PAGE.padRight),
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                boxSizing: 'border-box',
              }}
            >
              {isDuplicated && (
                <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-slate-300" />
              )}

              {isDuplicated ? (
                <div className="flex" style={{ height: mm(USABLE_H), gap: mm(PAGE.gap) }}>
                  {[0, 1].map((half) => (
                    <div
                      key={half}
                      className="relative overflow-hidden"
                      style={{ width: mm(COL_W), height: mm(USABLE_H) }}
                    >
                      {flow(0, flowW)}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="relative overflow-hidden"
                  style={{ width: mm(windowW), height: mm(USABLE_H) }}
                >
                  {flow(offset, flowW)}
                </div>
              )}
            </div>
          </div>
          {withPageBreaks && sheetIndex < sheetCount - 1 && (
            <div className="html2pdf__page-break" />
          )}
        </React.Fragment>
      );
    });

  /* ---------------- PDF export ---------------- */

  /*
   * Captured from a hidden 1:1 copy, not the on-screen sheet. The visible one
   * carries a CSS transform to fit the viewport, and html2canvas rasterises
   * transformed nodes at the transformed size — which would produce a PDF at
   * whatever zoom the window happened to be at.
   */
  const downloadPdf = async () => {
    const element = exportRef.current;
    if (!element) return;
    setIsExporting(true);
    try {
      await html2pdf()
        .set({
          margin: 0,
          filename: `${examData.courseCode || 'CIA'}_RBT_Mapping.pdf`,
          image: { type: 'jpeg' as const, quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true, logging: false },
          jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'landscape' as const },
          pagebreak: { mode: ['css', 'legacy'] as any },
        })
        .from(element)
        .save();
    } finally {
      setIsExporting(false);
    }
  };

  /* ---------------- render ---------------- */

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
        <Table2 className="mx-auto text-slate-300 mb-3" size={40} />
        <h2 className="text-lg font-semibold text-slate-800">No questions yet</h2>
        <p className="text-sm text-slate-500 mt-1">
          Add questions on the Edit tab, then come back to map CO and RBT levels.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <style>{`
        .rbt-table { border-collapse: collapse; table-layout: fixed; }
        .rbt-table th, .rbt-table td {
          border: 0.6px solid #000;
          padding: 2px 4px;
          vertical-align: top;
        }
        .rbt-table th { text-align: center; font-weight: 700; }
        .rbt-table .katex { font-size: 1em; }
        /* A part's heading must not be stranded at the foot of a column. */
        .rbt-flow .rbt-part-head { break-after: avoid; page-break-after: avoid; }
        .rbt-flow .rbt-header-block { break-inside: avoid; page-break-inside: avoid; }
        /* Rows stay whole; the TABLE may split across columns, which is what
           lets a long paper fill each column instead of jumping to the next. */
        .rbt-flow tr, .rbt-flow th, .rbt-flow td {
          break-inside: avoid; page-break-inside: avoid;
        }
        .rbt-flow thead { display: table-header-group; }
        .rbt-page { box-shadow: 0 1px 3px rgba(0,0,0,.1), 0 8px 24px rgba(0,0,0,.08); }
        .rbt-export-host { position: fixed; left: -20000px; top: 0; }
      `}</style>

      {/*
        Autocomplete source for the CO fields. It offers back only what has
        already been typed on this paper, so the field stays free text.
      */}
      <datalist id="co-suggestions">
        {coSuggestions.map((co) => (
          <option key={co} value={co} />
        ))}
      </datalist>

      {/* ------------ mapping editor ------------ */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden no-print">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-lg font-semibold">CO and RBT mapping</h2>
          <p className="text-sm text-slate-500 mt-1">
            Type the CO for each question. RBT is suggested from the question's task verb and
            can be changed. Amber rows are the ones worth checking before you print.
          </p>
        </div>

        <div className="p-6 space-y-8">
          {examData.parts.map((part) => {
            const partRows = rows.filter((row) => row.partId === part.id);
            if (partRows.length === 0) return null;

            return (
              <div key={part.id}>
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-3">
                  {part.name}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="border border-slate-200 px-3 py-2 w-14 text-center">Q. No</th>
                        <th className="border border-slate-200 px-3 py-2 text-left">Questions</th>
                        <th className="border border-slate-200 px-3 py-2 w-32 text-center">CO</th>
                        <th className="border border-slate-200 px-3 py-2 w-44 text-center">RBT Level</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partRows.map((row) => {
                        const meta = rbtMap[row.questionId] ?? {};
                        const flagged = row.suggestion.needsReview && !meta.rbtConfirmed;
                        const overridden = meta.rbtConfirmed && meta.rbt !== row.suggestion.code;

                        return (
                          <tr key={row.questionId} className={flagged ? 'bg-amber-50' : ''}>
                            <td className="border border-slate-200 px-3 py-2 text-center align-middle font-medium">
                              {row.number}
                            </td>
                            <td className="border border-slate-200 px-3 py-2 align-top">
                              <div className="text-slate-800 leading-relaxed">
                                <MathText text={row.text} />
                              </div>
                              <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
                                {row.suggestion.reasoning}
                                {row.suggestion.alternative && (
                                  <>
                                    {' — or '}
                                    <button
                                      onClick={() =>
                                        setMeta(row.questionId, {
                                          rbt: row.suggestion.alternative!.code,
                                          rbtConfirmed: true,
                                        })
                                      }
                                      className="font-bold text-indigo-600 underline"
                                    >
                                      {row.suggestion.alternative.code}
                                    </button>
                                    {`, since ${row.suggestion.alternative.reason}`}
                                  </>
                                )}
                              </p>
                            </td>
                            <td className="border border-slate-200 px-2 py-2 align-middle">
                              <input
                                type="text"
                                value={meta.co ?? ''}
                                onChange={(e) => setMeta(row.questionId, { co: e.target.value })}
                                list="co-suggestions"
                                placeholder="CO1"
                                className={cn(
                                  'w-full px-2 py-1.5 border rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-indigo-500/20',
                                  meta.co ? 'border-slate-200 bg-white' : 'border-amber-300 bg-amber-50/60'
                                )}
                                aria-label={`Course outcome for question ${row.number}`}
                              />
                            </td>
                            <td className="border border-slate-200 px-2 py-2 align-middle">
                              <select
                                value={meta.rbt ?? row.suggestion.code}
                                onChange={(e) =>
                                  setMeta(row.questionId, { rbt: e.target.value, rbtConfirmed: true })
                                }
                                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500/20"
                                aria-label={`RBT level for question ${row.number}`}
                              >
                                {RBT_OPTIONS.map((level) => (
                                  <option key={level} value={`L${level}`}>
                                    L{level} · {RBT_LABELS[level]}
                                  </option>
                                ))}
                              </select>
                              <span className="block mt-1 text-[11px] text-slate-400 text-center">
                                {overridden
                                  ? 'set by you'
                                  : flagged
                                    ? 'check this'
                                    : `${Math.round(row.suggestion.confidence * 100)}% match`}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {/* paper-level summary */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-5 py-4 text-sm">
            <p className="font-semibold text-slate-700 mb-1.5">Before you print</p>
            <ul className="space-y-1 text-slate-600 text-xs">
              {missingCo > 0 && (
                <li className="flex gap-2 text-amber-700">
                  <AlertTriangle size={14} className="shrink-0 mt-px" />
                  {missingCo} question{missingCo === 1 ? '' : 's'} still without a CO — those cells
                  print blank.
                </li>
              )}
              {needsReview > 0 && (
                <li className="flex gap-2 text-amber-700">
                  <AlertTriangle size={14} className="shrink-0 mt-px" />
                  {needsReview} RBT level{needsReview === 1 ? '' : 's'} worth a second look (amber rows).
                </li>
              )}
              {balance.warnings.map((warning) => (
                <li key={warning} className="flex gap-2 text-amber-700">
                  <AlertTriangle size={14} className="shrink-0 mt-px" />
                  {warning}
                </li>
              ))}
              <li className="text-slate-500 pt-0.5">
                Spread:{' '}
                {Object.keys(balance.counts).length
                  ? Object.entries(balance.counts)
                      .sort()
                      .map(([code, n]) => `${code}×${n}`)
                      .join('   ')
                  : '—'}
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ------------ printable sheet ------------ */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-full flex items-center justify-between no-print">
          <h2 className="text-lg font-semibold text-slate-800">RBT sheet</h2>
          <span className="text-xs text-slate-500">
            {isDuplicated
              ? 'Fits one column — both halves identical, cut for 2 copies'
              : `${columnCount} pages across ${sheetCount} sheet${sheetCount > 1 ? 's' : ''}`}
          </span>
        </div>

        {/* Hidden measuring box: one column wide, so overflow columns to the
            right reveal how many columns the content actually needs. */}
        <div
          ref={measureRef}
          aria-hidden="true"
          className="font-serif text-slate-900 no-print rbt-flow"
          style={{
            position: 'fixed',
            left: '-10000px',
            top: 0,
            width: mm(COL_W),
            height: mm(USABLE_H),
            overflow: 'hidden',
            visibility: 'hidden',
            pointerEvents: 'none',
            columnWidth: mm(COL_W),
            columnGap: mm(PAGE.gap),
            columnFill: 'auto',
          }}
        >
          {sheetBlocks.map((b) => (
            <div key={b.key}>{b.node}</div>
          ))}
        </div>

        <div ref={areaRef} className="w-full" />
        <div className="flex flex-col items-center gap-8 w-full">
          {renderSheets(previewScale, false)}
        </div>

        {/* 1:1 copy used only as the PDF capture source. */}
        <div ref={exportRef} className="rbt-export-host no-print" aria-hidden="true">
          {renderSheets(1, true)}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 no-print">
        <button
          onClick={() => window.print()}
          className="bg-white border border-slate-200 text-slate-700 px-6 py-3 rounded-xl font-semibold flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm"
        >
          <Printer size={20} />
          Print RBT Sheet
        </button>
        <button
          onClick={downloadPdf}
          disabled={isExporting}
          className="bg-rose-600 text-white px-8 py-3 rounded-xl font-semibold flex items-center gap-2 hover:bg-rose-700 transition-all shadow-md justify-center disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Download size={20} />
          {isExporting ? 'Building PDF…' : 'Download RBT PDF'}
        </button>
      </div>
    </div>
  );
};

export default RbtTab;
