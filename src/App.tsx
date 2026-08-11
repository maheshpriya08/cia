import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  Download, 
  Eye, 
  Edit3, 
  FileText, 
  ChevronRight, 
  ChevronDown, 
  Copy, 
  Image as ImageIcon,
  CheckCircle2,
  Printer,
  Table2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
// @ts-ignore
import html2pdf from 'html2pdf.js';
import katex from 'katex';
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, VerticalAlign, ImageRun, SectionType, PageOrientation, ShadingType, PageBreak } from 'docx';
import { saveAs } from 'file-saver';
import { ExamData, ExamPart, Question, SubQuestion } from './types';
import { cn } from './utils';
import { MathText } from './components/MathText';
import {
  VoiceProvider,
  VoiceSettingsBar,
  VoiceTextArea,
  VoiceField,
} from './components/VoiceInput';
import { loadBundledLogo, fileToPngDataUrl } from './lib/logo';
import { MM, PAGE, USABLE_H, COL_W, mm, countColumns } from './lib/page';
import { RbtTab } from './components/RbtTab';
import type { RbtMeta } from './types';

const PROGRAMS = [
  "B.Tech. Computer Science & Engineering",
  "B.Tech. Electronics & Communication Engineering",
  "BBA",
  "BCA",
  "B.Com",
  "B.Sc. Biochemistry",
  "B.Sc. Computer Science",
  "B.Sc. Electronics and Communication System",
  "B.Sc. Mathematics with Computer Applications",
  "B.Sc. Microbiology",
  "B.Sc. Physics",
  "M.Com",
  "M.Sc. Biochemistry",
  "M.Sc. Computer Science",
  "M.Sc. Mathematics",
  "M.Sc. Microbiology"
];

/* ------------------------------------------------------------------ */
/* Page geometry - A4 landscape, two sequential columns                 */
/* ------------------------------------------------------------------ */
/* Moved to lib/page.ts so the RBT sheet fragments against the same box. */

/** Word measures in twips: 1mm = 56.6929 twips. */
const TWIPS_PER_MM = 56.6929;
const mmToTwips = (v: number) => Math.round(v * TWIPS_PER_MM);
const A4_LANDSCAPE_TWIPS = {
  width: mmToTwips(PAGE.width),   // 297mm -> 16838
  height: mmToTwips(PAGE.height), // 210mm -> 11906
};

/** localStorage key holding the work-in-progress paper. */
const DRAFT_KEY = 'cia-exam-draft';

/* ------------------------------------------------------------------ */
/* Word table borders                                                   */
/* ------------------------------------------------------------------ */
/*
 * Tables are used in the .docx for two very different jobs:
 *
 *   LAYOUT  - the two-cell sheet imposition, the exam header block and the
 *             part headings. These must be INVISIBLE, exactly as they are in
 *             the PDF. BorderStyle.NONE on its own is not enough: Word falls
 *             back to its default table style and draws the box anyway, which
 *             is where the stray boxes came from. Pinning size 0 AND a colour
 *             on every edge - including the cell edges - suppresses it.
 *
 *   DATA    - tables the user typed into a question. In the PDF these show a
 *             black grid, so the .docx must draw one too.
 */
const NO_EDGE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const INVISIBLE_TABLE = {
  top: NO_EDGE, bottom: NO_EDGE, left: NO_EDGE, right: NO_EDGE,
  insideHorizontal: NO_EDGE, insideVertical: NO_EDGE,
};
const INVISIBLE_CELL = { top: NO_EDGE, bottom: NO_EDGE, left: NO_EDGE, right: NO_EDGE };

const DATA_EDGE = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const DATA_TABLE_BORDERS = {
  top: DATA_EDGE, bottom: DATA_EDGE, left: DATA_EDGE, right: DATA_EDGE,
  insideHorizontal: DATA_EDGE, insideVertical: DATA_EDGE,
};
const DATA_CELL_BORDERS = { top: DATA_EDGE, bottom: DATA_EDGE, left: DATA_EDGE, right: DATA_EDGE };

/** No cell padding, so a layout table occupies exactly the space it is given. */
const TIGHT_MARGINS = { top: 0, bottom: 0, left: 0, right: 0 };

const EXAM_TITLES = ["First", "Second", "Third"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const YEARS = Array.from({ length: 11 }, (_, i) => (new Date().getFullYear() - 5 + i).toString());

const INITIAL_DATA: ExamData = {
  courseCode: '',
  courseName: '',
  examTitle: 'First',
  duration: '1.30 hours',
  maxMarks: '50 Marks',
  date: '',
  month: MONTHS[new Date().getMonth()],
  year: new Date().getFullYear().toString(),
  // Institution name line removed from the paper header by request.
  // Leave blank to show the logo alone; type a name here only if you want a
  // text line to reappear under the logo.
  collegeName: '',
  semester: '',
  program: PROGRAMS[0],
  logoUrl: null,
  parts: [
    { id: 'part-a', name: 'Part A', instructions: 'Answer all the questions', questionCount: 5, questionsToAnswer: 5, marksPerQuestion: 2, totalMarks: 10, questions: Array.from({ length: 5 }, (_, i) => ({ id: `q-a-${i}`, text: '', subQuestions: [], images: [], tables: [] })) },
    { id: 'part-b', name: 'Part B', instructions: 'Answer all the questions', questionCount: 4, questionsToAnswer: 4, marksPerQuestion: 4, totalMarks: 16, questions: Array.from({ length: 4 }, (_, i) => ({ id: `q-b-${i}`, text: '', subQuestions: [], images: [], tables: [] })) },
    { id: 'part-c', name: 'Part C', instructions: 'Answer any 2 questions', questionCount: 3, questionsToAnswer: 2, marksPerQuestion: 12, totalMarks: 24, questions: Array.from({ length: 3 }, (_, i) => ({ id: `q-c-${i}`, text: '', subQuestions: [], images: [], tables: [] })) },
  ]
};

/* ------------------------------------------------------------------ */
/* Unicode fallback for maths (used only when rasterising fails)        */
/* ------------------------------------------------------------------ */
/*
 * Two ordering bugs used to corrupt output here:
 *   \int   -> the shorter key \in matched first, giving  "∈t"
 *   \cdots -> the shorter key \cdot matched first, giving "·s"
 * Fixed by applying the longest key first AND refusing a match that is
 * followed by another letter, so \in can never eat the head of \int.
 */

const MATH_SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷',
  '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  'n': 'ⁿ', 'i': 'ⁱ', 'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'k': 'ᵏ',
  'm': 'ᵐ', 'p': 'ᵖ', 't': 'ᵗ', 'x': 'ˣ', 'y': 'ʸ', 'T': 'ᵀ',
};

const MATH_SUBSCRIPTS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇',
  '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  'a': 'ₐ', 'e': 'ₑ', 'o': 'ₒ', 'x': 'ₓ', 'h': 'ₕ', 'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ',
  'n': 'ₙ', 'p': 'ₚ', 's': 'ₛ', 't': 'ₜ', 'i': 'ᵢ', 'j': 'ⱼ', 'r': 'ᵣ', 'u': 'ᵤ', 'v': 'ᵥ',
};

const MATH_SYMBOLS: Record<string, string> = {
  '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\epsilon': 'ε',
  '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ', '\\iota': 'ι', '\\kappa': 'κ',
  '\\lambda': 'λ', '\\mu': 'μ', '\\nu': 'ν', '\\xi': 'ξ', '\\pi': 'π', '\\rho': 'ρ',
  '\\sigma': 'σ', '\\tau': 'τ', '\\upsilon': 'υ', '\\phi': 'φ', '\\chi': 'χ',
  '\\psi': 'ψ', '\\omega': 'ω',
  '\\Delta': 'Δ', '\\Sigma': 'Σ', '\\Omega': 'Ω', '\\Theta': 'Θ', '\\Phi': 'Φ',
  '\\Gamma': 'Γ', '\\Lambda': 'Λ', '\\Pi': 'Π', '\\Psi': 'Ψ',
  '\\pm': '±', '\\mp': '∓', '\\times': '×', '\\div': '÷', '\\neq': '≠',
  '\\leq': '≤', '\\geq': '≥', '\\equiv': '≡', '\\infty': '∞', '\\approx': '≈',
  '\\propto': '∝', '\\therefore': '∴', '\\because': '∵',
  '\\rightarrow': '→', '\\leftarrow': '←', '\\Rightarrow': '⇒', '\\Leftarrow': '⇐',
  '\\Leftrightarrow': '⇔', '\\iff': '⇔', '\\to': '→', '\\mapsto': '↦',
  '\\forall': '∀', '\\exists': '∃', '\\notin': '∉', '\\in': '∈',
  '\\subseteq': '⊆', '\\subset': '⊂', '\\supset': '⊃',
  '\\cup': '∪', '\\cap': '∩', '\\emptyset': '∅', '\\mid': '|',
  '\\iiint': '∭', '\\iint': '∬', '\\oint': '∮', '\\int': '∫',
  '\\partial': '∂', '\\nabla': '∇', '\\angle': '∠', '\\perp': '⊥', '\\parallel': '∥',
  '\\prod': '∏', '\\sum': '∑',
  '\\cdots': '⋯', '\\vdots': '⋮', '\\ddots': '⋱', '\\ldots': '…', '\\dots': '…',
  '\\cdot': '·',
  '\\sin': 'sin', '\\cos': 'cos', '\\tan': 'tan', '\\csc': 'csc', '\\sec': 'sec',
  '\\cot': 'cot', '\\log': 'log', '\\ln': 'ln', '\\lim': 'lim', '\\det': 'det',
  '\\bmod': 'mod', '\\vec': '', '\\bar': '', '\\hat': '', '\\tilde': '',
  '\\sqrt': '√', '\\%': '%', '\\&': '&', '\\_': '_', '\\$': '$', '\\{': '{', '\\}': '}',
};

/** Whole run of characters to unicode super/subscript, or a readable fallback. */
const toUnicodeScript = (body: string, map: Record<string, string>, prefix: string): string => {
  const chars = Array.from(body);
  if (chars.length && chars.every(c => map[c])) return chars.map(c => map[c]).join('');
  return `${prefix}(${body})`;
};

const formatMathForWord = (text: string): string => {
  if (!text) return '';
  let result = text;

  // strip the delimiters
  result = result.replace(/\$\$/g, '').replace(/\$/g, '');

  // matrices -> [a b; c d]
  result = result.replace(
    /\\begin\{[a-z]*matrix\}([\s\S]*?)\\end\{[a-z]*matrix\}/gi,
    (_m, body: string) =>
      '[' + body.trim().split(/\\\\/).map(row =>
        row.trim().split('&').map(c => c.trim()).join(' ')
      ).join('; ') + ']'
  );

  // fractions (repeat so simple nesting resolves)
  for (let i = 0; i < 4; i++) {
    result = result.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
  }
  result = result.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');

  // sizing and spacing commands carry no meaning in plain text
  result = result.replace(/\\left|\\right/g, '');
  result = result.replace(/\\[,;:!]/g, ' ');

  // LONGEST KEY FIRST + no-letter-follows guard: this is the \int / \cdots fix
  Object.keys(MATH_SYMBOLS)
    .sort((a, b) => b.length - a.length)
    .forEach(key => {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const guard = /[a-zA-Z]$/.test(key) ? '(?![a-zA-Z])' : '';
      result = result.replace(new RegExp(escaped + guard, 'g'), MATH_SYMBOLS[key]);
    });

  // super/subscripts, multi-character aware
  result = result.replace(/\^\{([^{}]*)\}/g, (_m, g: string) => toUnicodeScript(g, MATH_SUPERSCRIPTS, '^'));
  result = result.replace(/\^([A-Za-z0-9])/g, (_m, g: string) => toUnicodeScript(g, MATH_SUPERSCRIPTS, '^'));
  result = result.replace(/_\{([^{}]*)\}/g, (_m, g: string) => toUnicodeScript(g, MATH_SUBSCRIPTS, '_'));
  result = result.replace(/_([A-Za-z0-9])/g, (_m, g: string) => toUnicodeScript(g, MATH_SUBSCRIPTS, '_'));

  // anything still unrecognised: drop the backslash but keep the word
  result = result.replace(/\\([A-Za-z]+)/g, '$1');
  result = result.replace(/[{}]/g, '').replace(/\s{2,}/g, ' ');

  return result.trim();
};

/* ------------------------------------------------------------------ */
/* Maths for the Word export                                            */
/* ------------------------------------------------------------------ */
/*
 * Word cannot read LaTeX, and the old string-mangling fallback
 * (formatMathForWord) destroyed anything beyond a lone superscript:
 *   \frac{a+b}{c}          -> (a+b/c)
 *   \sum_{i=1}^{n} x_{i}   -> Ei=1n xi
 *   \begin{pmatrix}...     -> unreadable
 *
 * Instead each $...$ / $$...$$ segment is rendered by KaTeX - the very same
 * engine the on-screen preview and the print PDF use - and rasterised to a
 * PNG that is embedded inline. The .docx therefore matches the print output
 * exactly. formatMathForWord survives only as a fallback if rasterising fails.
 */

type MathImage = { data: string; width: number; height: number };

/** Splits on $$...$$ and $...$ while KEEPING the delimiters (capturing group). */
const MATH_SPLIT = /(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g;
const IS_BLOCK_MATH = /^\$\$[\s\S]+\$\$$/;
const IS_INLINE_MATH = /^\$[\s\S]+\$$/;

const isMathSegment = (part: string) =>
  IS_BLOCK_MATH.test(part) || IS_INLINE_MATH.test(part);

/** Every distinct math segment inside a piece of text. */
const extractMathSegments = (text?: string): string[] =>
  (text || '').split(MATH_SPLIT).filter(isMathSegment);

/**
 * Render one segment to a PNG at the same visual size as 10pt body text.
 * 10pt = 13.33px at 96dpi, which is the unit docx transformation uses.
 */
const renderMathToImage = async (segment: string): Promise<MathImage | null> => {
  const block = IS_BLOCK_MATH.test(segment);
  const latex = block ? segment.slice(2, -2) : segment.slice(1, -1);
  const SCALE = 3; // supersample so the equation stays crisp when printed

  const host = document.createElement('div');
  host.style.cssText = [
    'position:fixed', 'left:-10000px', 'top:0', 'z-index:-1',
    'display:inline-block', 'background:#ffffff', 'color:#000000',
    'font-size:13.33px', 'line-height:normal', 'padding:1px',
  ].join(';');

  try {
    host.innerHTML = katex.renderToString(latex, {
      throwOnError: false,
      displayMode: block,
      output: 'html',
    });
  } catch {
    return null;
  }

  document.body.appendChild(host);
  try {
    // KaTeX uses custom fonts; rasterising before they load yields boxes.
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const canvas = await html2canvas(host, {
      backgroundColor: '#ffffff',
      scale: SCALE,
      logging: false,
    });
    if (!canvas.width || !canvas.height) return null;
    return {
      data: canvas.toDataURL('image/png').split(',')[1],
      width: Math.max(1, Math.round(canvas.width / SCALE)),
      height: Math.max(1, Math.round(canvas.height / SCALE)),
    };
  } catch (e) {
    console.error('Could not rasterise equation:', latex, e);
    return null;
  } finally {
    document.body.removeChild(host);
  }
};

const formatDate = (dateStr: string, month?: string, year?: string) => {
  if (month && year) return `${month} ${year}`;
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } catch (e) {
    return dateStr;
  }
};

export default function App() {
  /*
   * Draft persistence.
   * The saved draft is merged over INITIAL_DATA rather than replacing it, so a
   * draft written by an older build still gains any newly added fields instead
   * of arriving as undefined.
   */
  const [examData, setExamData] = useState<ExamData>(() => {
    const savedLogo = localStorage.getItem('cia-exam-logo');
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const data = saved && saved.examData ? saved.examData : saved;
        if (data && Array.isArray(data.parts)) {
          return { ...INITIAL_DATA, ...data, logoUrl: data.logoUrl ?? savedLogo };
        }
      }
    } catch (e) {
      console.error('Could not restore the saved draft:', e);
    }
    return { ...INITIAL_DATA, logoUrl: savedLogo };
  });
  const [savedAt, setSavedAt] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? (JSON.parse(raw).savedAt ?? null) : null;
    } catch { return null; }
  });
  const [activeTab, setActiveTab] = useState<'edit' | 'preview' | 'rbt'>('edit');
  const [expandedPart, setExpandedPart] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  /** How many columns the flowed content occupies (1 column == 1 page). */
  const [columnCount, setColumnCount] = useState(1);
  /*
   * An A4 landscape sheet is 297mm = 1122px at 96dpi, which is wider than the
   * editor column, so at 1:1 the right-hand edge was being cut off on screen.
   * The sheet is therefore scaled down to fit the viewport for DISPLAY ONLY -
   * printing always uses the true 297x210mm box (see the print rules).
   */
  const [previewScale, setPreviewScale] = useState(1);
  const previewAreaRef = useRef<HTMLDivElement>(null);

  /*
   * The paper as a flat list of blocks: the exam header, then a heading per
   * part, then one per question. They are handed to a CSS multi-column flow,
   * which fragments them - questions may split across the column boundary.
   */
  const previewBlocks = useMemo(() => {
    const list: { key: string; node: React.ReactNode }[] = [];

    list.push({
      key: 'exam-header',
      node: (
                <div className="exam-header-block mb-4 border-b border-slate-900 pb-3">
                  <div className="flex flex-col items-center text-center mb-2">
                    {/* Logo — first element at the top of the paper */}
                    <div className="w-full flex justify-center mb-1.5">
                      {examData.logoUrl ? (
                        <img src={examData.logoUrl} alt="Institution logo" className="h-24 w-auto object-contain" />
                      ) : (
                        <div className="h-24 w-44 bg-slate-100 flex items-center justify-center text-[8px] text-slate-400 border border-dashed border-slate-300 no-print">
                          Add logo.png to /public
                        </div>
                      )}
                    </div>

                    {/* Institution name line removed. It only renders if a name
                        is typed in Basic Exam Details. */}
                    {examData.collegeName?.trim() && (
                      <h2 className="text-[12px] font-bold uppercase w-full">
                        {examData.collegeName}
                      </h2>
                    )}

                    {/* Exam Details Grid */}
                    <div className="w-full mt-1.5 text-[11px] leading-tight space-y-0.5 font-bold">
                      <div className="flex justify-between">
                        <div className="text-left">
                          <span>Month and Year:</span> {formatDate(examData.date, examData.month, examData.year)}
                        </div>
                        <div className="text-right">
                          <span>Time:</span> {examData.duration}
                        </div>
                      </div>
                      <div className="flex justify-between">
                        <div className="text-left">
                          <span>CIA Test:</span> {examData.examTitle}
                        </div>
                        <div className="text-right">
                          <span>Max Marks:</span> {examData.maxMarks}
                        </div>
                      </div>
                      <div className="text-left">
                        <span>Programme:</span> {examData.program}
                      </div>
                      <div className="flex justify-between">
                        <div className="text-left">
                          <span>Course Name:</span> {examData.courseName}
                        </div>
                        <div className="text-right">
                          <span>Course Code:</span> {examData.courseCode}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
      ),
    });

    let globalNum = 0;
    examData.parts.forEach((part) => {
      list.push({
        key: `${part.id}::head`,
        node: (
          <div className="part-head-block mb-1">
            <div className="text-center mb-0.5">
              <h3 className="text-sm font-bold uppercase tracking-widest">{part.name}</h3>
            </div>
            <div className="flex justify-between items-end text-[12px] font-bold mb-1">
              <p>{part.instructions || 'Answer all the questions'}</p>
              <p>{part.questionsToAnswer ?? part.questionCount} x {part.marksPerQuestion} = {part.totalMarks} marks</p>
            </div>
          </div>
        ),
      });

      part.questions.forEach((q) => {
        if (!q.isOr) globalNum++;
        const n = globalNum;
        list.push({
          key: q.id,
          node: (
            <div className="mb-1 space-y-1">

                              {q.isOr && (
                                <div className="text-center font-bold py-0.5 uppercase tracking-widest text-[11px]">(OR)</div>
                              )}
                              {/* NO break-inside-avoid here: a question is
                                  allowed to start at the foot of one column
                                  and continue at the head of the next. That is
                                  the trade for leaving no gaps. Only the exam
                                  header, part headings, tables and images are
                                  protected from splitting. */}
                              <div className="relative">
                                <div className="flex gap-2">
                                  <span className="font-normal min-w-[16px] text-[13px]">{n}.</span>
                                  <div className="flex-1 space-y-1">
                                    <div className="text-[13px] leading-relaxed">
                                      <MathText text={q.text} />
                                    </div>

                                 {/* Tables in Preview */}
                                 {q.tables && q.tables.length > 0 && q.tables.map((table, tIdx) => (
                                  <div key={tIdx} className="my-1 overflow-x-auto">
                                    <table className="w-full border-collapse border border-slate-900 text-[11px]">
                                      <tbody>
                                        {table.rows.map((row, rIdx) => (
                                          <tr key={rIdx}>
                                            {row.map((cell, cIdx) => (
                                              <td key={cIdx} className="border border-slate-900 p-1 text-center">
                                                <MathText text={cell} />
                                              </td>
                                            ))}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ))}

                                {/* Images in Preview */}
                                {q.images && q.images.length > 0 && q.images.map((img, imgIdx) => (
                                  <div key={imgIdx} className="my-1 flex justify-center">
                                    <img src={img} alt={`Diagram ${imgIdx + 1}`} className="max-w-full max-h-32 object-contain" />
                                  </div>
                                ))}

                                {q.subQuestions.length > 0 && (
                                  <div className="mt-1 space-y-0.5">
                                    {q.subQuestions.map((sq, sqIdx) => (
                                      <div key={sq.id} className="flex gap-2 justify-between">
                                        <div className="flex gap-2">
                                          <span className="font-medium min-w-[16px] text-[12px]">({String.fromCharCode(97 + sqIdx)})</span>
                                          <div className="text-[12px]">
                                            <MathText text={sq.text} />
                                          </div>
                                        </div>
                                        {sq.marks && (
                                          <span className="text-[11px] font-bold whitespace-nowrap">({sq.marks})</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
            </div>
          ),
        });
      });
    });

    return list;
  }, [examData]);

  /*
   * Instead of assigning whole blocks to columns, the content is laid out ONCE
   * as a real CSS multi-column flow with a fixed column height. The browser
   * then fragments it exactly the way it will when printed: a question that
   * does not fit starts at the foot of one column and continues at the head of
   * the next, so no column is left half empty.
   *
   * All we have to measure is HOW MANY columns the flow ends up needing. A
   * fixed-height multicol box whose width fits a single column pushes the
   * surplus into overflow columns laid out to the right, so scrollWidth tells
   * us the total directly.
   */
  const paginate = useCallback(() => {
    setColumnCount(countColumns(measureRef.current));
  }, []);

  useLayoutEffect(() => { paginate(); }, [previewBlocks, paginate, activeTab]);

  useLayoutEffect(() => {
    const fit = () => {
      const el = previewAreaRef.current;
      if (!el) return;
      const sheetPx = PAGE.width * MM;               // 297mm at 96dpi
      const available = el.clientWidth;
      setPreviewScale(available > 0 ? Math.min(1, available / sheetPx) : 1);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [activeTab]);

  /*
   * One COLUMN is one page; a sheet holds two side by side. There is no cap
   * on the number of sheets - the content flows on for as many as it needs.
   *   fits one column -> duplicated into both halves, cut for two copies
   *   otherwise       -> continuous flow: page 1 left, page 2 right, page 3
   *                      on the next sheet, and so on
   */
  const isDuplicated = columnCount === 1;
  const sheetCount = isDuplicated ? 1 : Math.ceil(columnCount / 2);

  // KaTeX webfonts and images settle after first paint, so re-measure once ready.
  useEffect(() => {
    const t = window.setTimeout(paginate, 350);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(paginate).catch(() => {});
    return () => window.clearTimeout(t);
  }, [previewBlocks, paginate]);


  /*
   * Autosave. Debounced so typing does not hit localStorage on every keystroke.
   * This is what makes the paper survive closing the tab and coming back days
   * later - previously the draft key was only ever DELETED, never written, so
   * the "Draft Saved Locally" badge was claiming a save that never happened.
   */
  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        const stamp = Date.now();
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: stamp, examData }));
        setSavedAt(stamp);
      } catch (e) {
        console.error('Could not save the draft:', e);
      }
    }, 600);
    return () => window.clearTimeout(handle);
  }, [examData]);

  useEffect(() => {
    if (examData.logoUrl) {
      localStorage.setItem('cia-exam-logo', examData.logoUrl);
    } else {
      localStorage.removeItem('cia-exam-logo');
    }
  }, [examData.logoUrl]);

  // If no logo has been uploaded, fall back to the one bundled in /public
  // (logo.png -> logo.jpg -> logo.png) so the header always opens with a logo.
  useEffect(() => {
    let cancelled = false;
    if (examData.logoUrl) return;
    loadBundledLogo().then((png) => {
      if (!cancelled && png) {
        setExamData((prev) => (prev.logoUrl ? prev : { ...prev, logoUrl: png }));
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBasicDetailsChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setExamData(prev => ({ ...prev, [name]: value }));
  };

  const toggleProgram = (program: string) => {
    setExamData(prev => {
      const currentPrograms = prev.program ? prev.program.split(' / ') : [];
      if (currentPrograms.includes(program)) {
        const newPrograms = currentPrograms.filter(p => p !== program);
        return { ...prev, program: newPrograms.join(' / ') };
      } else {
        return { ...prev, program: [...currentPrograms, program].join(' / ') };
      }
    });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const png = await fileToPngDataUrl(file);
      setExamData(prev => ({ ...prev, logoUrl: png }));
    } catch {
      const reader = new FileReader();
      reader.onloadend = () => {
        setExamData(prev => ({ ...prev, logoUrl: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  /** Reset to the logo bundled in /public (used by the "Use default logo" button). */
  const useBundledLogo = async () => {
    const png = await loadBundledLogo();
    setExamData(prev => ({ ...prev, logoUrl: png }));
  };

  const addPart = () => {
    const nextPartChar = String.fromCharCode(65 + examData.parts.length);
    const newPart: ExamPart = {
      id: `part-${Date.now()}`,
      name: `Part ${nextPartChar}`,
      questionCount: 1,
      marksPerQuestion: 5,
      totalMarks: 5,
      questions: [{ id: `q-${Date.now()}-0`, text: '', subQuestions: [], images: [], tables: [] }]
    };
    setExamData(prev => ({ ...prev, parts: [...prev.parts, newPart] }));
    setExpandedPart(newPart.id);
  };

  const deletePart = (id: string) => {
    setExamData(prev => ({ ...prev, parts: prev.parts.filter(p => p.id !== id) }));
  };

  const duplicatePart = (part: ExamPart) => {
    const newPart: ExamPart = {
      ...part,
      id: `part-${Date.now()}`,
      name: `${part.name} (Copy)`,
      questions: part.questions.map((q, i) => ({
        ...q,
        id: `q-${Date.now()}-${i}`,
        subQuestions: q.subQuestions.map((sq, j) => ({ ...sq, id: `sq-${Date.now()}-${i}-${j}` }))
      }))
    };
    setExamData(prev => ({ ...prev, parts: [...prev.parts, newPart] }));
    setExpandedPart(newPart.id);
  };

  const updatePart = (id: string, updates: Partial<ExamPart>) => {
    setExamData(prev => ({
      ...prev,
      parts: prev.parts.map(p => {
        if (p.id !== id) return p;
        const updated = { ...p, ...updates };
        
        // If questionCount changed, adjust questions array
        if (updates.questionCount !== undefined) {
          const currentCount = p.questions.length;
          const newCount = updates.questionCount;
          if (newCount > currentCount) {
            const extra = Array.from({ length: newCount - currentCount }, (_, i) => ({
              id: `q-${id}-${currentCount + i}`,
              text: '',
              subQuestions: [],
              images: [],
              tables: []
            }));
            updated.questions = [...p.questions, ...extra];
          } else if (newCount < currentCount) {
            updated.questions = p.questions.slice(0, newCount);
          }
        }
        
        // Recalculate total marks
        if (updates.marksPerQuestion !== undefined || updates.questionCount !== undefined || updates.questionsToAnswer !== undefined) {
          const toAnswer = updated.questionsToAnswer ?? updated.questionCount;
          updated.totalMarks = toAnswer * updated.marksPerQuestion;
        }

        return updated;
      })
    }));
  };

  const updateQuestion = (partId: string, qId: string, updates: Partial<Question>) => {
    setExamData(prev => ({
      ...prev,
      parts: prev.parts.map(p => {
        if (p.id !== partId) return p;
        return {
          ...p,
          questions: p.questions.map(q => q.id === qId ? { ...q, ...updates } : q)
        };
      })
    }));
  };

  const addSubQuestion = (partId: string, qId: string) => {
    setExamData(prev => ({
      ...prev,
      parts: prev.parts.map(p => {
        if (p.id !== partId) return p;
        return {
          ...p,
          questions: p.questions.map(q => {
            if (q.id !== qId) return q;
            return {
              ...q,
              subQuestions: [
                ...q.subQuestions,
                { id: `sq-${Date.now()}`, text: '', marks: undefined }
              ]
            };
          })
        };
      })
    }));
  };

  const updateSubQuestion = (partId: string, qId: string, sqId: string, updates: Partial<SubQuestion>) => {
    setExamData(prev => ({
      ...prev,
      parts: prev.parts.map(p => {
        if (p.id !== partId) return p;
        return {
          ...p,
          questions: p.questions.map(q => {
            if (q.id !== qId) return q;
            return {
              ...q,
              subQuestions: q.subQuestions.map(sq => sq.id === sqId ? { ...sq, ...updates } : sq)
            };
          })
        };
      })
    }));
  };

  const deleteSubQuestion = (partId: string, qId: string, sqId: string) => {
    setExamData(prev => ({
      ...prev,
      parts: prev.parts.map(p => {
        if (p.id !== partId) return p;
        return {
          ...p,
          questions: p.questions.map(q => {
            if (q.id !== qId) return q;
            return {
              ...q,
              subQuestions: q.subQuestions.filter(sq => sq.id !== sqId)
            };
          })
        };
      })
    }));
  };

  const exportPDF = async () => {
    if (!previewRef.current) return;
    
    const element = previewRef.current;
    const opt = {
      margin: [14.3, 9.5, 7.9, 7.9] as [number, number, number, number],
      filename: `${examData.courseCode || 'CIA'}_Exam_Paper.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { 
        scale: 2, 
        useCORS: true, 
        letterRendering: true,
        logging: false 
      },
      jsPDF: { unit: 'mm' as const, format: 'letter' as const, orientation: 'landscape' as const },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] as any }
    };

    // New Promise-based usage:
    html2pdf().set(opt).from(element).save();
  };

  const generateLaTeX = () => {
    let latex = `\\documentclass[a4paper,10pt,twocolumn]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=0.5in]{geometry}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage{enumitem}
\\usepackage{array}
\\usepackage{multirow}

\\title{${examData.examTitle}}
\\author{${examData.collegeName || ''}}
\\date{${formatDate(examData.date, examData.month, examData.year)}}

\\begin{document}

\\begin{center}
    \\includegraphics[height=2.2cm]{logo} \\\\[4pt]
${examData.collegeName?.trim() ? `    \\textbf{\\Large ${examData.collegeName}} \\\\\n` : ''}    \\textbf{${examData.examTitle}} \\\\
    \\textbf{Programme: ${examData.program}} \\\\
    \\textbf{Course Code: ${examData.courseCode}} \\quad \\textbf{Course Name: ${examData.courseName}} \\\\
    \\textbf{Duration: ${examData.duration}} \\hfill \\textbf{Max Marks: ${examData.maxMarks}}
\\end{center}

\\hrule
\\vspace{0.2in}

`;

    examData.parts.forEach(part => {
      latex += `\\section*{${part.name}} \n`;
      if (part.instructions) {
        latex += `\\textit{${part.instructions}} \\\\ \n`;
      }
      latex += `\\textit{Answer any ${part.questionsToAnswer ?? part.questionCount} questions. (${part.marksPerQuestion} marks each)} \n\n`;

      latex += `\\begin{enumerate} \n`;
      part.questions.forEach(q => {
        if (q.isOr) {
          latex += `\\item[] \\begin{center} \\textbf{(OR)} \\end{center} \n`;
        }
        latex += `\\item ${q.text} \n`;
        
        if (q.images && q.images.length > 0) {
          q.images.forEach((_, imgIdx) => {
            latex += `\\begin{center} \n % [IMAGE PLACEHOLDER: Diagram ${imgIdx + 1}] \n % \\includegraphics[width=0.8\\textwidth]{diagram_${imgIdx + 1}.png} \n \\end{center} \n`;
          });
        }

        if (q.tables && q.tables.length > 0) {
          q.tables.forEach(table => {
            const colCount = table.rows[0]?.length || 1;
            latex += `\\begin{center} \n \\begin{tabular}{|${Array(colCount).fill('c|').join('')}} \n \\hline \n`;
            table.rows.forEach(row => {
              latex += ` ${row.join(' & ')} \\\\ \\hline \n`;
            });
            latex += `\\end{tabular} \n \\end{center} \n`;
          });
        }

        if (q.subQuestions && q.subQuestions.length > 0) {
          latex += `\\begin{enumerate}[label=(\\alph*)] \n`;
          q.subQuestions.forEach(sq => {
            latex += `\\item ${sq.text} \n`;
          });
          latex += `\\end{enumerate} \n`;
        }
      });
      latex += `\\end{enumerate} \n\n`;
    });

    latex += `\\end{document}`;
    return latex;
  };

  const exportOverleaf = () => {
    const latex = generateLaTeX();
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = 'https://www.overleaf.com/docs';
    form.target = '_blank';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'snip';
    input.value = latex;

    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  };

  const exportWord = async () => {
    setIsExporting(true);
    try {
    // Rasterise every distinct equation once, up front, so the synchronous
    // document tree below can just look each one up.
    const segments = new Set<string>();
    const collect = (t?: string) => extractMathSegments(t).forEach(seg => segments.add(seg));
    examData.parts.forEach(part => part.questions.forEach(q => {
      collect(q.text);
      q.subQuestions.forEach(sq => collect(sq.text));
      (q.tables || []).forEach(tb => tb.rows.forEach(row => row.forEach(collect)));
    }));

    const mathCache = new Map<string, MathImage>();
    for (const seg of segments) {
      const img = await renderMathToImage(seg);
      if (img) mathCache.set(seg, img);
    }

    /**
     * Mixed text + equations. Plain stretches become TextRuns, each $...$
     * becomes the pre-rendered PNG, and anything that failed to rasterise
     * falls back to the old unicode approximation rather than vanishing.
     */
    const renderRich = (text: string, options: any = {}) => {
      const runs: any[] = [];

      // IMPORTANT: split on maths FIRST, then handle newlines inside the plain
      // stretches. Splitting by line first (as this used to) breaks any
      // $$...$$ block that spans several lines - no single line then contains
      // a matching pair, so the whole equation leaked into Word as raw LaTeX.
      (text || '').split(MATH_SPLIT).forEach(part => {
        if (!part) return;

        if (isMathSegment(part)) {
          const img = mathCache.get(part);
          const block = IS_BLOCK_MATH.test(part);
          if (block) runs.push(new TextRun({ break: 1 }));
          if (img) {
            runs.push(new ImageRun({
              data: img.data,
              transformation: { width: img.width, height: img.height },
              type: 'png',
            }));
          } else {
            runs.push(new TextRun({ text: formatMathForWord(part), ...options }));
          }
          if (block) runs.push(new TextRun({ break: 1 }));
          return;
        }

        const lines = part.split('\n');
        lines.forEach((line, i) => {
          if (line) runs.push(new TextRun({ text: line, ...options }));
          if (i < lines.length - 1) runs.push(new TextRun({ break: 1 }));
        });
      });

      return runs.length ? runs : [new TextRun({ text: '', ...options })];
    };

    const buildHeaderChildren = () => [
      // Logo — always the first element at the top of the paper
      new Paragraph({
        children: [
          examData.logoUrl ? new ImageRun({
            data: examData.logoUrl.split(',')[1],
            transformation: { width: 110, height: 110 },
            type: 'png',
          }) : new TextRun({ text: "", size: 2 }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
      }),

      // Optional institution name line.
      // The "Srinivasa Ramanujan Centre, Kumbakonam" line has been removed; the
      // paragraph below is emitted ONLY if a name is typed in Basic Exam Details.
      ...(examData.collegeName && examData.collegeName.trim()
        ? [new Paragraph({
            children: [
              new TextRun({
                text: examData.collegeName.toUpperCase(),
                bold: true,
                size: 24,
                font: "Times New Roman",
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 100, after: 200 },
          })]
        : []),

      // Exam Details Table
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        // invisible grid; only the rule beneath the header block is drawn,
        // matching the single black line in the PDF
        borders: { ...INVISIBLE_TABLE, bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" } },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: INVISIBLE_CELL,
                margins: TIGHT_MARGINS,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: "Month and Year: ", bold: true, size: 20, font: "Times New Roman" }),
                      new TextRun({ text: formatDate(examData.date, examData.month, examData.year), bold: true, size: 20, font: "Times New Roman" }),
                    ],
                    spacing: { before: 40, after: 40 },
                  }),
                ],
              }),
              new TableCell({
                borders: INVISIBLE_CELL,
                margins: TIGHT_MARGINS,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: "Time: ", bold: true, size: 20, font: "Times New Roman" }),
                      new TextRun({ text: examData.duration, bold: true, size: 20, font: "Times New Roman" }),
                    ],
                    alignment: AlignmentType.RIGHT,
                    spacing: { before: 40, after: 40 },
                  }),
                ],
              }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({
                borders: INVISIBLE_CELL,
                margins: TIGHT_MARGINS,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: "CIA Test: ", bold: true, size: 20, font: "Times New Roman" }),
                      new TextRun({ text: examData.examTitle, bold: true, size: 20, font: "Times New Roman" }),
                    ],
                    spacing: { before: 40, after: 40 },
                  }),
                ],
              }),
              new TableCell({
                borders: INVISIBLE_CELL,
                margins: TIGHT_MARGINS,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: "Max Marks: ", bold: true, size: 20, font: "Times New Roman" }),
                      new TextRun({ text: examData.maxMarks, bold: true, size: 20, font: "Times New Roman" }),
                    ],
                    alignment: AlignmentType.RIGHT,
                    spacing: { before: 40, after: 40 },
                  }),
                ],
              }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({
                columnSpan: 2,
                borders: INVISIBLE_CELL,
                margins: TIGHT_MARGINS,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: "Programme: ", bold: true, size: 20, font: "Times New Roman" }),
                      new TextRun({ text: examData.program, bold: true, size: 20, font: "Times New Roman" }),
                    ],
                    spacing: { before: 40, after: 40 },
                  }),
                ],
              }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({
                borders: INVISIBLE_CELL,
                margins: TIGHT_MARGINS,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: "Course Name: ", bold: true, size: 20, font: "Times New Roman" }),
                      new TextRun({ text: examData.courseName, bold: true, size: 20, font: "Times New Roman" }),
                    ],
                    spacing: { before: 40, after: 40 },
                  }),
                ],
              }),
              new TableCell({
                borders: INVISIBLE_CELL,
                margins: TIGHT_MARGINS,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: "Course Code: ", bold: true, size: 20, font: "Times New Roman" }),
                      new TextRun({ text: examData.courseCode, bold: true, size: 20, font: "Times New Roman" }),
                    ],
                    alignment: AlignmentType.RIGHT,
                    spacing: { before: 40, after: 40 },
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      new Paragraph({ spacing: { before: 200 } }),
    ];

    /*
      Word blocks, keyed IDENTICALLY to previewBlocks so the pagination worked
      out on screen can be reused verbatim for the .docx. Each entry rebuilds
      its elements on demand, because a docx element (an ImageRun especially)
      cannot appear twice in one document tree - and every block is emitted
      twice per sheet, once in each half.
    */
    const buildDocxBlocks = (): Array<{ key: string; build: () => any[] }> => {
      const blocks: Array<{ key: string; build: () => any[] }> = [];
      blocks.push({ key: 'exam-header', build: () => buildHeaderChildren() });

      let globalQuestionNumber = 0;
      examData.parts.forEach(part => {
        blocks.push({
          key: `${part.id}::head`,
          build: () => [
            new Paragraph({
              children: [
                new TextRun({
                  text: part.name.toUpperCase(),
                  bold: false,
                  size: 24,
                  font: "Times New Roman",
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { before: 200, after: 50 },
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: INVISIBLE_TABLE,
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      borders: INVISIBLE_CELL,
                      margins: TIGHT_MARGINS,
                      children: [new Paragraph({ children: [new TextRun({ text: part.instructions || "Answer all the questions", bold: true, size: 20, font: "Times New Roman" })] })],
                    }),
                    new TableCell({
                      borders: INVISIBLE_CELL,
                      margins: TIGHT_MARGINS,
                      children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${part.questionsToAnswer ?? part.questionCount} x ${part.marksPerQuestion} = ${part.totalMarks} marks`, bold: true, size: 20, font: "Times New Roman" })] })],
                    }),
                  ],
                }),
              ],
            }),
          ],
        });

        part.questions.forEach(q => {
          if (!q.isOr) globalQuestionNumber++;
          const numberForThisQuestion = globalQuestionNumber;
          blocks.push({
            key: q.id,
            build: () => {
              // Already resolved by the outer loop - do NOT advance it again,
              // or every question prints one number too high.
              const globalQuestionNumber = numberForThisQuestion;

          const questionElements: any[] = [];

          if (q.isOr) {
            questionElements.push(
              new Paragraph({
                children: [new TextRun({ text: "(OR)", bold: true, size: 20, font: "Times New Roman" })],
                alignment: AlignmentType.CENTER,
                spacing: { before: 100, after: 100 },
              })
            );
          }

          questionElements.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${globalQuestionNumber}. `, bold: false, size: 20, font: "Times New Roman" }),
                ...renderRich(q.text || "", { size: 20, font: "Times New Roman" }),
              ],
              spacing: { before: 100, after: 50 },
            })
          );

          // Add Images if exist
          if (q.images && q.images.length > 0) {
            q.images.forEach(imgUrl => {
              try {
                const base64Data = imgUrl.split(',')[1];
                questionElements.push(
                  new Paragraph({
                    children: [
                      new ImageRun({
                        data: base64Data,
                        transformation: {
                          width: 250,
                          height: 180,
                        },
                        type: 'png',
                      }),
                    ],
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 100, after: 100 },
                  })
                );
              } catch (e) {
                console.error("Error adding image to Word:", e);
              }
            });
          }

          // Add Tables if exist
          if (q.tables && q.tables.length > 0) {
            q.tables.forEach(table => {
              questionElements.push(
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  // a real data table - the PDF shows a black grid, so draw one
                  borders: DATA_TABLE_BORDERS,
                  rows: table.rows.map(row =>
                    new TableRow({
                      children: row.map(cell =>
                        new TableCell({
                          borders: DATA_CELL_BORDERS,
                          children: [new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: renderRich(cell, { size: 18, font: "Times New Roman" }),
                          })],
                        })
                      ),
                    })
                  ),
                })
              );
            });
          }

          // Sub-questions
          q.subQuestions.forEach((sq, sqIdx) => {
            questionElements.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `   (${String.fromCharCode(97 + sqIdx)}) `, italics: true, size: 20, font: "Times New Roman" }),
                  ...renderRich(sq.text || "", { size: 20, font: "Times New Roman" }),
                  ...(sq.marks ? [new TextRun({ text: ` [${sq.marks}]`, bold: true, size: 20, font: "Times New Roman" })] : []),
                ],
                spacing: { before: 100, after: 50 },
              })
            );
          });
              return questionElements;
            },
          });
        });
      });

      return blocks;
    };

    /*
      WORD ASSEMBLY
      -------------
      Word has a real two-column flow of its own, and it fragments content the
      same way the preview does: a question that does not fit finishes at the
      top of the next column, and columns run on to the next page. So for a
      multi-column paper we simply hand Word every block in order and let its
      column engine do the work - no manual pagination, and nothing to drift
      out of step with the screen.

      The single-column case is the exception: there the one page has to appear
      TWICE side by side, which a flow cannot express, so it uses a borderless
      two-cell table with the content rebuilt in each cell.
    */
    const docxBlocks = buildDocxBlocks();
    const singleColumn = columnCount === 1;

    const halfWidth = Math.round((A4_LANDSCAPE_TWIPS.width
      - mmToTwips(PAGE.padLeft) - mmToTwips(PAGE.padRight) - mmToTwips(PAGE.gap)) / 2);

    /* Word gets the same one-sheet model: a duplicated single column via the
       two-cell table, or a two-column flow. Word paginates on its own if the
       content genuinely exceeds one sheet - the preview warns when that is
       about to happen. */
    const flowChildren = () => docxBlocks.flatMap(b => b.build());

    const sectionChildren = singleColumn
      ? [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: INVISIBLE_TABLE,
            columnWidths: [halfWidth, halfWidth],
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: halfWidth, type: WidthType.DXA },
                    borders: INVISIBLE_CELL,
                    margins: { ...TIGHT_MARGINS, right: mmToTwips(PAGE.gap / 2) },
                    children: flowChildren(),
                  }),
                  new TableCell({
                    width: { size: halfWidth, type: WidthType.DXA },
                    borders: INVISIBLE_CELL,
                    margins: { ...TIGHT_MARGINS, left: mmToTwips(PAGE.gap / 2) },
                    // rebuilt, never reused - a docx element cannot appear twice
                    children: flowChildren(),
                  }),
                ],
              }),
            ],
          }),
        ]
      : flowChildren();

    const doc = new Document({
      /*
        Document-wide defaults so Word does not fall back to Calibri / 1.15
        line spacing / paragraph spacing, all of which made the .docx drift
        from the PDF even when the text itself was identical.
      */
      styles: {
        default: {
          document: {
            run: { font: "Times New Roman", size: 20 },
            paragraph: { spacing: { line: 240, lineRule: "auto", before: 0, after: 0 } },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: {
                orientation: PageOrientation.LANDSCAPE,
                width: A4_LANDSCAPE_TWIPS.width,    // 297mm
                height: A4_LANDSCAPE_TWIPS.height,  // 210mm
              },
              margin: {
                top: mmToTwips(PAGE.padTop),
                bottom: mmToTwips(PAGE.padBottom),
                left: mmToTwips(PAGE.padLeft),
                right: mmToTwips(PAGE.padRight),
              },
            },
            /* Word's own column flow handles the fragmentation; the
               single-column case uses a table instead and needs one column. */
            ...(singleColumn ? {} : { column: { count: 2, space: mmToTwips(PAGE.gap) } }),
          },
          children: sectionChildren,
        }
      ],
    });

    const examNumber = examData.examTitle === 'First' ? '1' : 
                       examData.examTitle === 'Second' ? '2' : 
                       examData.examTitle === 'Third' ? '3' : '1';
    const fileName = `${examData.courseCode || 'CIA'}_Q_${examNumber}CIA.docx`;

    const blob = await Packer.toBlob(doc);
    saveAs(blob, fileName);
    } finally {
      setIsExporting(false);
    }
  };

  const resetExam = () => {
    if (confirm('Are you sure you want to reset? All progress will be lost.')) {
      // keep the logo — resetting the paper shouldn't wipe the institution mark
      setExamData(prev => ({ ...INITIAL_DATA, logoUrl: prev.logoUrl }));
      localStorage.removeItem('cia-exam-draft');
    }
  };

  const loadSample = () => {
    const sampleData: ExamData = {
      ...INITIAL_DATA,
      courseCode: 'CS302',
      courseName: 'Database Management Systems',
      collegeName: '',
      examTitle: 'First',
      duration: '3 Hours',
      maxMarks: '100 Marks',
      month: 'April',
      year: '2026',
      program: 'B.Tech. Computer Science & Engineering',
      parts: [
        {
          id: 'part-1',
          name: 'Part A',
          questionCount: 10,
          marksPerQuestion: 2,
          totalMarks: 20,
          questions: [
            { id: 'q1', text: 'Define Normalization in DBMS.', subQuestions: [], images: [], tables: [] },
            { id: 'q2', text: 'What is a Primary Key?', subQuestions: [], images: [], tables: [] },
            { id: 'q3', text: 'Explain the ACID properties with the formula $A+C+I+D=1$.', subQuestions: [], images: [], tables: [] },
            { id: 'q4', text: 'Solve the following equation: $$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$', subQuestions: [], images: [], tables: [] },
            { id: 'q5', text: 'Define Data Independence.', subQuestions: [], images: [], tables: [] },
            { id: 'q6', text: 'What is a Weak Entity Set?', subQuestions: [], images: [], tables: [] },
            { id: 'q7', text: 'List the DDL commands.', subQuestions: [], images: [], tables: [] },
            { id: 'q8', text: 'What is a Transaction?', subQuestions: [], images: [], tables: [] },
            { id: 'q9', text: 'Define B-Tree Indexing.', subQuestions: [], images: [], tables: [] },
            { id: 'q10', text: 'What is a View in SQL?', subQuestions: [], images: [], tables: [] },
          ]
        },
        {
          id: 'part-2',
          name: 'Part B',
          questionCount: 5,
          marksPerQuestion: 13,
          totalMarks: 65,
          questions: [
            { 
              id: 'q11', 
              text: 'Explain the different types of database users.', 
              subQuestions: [
                { id: 'sq1', text: 'Naive users', marks: 4 },
                { id: 'sq2', text: 'Application programmers', marks: 4 },
                { id: 'sq3', text: 'Database Administrators', marks: 5 }
              ],
              images: [],
              tables: []
            },
            { id: 'q12', text: 'Draw and explain the 3-schema architecture.', subQuestions: [], isOr: true, images: [], tables: [] },
            { id: 'q13', text: 'Explain the ER Model components with a neat diagram.', subQuestions: [], images: [], tables: [] },
            { id: 'q14', text: 'Discuss the various Relational Algebra operations.', subQuestions: [], isOr: true, images: [], tables: [] },
            { id: 'q15', text: 'Explain 1NF, 2NF and 3NF with suitable examples.', subQuestions: [], images: [], tables: [] },
          ]
        },
        {
          id: 'part-3',
          name: 'Part C',
          questionCount: 1,
          marksPerQuestion: 15,
          totalMarks: 15,
          questions: [
            { 
              id: 'q16', 
              text: 'Case Study: Design a University Database System. Identify entities, attributes and relationships. Draw the complete ER diagram.', 
              subQuestions: [],
              images: [],
              tables: []
            }
          ]
        }
      ]
    };
    setExamData(sampleData);
    setExpandedPart('part-1');
  };

  return (
    <VoiceProvider>
    {/*
      Print rules live here so the whole change stays in App.tsx.
      "@page { margin: 0 }" is what suppresses the browser's own header and
      footer (page title, URL, date, page numbers) - those are drawn INTO the
      page margin, so removing the margin removes them. The paper already
      carries its own internal padding, so nothing is clipped.
    */}
    <style>{`
      /*
        Fragmentation rules for the flowed content. Questions MAY break across
        a column or sheet boundary - that is what keeps columns full - but the
        exam header must never be torn in half, and a part heading must not be
        stranded at the foot of a column away from its questions.
      */
      .exam-flow .exam-header-block { break-inside: avoid; page-break-inside: avoid; }
      .exam-flow .part-head-block {
        break-inside: avoid; page-break-inside: avoid;
        break-after: avoid;  page-break-after: avoid;
      }
      .exam-flow table, .exam-flow img { break-inside: avoid; page-break-inside: avoid; }

      @media print {
        /*
          "size: A4 landscape" is more reliable than explicit millimetres -
          the browser matches its own A4 definition exactly, so there is no
          rounding gap that pushes a blank page out. margin:0 removes the
          browser's header/footer, which are drawn INTO the page margin.
        */
        @page { size: A4 landscape; margin: 0; }

        html, body {
          width: auto !important;
          height: auto !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .no-print { display: none !important; }

        /* strip every layout constraint between the page and the sheet */
        #root, #root > div {
          background: #ffffff !important;
          margin: 0 !important;
          padding: 0 !important;
          width: auto !important;
          max-width: none !important;
          min-height: 0 !important;
        }
        main {
          max-width: none !important;
          width: auto !important;
          padding: 0 !important;
          margin: 0 !important;
        }
        main .flex.flex-col.items-center {
          display: block !important;
          gap: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          width: auto !important;
        }

        /* the on-screen scaling shell must not affect paper */
        .sheet-scale {
          width: auto !important;
          height: auto !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        /*
          One sheet per printed side, at true size. Height is a hair under
          210mm: at exactly 210mm a sub-pixel rounding in the layout can tip
          the sheet onto a second, blank page.
        */
        .print-page {
          box-sizing: border-box !important;
          width: 297mm !important;
          height: 209.7mm !important;
          margin: 0 !important;
          box-shadow: none !important;
          overflow: hidden !important;
          transform: none !important;
          break-after: page;
          page-break-after: always;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .print-page:last-child { break-after: auto; page-break-after: auto; }
      }
    `}</style>
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              {examData.logoUrl ? (
                <img
                  src={examData.logoUrl}
                  alt="Logo"
                  className="w-10 h-10 object-contain rounded-lg bg-white"
                />
              ) : (
                <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
                  <FileText size={24} />
                </div>
              )}
              <h1 className="text-xl font-bold text-slate-900 hidden sm:block">CIA Exam Gen</h1>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex bg-slate-100 p-1 rounded-lg">
                <button
                  onClick={() => setActiveTab('edit')}
                  className={cn(
                    "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                    activeTab === 'edit' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  <Edit3 size={16} />
                  <span className="hidden sm:inline">Edit</span>
                </button>
                <button
                  onClick={() => setActiveTab('preview')}
                  className={cn(
                    "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                    activeTab === 'preview' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  <Eye size={16} />
                  <span className="hidden sm:inline">Preview</span>
                </button>
                <button
                  onClick={() => setActiveTab('rbt')}
                  className={cn(
                    "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                    activeTab === 'rbt' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  <Table2 size={16} />
                  <span className="hidden sm:inline">RBT</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className={cn(
        "mx-auto px-4 sm:px-6 lg:px-8 py-8",
        activeTab === 'preview' || activeTab === 'rbt' ? "max-w-[1300px]" : "max-w-5xl"
      )}>
        {activeTab === 'rbt' ? (
          <RbtTab examData={examData} setExamData={setExamData} formatDate={formatDate} />
        ) : activeTab === 'edit' ? (
          <div className="space-y-8">
            {/* Voice typing controls (language + maths mode + cheat sheet) */}
            <VoiceSettingsBar />

            {/* Basic Details Section */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <FileText className="text-indigo-600" size={20} />
                  Basic Exam Details
                </h2>
              </div>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Institution name line <span className="normal-case font-normal text-slate-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      name="collegeName"
                      value={examData.collegeName || ''}
                      onChange={handleBasicDetailsChange}
                      placeholder="Leave blank — header shows the logo only"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-base"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      Blank by default. Anything typed here appears as a text line under the logo.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Course Code</label>
                      <input
                        type="text"
                        name="courseCode"
                        value={examData.courseCode || ''}
                        onChange={handleBasicDetailsChange}
                        placeholder="CS101"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-base"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Course Name</label>
                      <input
                        type="text"
                        name="courseName"
                        value={examData.courseName || ''}
                        onChange={handleBasicDetailsChange}
                        placeholder="Data Structures"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-base"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Select Program (Select multiple for common papers)</label>
                      <div className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl h-48 overflow-y-auto space-y-1">
                        {PROGRAMS.map(prog => {
                          const isSelected = (examData.program || '').split(' / ').includes(prog);
                          return (
                            <label key={prog} className="flex items-center gap-3 p-2 hover:bg-indigo-50 rounded-lg cursor-pointer transition-colors">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleProgram(prog)}
                                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              <span className={cn("text-sm", isSelected ? "font-semibold text-indigo-700" : "text-slate-600")}>
                                {prog}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Semester</label>
                      <input
                        type="text"
                        name="semester"
                        value={examData.semester || ''}
                        onChange={handleBasicDetailsChange}
                        placeholder="IV"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-base"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Exam Title</label>
                      <select
                        name="examTitle"
                        value={examData.examTitle || ''}
                        onChange={handleBasicDetailsChange}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-base"
                      >
                        {EXAM_TITLES.map(title => (
                          <option key={title} value={title}>{title}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Duration</label>
                      <input
                        type="text"
                        name="duration"
                        value={examData.duration}
                        onChange={handleBasicDetailsChange}
                        placeholder="2 Hours"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-base"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Max Marks</label>
                      <input
                        type="text"
                        name="maxMarks"
                        value={examData.maxMarks}
                        onChange={handleBasicDetailsChange}
                        placeholder="50"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-base"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Month</label>
                      <select
                        name="month"
                        value={examData.month || ''}
                        onChange={handleBasicDetailsChange}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-base"
                      >
                        {MONTHS.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Year</label>
                      <select
                        name="year"
                        value={examData.year || ''}
                        onChange={handleBasicDetailsChange}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-base"
                      >
                        {YEARS.map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Header logo (top of the paper)
                    </label>
                    <div className="flex items-center gap-4">
                      {examData.logoUrl ? (
                        <div className="relative group">
                          <img src={examData.logoUrl} alt="Logo" className="w-16 h-16 object-contain border border-slate-200 rounded-lg bg-white p-1" />
                          <button
                            onClick={() => setExamData(prev => ({ ...prev, logoUrl: null }))}
                            title="Remove logo"
                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center w-16 h-16 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-indigo-500 hover:bg-indigo-50 transition-all">
                          <ImageIcon size={20} className="text-slate-400" />
                          <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                        </label>
                      )}
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap gap-2">
                          <label className="cursor-pointer px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 uppercase tracking-wider hover:bg-slate-50 transition-all">
                            {examData.logoUrl ? 'Replace' : 'Upload'} logo
                            <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                          </label>
                          <button
                            type="button"
                            onClick={useBundledLogo}
                            className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 uppercase tracking-wider hover:bg-slate-50 transition-all"
                          >
                            Use default
                          </button>
                        </div>
                        <p className="text-xs text-slate-400">
                          Loads automatically from <code className="font-mono">public/logo.png</code>. PNG or JPG.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Exam Parts Section */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold text-slate-800">Exam Structure & Questions</h2>
                <button
                  onClick={addPart}
                  className="text-indigo-600 hover:text-indigo-700 font-medium text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-all"
                >
                  <Plus size={18} />
                  Add New Part
                </button>
              </div>

              <div className="space-y-4">
                {examData.parts.map((part, partIndex) => (
                  <div key={part.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div 
                      className={cn(
                        "p-4 flex items-center justify-between cursor-pointer transition-colors",
                        expandedPart === part.id ? "bg-indigo-50/30" : "hover:bg-slate-50"
                      )}
                      onClick={() => setExpandedPart(expandedPart === part.id ? null : part.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
                          {part.name.split(' ').pop()}
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-800">{part.name}</h3>
                          <p className="text-xs text-slate-500">
                            {part.questionCount} Questions • {part.marksPerQuestion} Marks each • Total: {part.totalMarks}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <button 
                          onClick={() => duplicatePart(part)}
                          className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
                          title="Duplicate Part"
                        >
                          <Copy size={18} />
                        </button>
                        <button 
                          onClick={() => deletePart(part.id)}
                          className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete Part"
                        >
                          <Trash2 size={18} />
                        </button>
                        <div className="ml-2 text-slate-400">
                          {expandedPart === part.id ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                        </div>
                      </div>
                    </div>

                    <AnimatePresence>
                      {expandedPart === part.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <div className="p-6 border-t border-slate-100 space-y-6">
                            {/* Part Settings */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                              <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Part Name</label>
                                <input
                                  type="text"
                                  value={part.name || ''}
                                  onChange={(e) => updatePart(part.id, { name: e.target.value })}
                                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Instructions</label>
                                <input
                                  type="text"
                                  value={part.instructions || ''}
                                  onChange={(e) => updatePart(part.id, { instructions: e.target.value })}
                                  placeholder="Answer all the questions"
                                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Total Questions</label>
                                <input
                                  type="number"
                                  min="1"
                                  max="50"
                                  value={part.questionCount || 0}
                                  onChange={(e) => updatePart(part.id, { questionCount: parseInt(e.target.value) || 0 })}
                                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-base focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">To Answer</label>
                                <input
                                  type="number"
                                  min="1"
                                  max={part.questionCount}
                                  value={part.questionsToAnswer ?? part.questionCount}
                                  onChange={(e) => updatePart(part.id, { questionsToAnswer: parseInt(e.target.value) || 0 })}
                                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-base focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Marks per Question</label>
                                <input
                                  type="number"
                                  min="1"
                                  value={part.marksPerQuestion || 0}
                                  onChange={(e) => updatePart(part.id, { marksPerQuestion: parseInt(e.target.value) || 0 })}
                                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-base focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                />
                              </div>
                            </div>

                            {/* Questions List */}
                            <div className="space-y-4">
                              {part.questions.map((q, qIdx) => (
                                <div key={q.id} className="group space-y-3 p-4 border border-slate-100 rounded-xl hover:border-indigo-100 hover:bg-indigo-50/10 transition-all">
                                  <div className="flex gap-4">
                      <span className="text-slate-400 font-mono text-sm mt-2.5 w-6">
                        {(() => {
                          let count = 0;
                          for (const p of examData.parts) {
                            if (p.id === part.id) {
                              // Within current part, find index of q
                              const qIdx = p.questions.findIndex(qd => qd.id === q.id);
                              // Count previous non-OR questions in THIS part
                              for (let i = 0; i <= qIdx; i++) {
                                if (!p.questions[i].isOr) count++;
                              }
                              return count;
                            }
                            // Count non-OR questions in PREVIOUS parts
                            for (const qp of p.questions) {
                              if (!qp.isOr) count++;
                            }
                          }
                          return 1;
                        })()}.
                      </span>
                                    <div className="flex-1 space-y-3">
                                      <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1 space-y-3">
                                          <VoiceTextArea
                                            value={q.text || ''}
                                            onChange={(text) => updateQuestion(part.id, q.id, { text })}
                                            placeholder={`Enter or dictate question ${qIdx + 1}...`}
                                            rows={2}
                                          />
                                          
                                          {/* Question Media/Table Controls */}
                                          <div className="flex flex-wrap items-center gap-3">
                                            <label className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-500 uppercase tracking-wider hover:bg-slate-50 transition-all">
                                              <ImageIcon size={14} className="text-indigo-500" />
                                              Add Diagram
                                              <input 
                                                type="file" 
                                                accept="image/*" 
                                                className="hidden" 
                                                onChange={(e) => {
                                                  const file = e.target.files?.[0];
                                                  if (file) {
                                                    const reader = new FileReader();
                                                    reader.onloadend = () => {
                                                      const newImages = [...(q.images || []), reader.result as string];
                                                      updateQuestion(part.id, q.id, { images: newImages });
                                                    };
                                                    reader.readAsDataURL(file);
                                                  }
                                                }}
                                              />
                                            </label>

                                            <button
                                              onClick={() => {
                                                const newTables = [...(q.tables || []), { 
                                                  rows: [['Cell 1', 'Cell 2'], ['Cell 3', 'Cell 4']],
                                                  hasHeader: true 
                                                }];
                                                updateQuestion(part.id, q.id, { tables: newTables });
                                              }}
                                              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-500 uppercase tracking-wider hover:bg-slate-50 transition-all"
                                            >
                                              <Plus size={14} className="text-emerald-500" />
                                              Add Table
                                            </button>

                                            <button
                                              onClick={() => {
                                                const matrixExample = "$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$";
                                                updateQuestion(part.id, q.id, { text: (q.text || "") + "\n" + matrixExample });
                                              }}
                                              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-500 uppercase tracking-wider hover:bg-slate-50 transition-all"
                                              title="Add Matrix Template"
                                            >
                                              <Edit3 size={14} className="text-orange-500" />
                                              Add Matrix
                                            </button>
                                          </div>

                                          {/* Table Editor */}
                                          {q.tables && q.tables.length > 0 && (
                                            <div className="space-y-4">
                                              {q.tables.map((table, tIdx) => (
                                                <div key={tIdx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-3 relative group/table">
                                                  <button 
                                                    onClick={() => {
                                                      const newTables = q.tables.filter((_, i) => i !== tIdx);
                                                      updateQuestion(part.id, q.id, { tables: newTables });
                                                    }}
                                                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover/table:opacity-100 transition-opacity z-10"
                                                  >
                                                    <Trash2 size={12} />
                                                  </button>
                                                  <div className="flex items-center justify-between">
                                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Table {tIdx + 1} Editor</span>
                                                    <div className="flex gap-2">
                                                      <button 
                                                        onClick={() => {
                                                          const newRows = [...table.rows, new Array(table.rows[0].length).fill('')];
                                                          const newTables = [...q.tables];
                                                          newTables[tIdx] = { ...table, rows: newRows };
                                                          updateQuestion(part.id, q.id, { tables: newTables });
                                                        }}
                                                        className="px-2 py-1 bg-white border border-slate-200 rounded text-[10px] font-bold text-indigo-600"
                                                      >
                                                        + Row
                                                      </button>
                                                      <button 
                                                        onClick={() => {
                                                          const newRows = table.rows.map(row => [...row, '']);
                                                          const newTables = [...q.tables];
                                                          newTables[tIdx] = { ...table, rows: newRows };
                                                          updateQuestion(part.id, q.id, { tables: newTables });
                                                        }}
                                                        className="px-2 py-1 bg-white border border-slate-200 rounded text-[10px] font-bold text-indigo-600"
                                                      >
                                                        + Col
                                                      </button>
                                                    </div>
                                                  </div>
                                                  <div className="overflow-x-auto">
                                                    <table className="w-full border-collapse">
                                                      <tbody>
                                                        {table.rows.map((row, rIdx) => (
                                                          <tr key={rIdx}>
                                                            {row.map((cell, cIdx) => (
                                                              <td key={cIdx} className="border border-slate-200 p-1">
                                                                <input 
                                                                  type="text"
                                                                  value={cell}
                                                                  onChange={(e) => {
                                                                    const newRows = [...table.rows];
                                                                    newRows[rIdx][cIdx] = e.target.value;
                                                                    const newTables = [...q.tables];
                                                                    newTables[tIdx] = { ...table, rows: newRows };
                                                                    updateQuestion(part.id, q.id, { tables: newTables });
                                                                  }}
                                                                  className="w-full bg-transparent text-sm outline-none"
                                                                />
                                                              </td>
                                                            ))}
                                                          </tr>
                                                        ))}
                                                      </tbody>
                                                    </table>
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          )}

                                          {/* Image Preview in Editor */}
                                          {q.images && q.images.length > 0 && (
                                            <div className="flex flex-wrap gap-3">
                                              {q.images.map((img, imgIdx) => (
                                                <div key={imgIdx} className="relative w-32 h-32 border border-slate-200 rounded-xl overflow-hidden group/img">
                                                  <img src={img} alt={`Diagram ${imgIdx + 1}`} className="w-full h-full object-cover" />
                                                  <button 
                                                    onClick={() => {
                                                      const newImages = q.images.filter((_, i) => i !== imgIdx);
                                                      updateQuestion(part.id, q.id, { images: newImages });
                                                    }}
                                                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover/img:opacity-100 transition-opacity"
                                                  >
                                                    <Trash2 size={12} />
                                                  </button>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                        <div className="ml-4 flex flex-col items-center gap-2">
                                          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">OR Option</label>
                                          <button
                                            onClick={() => {
                                              const updatedParts = examData.parts.map(p => {
                                                if (p.id === part.id) {
                                                  return {
                                                    ...p,
                                                    questions: p.questions.map(quest => 
                                                      quest.id === q.id ? { ...quest, isOr: !quest.isOr } : quest
                                                    )
                                                  };
                                                }
                                                return p;
                                              });
                                              setExamData({ ...examData, parts: updatedParts });
                                            }}
                                            className={cn(
                                              "w-10 h-6 rounded-full transition-all relative",
                                              q.isOr ? "bg-indigo-600" : "bg-slate-200"
                                            )}
                                          >
                                            <div className={cn(
                                              "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                                              q.isOr ? "left-5" : "left-1"
                                            )} />
                                          </button>
                                        </div>
                                      </div>
                                      
                                      {/* Sub-questions */}
                                      <div className="pl-4 space-y-2">
                                        {q.subQuestions.map((sq, sqIdx) => (
                                          <div key={sq.id} className="flex gap-2 items-center">
                                            <span className="text-sm text-slate-400 font-medium w-6">({String.fromCharCode(97 + sqIdx)})</span>
                                            <VoiceField
                                              value={sq.text || ''}
                                              onChange={(text) => updateSubQuestion(part.id, q.id, sq.id, { text })}
                                              placeholder="Sub-question text — type or dictate..."
                                            />
                                            <div className="flex items-center gap-1">
                                              <label className="text-xs font-bold text-slate-400 uppercase">Marks</label>
                                              <input
                                                type="number"
                                                value={sq.marks || ''}
                                                onChange={(e) => updateSubQuestion(part.id, q.id, sq.id, { marks: parseInt(e.target.value) || undefined })}
                                                className="w-12 px-2 py-1 bg-white border border-slate-200 rounded text-sm outline-none"
                                                placeholder="Opt"
                                              />
                                            </div>
                                            <button 
                                              onClick={() => deleteSubQuestion(part.id, q.id, sq.id)}
                                              className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          </div>
                                        ))}
                                        <button
                                          onClick={() => addSubQuestion(part.id, q.id)}
                                          className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 uppercase tracking-widest flex items-center gap-1"
                                        >
                                          <Plus size={12} />
                                          Add Sub-question
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-center items-center gap-4 pt-8">
              <button
                onClick={loadSample}
                className="text-indigo-600 hover:text-indigo-700 text-sm font-medium flex items-center gap-2 transition-colors px-4 py-2 rounded-lg hover:bg-indigo-50"
              >
                <FileText size={16} />
                Load Sample Template
              </button>
              <button
                onClick={resetExam}
                className="text-slate-400 hover:text-red-500 text-sm font-medium flex items-center gap-2 transition-colors px-4 py-2 rounded-lg hover:bg-red-50"
              >
                <Trash2 size={16} />
                Reset All Data
              </button>
            </div>
          </div>
        ) : (
          /* Preview Mode */
          <div className="flex flex-col items-center space-y-8">
            {/* Hidden measurer: one column wide with a fixed column height, so
                surplus content spills into overflow columns to the right and
                scrollWidth reveals how many columns the paper really needs. */}
            <div
              ref={measureRef}
              aria-hidden="true"
              className="font-serif text-slate-900 no-print exam-flow"
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
              {previewBlocks.map((b) => (
                <div key={b.key}>{b.node}</div>
              ))}
            </div>

            <div ref={previewAreaRef} className="w-full" />
            <div ref={previewRef} className="flex flex-col items-center gap-8 w-full">
              {Array.from({ length: sheetCount }, (_, sheetIndex) => {
                /*
                  Every sheet renders the SAME flow and shows a two-column
                  window onto it, shifted along by one sheet's worth of
                  columns. The browser fragments the content once, so a
                  question that breaks does so in the same place on screen
                  and on paper.
                */
                const windowW = isDuplicated ? COL_W : 2 * COL_W + PAGE.gap;
                const flowW = Math.max(1, columnCount) * COL_W + Math.max(0, columnCount - 1) * PAGE.gap;
                const offset = isDuplicated ? 0 : sheetIndex * 2 * (COL_W + PAGE.gap);

                const flow = (shift: number) => (
                  <div
                    className="exam-flow font-serif text-slate-900"
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
                    {previewBlocks.map((b) => (
                      <div key={b.key}>{b.node}</div>
                    ))}
                  </div>
                );

                return (
                  <div key={sheetIndex} className="w-full flex flex-col items-center">
                    <div className="text-xs font-semibold text-slate-500 mb-2 no-print">
                      {isDuplicated
                        ? 'Fits one column — both halves identical; print, then cut for 2 papers'
                        : `Sheet ${sheetIndex + 1} of ${sheetCount} — page ${sheetIndex * 2 + 1}${sheetIndex * 2 + 2 <= columnCount ? ` and page ${sheetIndex * 2 + 2}` : ''}`}
                    </div>

                    {/* Scaling shell: shrinks the sheet to fit the screen but
                        reserves the scaled height so sheets do not overlap.
                        Print rules reset both, so paper output is always 1:1. */}
                    <div
                      className="sheet-scale"
                      style={{
                        width: mm(PAGE.width * previewScale),
                        height: mm(PAGE.height * previewScale),
                      }}
                    >
                    <div
                      className="print-page bg-white exam-paper-shadow font-serif text-slate-900 relative"
                      style={{
                        width: mm(PAGE.width),
                        height: mm(PAGE.height),
                        paddingTop: mm(PAGE.padTop),
                        paddingBottom: mm(PAGE.padBottom),
                        paddingLeft: mm(PAGE.padLeft),
                        paddingRight: mm(PAGE.padRight),
                        transform: `scale(${previewScale})`,
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
                              {flow(0)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div
                          className="relative overflow-hidden"
                          style={{ width: mm(windowW), height: mm(USABLE_H) }}
                        >
                          {flow(offset)}
                        </div>
                      )}
                    </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Printing instructions */}
            <div className="no-print bg-indigo-50/70 border border-indigo-100 rounded-xl px-5 py-4 text-sm text-slate-700 max-w-[297mm] w-full">
              <p className="font-semibold text-indigo-900 mb-1">
                {isDuplicated
                  ? 'One sheet, both halves identical — print, cut down the middle, get 2 papers'
                  : `${columnCount} pages across ${sheetCount} sheet${sheetCount > 1 ? 's' : ''}`}
              </p>
              <ul className="list-disc pl-5 space-y-0.5 text-xs text-slate-600">
                <li>Paper <b>A4</b>, orientation <b>Landscape</b>, margins <b>None</b>, scale <b>100%</b> (not “Fit to page”).</li>
                {isDuplicated ? (
                  <li>Cut once along the centre line; each half is a complete paper.</li>
                ) : (
                  <>
                    <li>Questions run down the left column, then the right, then on to the next sheet. Do <b>not</b> cut.</li>
                    <li>Columns fill completely — a long question continues at the top of the next column instead of leaving a gap.</li>
                    <li>The exam header appears on page 1 only.</li>
                    {sheetCount > 1 && (
                      <li>Print <b>double-sided</b> to halve the paper used; page order is preserved either way.</li>
                    )}
                  </>
                )}
              </ul>
            </div>

            <div className="flex gap-4 no-print">
              <button
                onClick={() => window.print()}
                className="bg-white border border-slate-200 text-slate-700 px-6 py-3 rounded-xl font-semibold flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm"
              >
                <Printer size={20} />
                Print Paper
              </button>
              <button
                onClick={exportWord}
                disabled={isExporting}
                className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-semibold flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-md flex-1 md:flex-initial justify-center disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <FileText size={20} />
                {isExporting ? 'Rendering equations...' : 'Download Word Format'}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Floating Success Indicator */}
      <div className="fixed bottom-8 right-8 no-print">
        <div className="bg-white border border-slate-200 px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-xs font-medium text-slate-600">
          <CheckCircle2 size={14} className="text-emerald-500" />
          {savedAt
            ? `Draft saved ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'Draft saves automatically'}
        </div>
      </div>
    </div>
    </VoiceProvider>
  );
}
