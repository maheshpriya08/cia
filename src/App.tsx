import React, { useState, useEffect, useRef } from 'react';
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
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Superscript,
  Subscript,
  Undo2,
  Redo2,
  RefreshCw,
  Sigma
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
// @ts-ignore
import html2pdf from 'html2pdf.js';
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, VerticalAlign, ImageRun, SectionType, PageOrientation, ShadingType } from 'docx';
import { saveAs } from 'file-saver';
import { ExamData, ExamPart, Question, SubQuestion } from './types';
import { cn } from './utils';
import { MathText } from './components/MathText';
import defaultLogo from './assets/logo.png';

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
  collegeName: '',
  semester: '',
  program: PROGRAMS[0],
  logoUrl: defaultLogo,
  parts: [
    { id: 'part-a', name: 'Part A', instructions: 'Answer all the questions', questionCount: 5, questionsToAnswer: 5, marksPerQuestion: 2, totalMarks: 10, questions: Array.from({ length: 5 }, (_, i) => ({ id: `q-a-${i}`, text: '', subQuestions: [], images: [], tables: [] })) },
    { id: 'part-b', name: 'Part B', instructions: 'Answer all the questions', questionCount: 4, questionsToAnswer: 4, marksPerQuestion: 4, totalMarks: 16, questions: Array.from({ length: 4 }, (_, i) => ({ id: `q-b-${i}`, text: '', subQuestions: [], images: [], tables: [] })) },
    { id: 'part-c', name: 'Part C', instructions: 'Answer any 2 questions', questionCount: 3, questionsToAnswer: 2, marksPerQuestion: 12, totalMarks: 24, questions: Array.from({ length: 3 }, (_, i) => ({ id: `q-c-${i}`, text: '', subQuestions: [], images: [], tables: [] })) },
  ]
};

// Maps LaTeX-style commands to their literal symbol. Superscripts, subscripts,
// and fractions are handled separately (see buildMathRuns) so they get real
// Word superscript/subscript/fraction formatting instead of Unicode look-alikes.
const MATH_SYMBOL_MAP: Record<string, string> = {
  '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\epsilon': 'ε',
  '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ', '\\iota': 'ι', '\\kappa': 'κ',
  '\\lambda': 'λ', '\\mu': 'μ', '\\nu': 'ν', '\\xi': 'ξ', '\\pi': 'π',
  '\\rho': 'ρ', '\\sigma': 'σ', '\\tau': 'τ', '\\upsilon': 'υ', '\\phi': 'φ',
  '\\chi': 'χ', '\\psi': 'ψ', '\\omega': 'ω',
  '\\Delta': 'Δ', '\\Sigma': 'Σ', '\\Omega': 'Ω', '\\Theta': 'Θ', '\\Phi': 'Φ',
  '\\pm': '±', '\\sqrt': '√', '\\times': '×', '\\div': '÷', '\\neq': '≠',
  '\\leq': '≤', '\\geq': '≥', '\\infty': '∞', '\\approx': '≈',
  '\\rightarrow': '→', '\\leftarrow': '←', '\\Rightarrow': '⇒', '\\Leftarrow': '⇐',
  '\\to': '→',
  '\\forall': '∀', '\\exists': '∃', '\\in': '∈', '\\notin': '∉', '\\subset': '⊂',
  '\\supset': '⊃', '\\cup': '∪', '\\cap': '∩', '\\int': '∫', '\\partial': '∂',
  '\\sum': '∑', '\\prod': '∏', '\\lim': 'lim',
  '\\nabla': '∇', '\\angle': '∠', '\\perp': '⊥', '\\parallel': '∥',
  '\\cdot': '·', '\\dots': '...', '\\cdots': '...', '\\vdots': '⋮', '\\ddots': '⋱',
  '\\{': '{', '\\}': '}', '\\$': '$', '\\%': '%', '\\&': '&', '\\_': '_',
};

// Matches, in priority order: \frac{a}{b}, ^{...} / ^x, _{...} / _x,
// a backslash command (\alpha, \sum, etc.), an escaped literal (\%, \_, ...), or a bare $ delimiter.
const MATH_TOKEN_REGEX = /\\frac\{([^{}]*)\}\{([^{}]*)\}|\^\{([^{}]+)\}|\^([0-9A-Za-z+\-=()])|_\{([^{}]+)\}|_([0-9A-Za-z+\-=()])|(\\[a-zA-Z]+)|(\\[{}$%&_])|(\$)/g;

// Converts one line of question/answer text (which may contain simple LaTeX-style
// math) into an array of docx TextRuns, using real superscript/subscript/fraction
// formatting so equations line up correctly in Word, instead of Unicode substitutes.
const buildMathRuns = (line: string, baseOptions: any = {}): InstanceType<typeof TextRun>[] => {
  const runs: InstanceType<typeof TextRun>[] = [];
  if (!line) return runs;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MATH_TOKEN_REGEX.lastIndex = 0;

  const pushPlain = (str: string) => {
    if (str) runs.push(new TextRun({ text: str, ...baseOptions }));
  };

  while ((match = MATH_TOKEN_REGEX.exec(line)) !== null) {
    const [, fracNum, fracDen, supBrace, supChar, subBrace, subChar, cmd, escapedLiteral, dollar] = match;

    if (match.index > lastIndex) {
      pushPlain(line.slice(lastIndex, match.index));
    }

    if (fracNum !== undefined) {
      // Real stacked-looking fraction: superscript numerator / subscript denominator,
      // joined with a fraction slash, instead of plain "(num/den)" text.
      runs.push(new TextRun({ text: fracNum, ...baseOptions, superScript: true }));
      runs.push(new TextRun({ text: '⁄', ...baseOptions }));
      runs.push(new TextRun({ text: fracDen, ...baseOptions, subScript: true }));
    } else if (supBrace !== undefined || supChar !== undefined) {
      runs.push(new TextRun({ text: (supBrace ?? supChar) as string, ...baseOptions, superScript: true }));
    } else if (subBrace !== undefined || subChar !== undefined) {
      runs.push(new TextRun({ text: (subBrace ?? subChar) as string, ...baseOptions, subScript: true }));
    } else if (cmd !== undefined) {
      runs.push(new TextRun({ text: MATH_SYMBOL_MAP[cmd] ?? cmd.slice(1), ...baseOptions }));
    } else if (escapedLiteral !== undefined) {
      runs.push(new TextRun({ text: MATH_SYMBOL_MAP[escapedLiteral] ?? escapedLiteral.slice(1), ...baseOptions }));
    }
    // bare `$` delimiters are simply dropped

    lastIndex = MATH_TOKEN_REGEX.lastIndex;
  }

  if (lastIndex < line.length) {
    pushPlain(line.slice(lastIndex));
  }

  return runs;
};

const escapeHtml = (str: string): string =>
  (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Same token parser as buildMathRuns, but emits HTML (<sup>/<sub>) for use in the
// editable document view and for PDF export from that view.
const mathLineToHtml = (line: string): string => {
  if (!line) return '';
  let html = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MATH_TOKEN_REGEX.lastIndex = 0;

  while ((match = MATH_TOKEN_REGEX.exec(line)) !== null) {
    const [, fracNum, fracDen, supBrace, supChar, subBrace, subChar, cmd, escapedLiteral] = match;

    if (match.index > lastIndex) html += escapeHtml(line.slice(lastIndex, match.index));

    if (fracNum !== undefined) {
      html += `<sup>${escapeHtml(fracNum)}</sup>&frasl;<sub>${escapeHtml(fracDen)}</sub>`;
    } else if (supBrace !== undefined || supChar !== undefined) {
      html += `<sup>${escapeHtml((supBrace ?? supChar) as string)}</sup>`;
    } else if (subBrace !== undefined || subChar !== undefined) {
      html += `<sub>${escapeHtml((subBrace ?? subChar) as string)}</sub>`;
    } else if (cmd !== undefined) {
      html += escapeHtml(MATH_SYMBOL_MAP[cmd] ?? cmd.slice(1));
    } else if (escapedLiteral !== undefined) {
      html += escapeHtml(MATH_SYMBOL_MAP[escapedLiteral] ?? escapedLiteral.slice(1));
    }

    lastIndex = MATH_TOKEN_REGEX.lastIndex;
  }

  if (lastIndex < line.length) html += escapeHtml(line.slice(lastIndex));
  return html;
};

const mathTextToHtml = (text: string): string =>
  (text || '').split('\n').map(mathLineToHtml).join('<br>');

// Builds the initial editable-document HTML from the current exam data. This is a
// single-column layout (contentEditable + CSS multi-column doesn't reliably support
// cursor navigation across columns), used to seed the "Edit Document" tab.
const generateDocumentFromExam = (data: ExamData): string => {
  const headerHtml = `
    <div style="text-align:center;margin-bottom:16px;">
      <img src="${defaultLogo}" alt="Logo" style="height:70px;margin:0 auto 8px;display:block;" />
      <div style="font-weight:bold;text-transform:uppercase;font-size:15px;">${escapeHtml(data.collegeName || '')}</div>
      <div style="margin-top:8px;font-size:13px;font-weight:bold;text-align:left;max-width:520px;margin-left:auto;margin-right:auto;">
        <div style="display:flex;justify-content:space-between;"><span>Month and Year: ${escapeHtml(formatDate(data.date, data.month, data.year))}</span><span>Time: ${escapeHtml(data.duration)}</span></div>
        <div style="display:flex;justify-content:space-between;"><span>CIA Test: ${escapeHtml(data.examTitle)}</span><span>Max Marks: ${escapeHtml(data.maxMarks)}</span></div>
        <div>Programme: ${escapeHtml(data.program)}</div>
        <div style="display:flex;justify-content:space-between;"><span>Course Name: ${escapeHtml(data.courseName)}</span><span>Course Code: ${escapeHtml(data.courseCode)}</span></div>
      </div>
    </div>
    <hr style="border:none;border-top:2px solid #0f172a;margin-bottom:16px;" />
  `;

  let globalNum = 0;
  const partsHtml = data.parts.map(part => {
    const questionsHtml = part.questions.map(q => {
      if (!q.isOr) globalNum++;
      const orHtml = q.isOr ? `<div style="text-align:center;font-weight:bold;text-transform:uppercase;font-size:12px;margin:6px 0;">(OR)</div>` : '';

      const tablesHtml = (q.tables || []).map(table => `
        <table style="border-collapse:collapse;width:100%;margin:8px 0;font-size:13px;">
          <tbody>
            ${table.rows.map(row => `<tr>${row.map(cell => `<td style="border:1px solid #0f172a;padding:5px;text-align:center;">${mathTextToHtml(cell)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      `).join('');

      const imagesHtml = (q.images || []).map(img => `<div style="text-align:center;margin:8px 0;"><img src="${img}" style="max-width:60%;max-height:180px;" /></div>`).join('');

      const subQuestionsHtml = q.subQuestions.length > 0 ? `
        <div style="margin-top:6px;">
          ${q.subQuestions.map((sq, sqIdx) => `
            <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:3px;">
              <div style="display:flex;gap:8px;">
                <span style="font-weight:600;min-width:20px;">(${String.fromCharCode(97 + sqIdx)})</span>
                <span>${mathTextToHtml(sq.text)}</span>
              </div>
              ${sq.marks ? `<span style="font-weight:bold;white-space:nowrap;font-size:12px;">(${escapeHtml(sq.marks)})</span>` : ''}
            </div>
          `).join('')}
        </div>
      ` : '';

      return `
        ${orHtml}
        <div style="display:flex;gap:10px;margin-bottom:10px;">
          <span style="font-weight:bold;min-width:22px;">${globalNum}.</span>
          <div style="flex:1;">
            <div>${mathTextToHtml(q.text)}</div>
            ${tablesHtml}${imagesHtml}${subQuestionsHtml}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="margin-bottom:18px;">
        <div style="text-align:center;font-weight:bold;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">${escapeHtml(part.name)}</div>
        <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:13px;margin-bottom:8px;">
          <span>${escapeHtml(part.instructions || 'Answer all the questions')}</span>
          <span>${part.questionsToAnswer ?? part.questionCount} x ${part.marksPerQuestion} = ${part.totalMarks} marks</span>
        </div>
        ${questionsHtml}
      </div>
    `;
  }).join('');

  return headerHtml + partsHtml;
};

// Splits text on newlines and renders each line with buildMathRuns, inserting
// real line breaks between them. Used when building the Word export.
const renderMathWithBreaks = (text: string, baseOptions: any = {}): InstanceType<typeof TextRun>[] => {
  if (!text) return [];
  const lines = text.split('\n');
  return lines.flatMap((line, i) => [
    ...buildMathRuns(line, baseOptions),
    ...(i < lines.length - 1 ? [new TextRun({ break: 1 })] : []),
  ]);
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
  const [examData, setExamData] = useState<ExamData>(INITIAL_DATA);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview' | 'document'>('edit');
  const [expandedPart, setExpandedPart] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [documentHtml, setDocumentHtml] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);

  // Seed the editable document the first time the tab is opened
  useEffect(() => {
    if (activeTab === 'document' && !documentHtml) {
      setDocumentHtml(generateDocumentFromExam(examData));
    }
  }, [activeTab]);

  // Write generated HTML into the contentEditable DOM only when it's (re)generated,
  // never on every keystroke — the editor is otherwise uncontrolled so typing doesn't
  // fight React re-renders or lose cursor position.
  useEffect(() => {
    if (editorRef.current && documentHtml) {
      editorRef.current.innerHTML = documentHtml;
    }
  }, [documentHtml]);

  const regenerateDocument = () => {
    if (window.confirm('This replaces your edits in this tab with a fresh copy generated from the Exam Data tab. Continue?')) {
      setDocumentHtml(generateDocumentFromExam(examData));
    }
  };

  const runEditorCommand = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
  };

  const insertSymbol = (symbol: string) => {
    editorRef.current?.focus();
    document.execCommand('insertText', false, symbol);
  };

  const insertFraction = () => {
    const num = window.prompt('Numerator?', 'a');
    if (num === null) return;
    const den = window.prompt('Denominator?', 'b');
    if (den === null) return;
    editorRef.current?.focus();
    document.execCommand('insertHTML', false, `<sup>${escapeHtml(num)}</sup>&frasl;<sub>${escapeHtml(den)}</sub>&nbsp;`);
  };

  const insertLimits = (symbol: string) => {
    const lower = window.prompt('Lower limit? (e.g. n=1)', 'n=1');
    if (lower === null) return;
    const upper = window.prompt('Upper limit? (e.g. 8, leave blank if none)', '');
    editorRef.current?.focus();
    const html = `${symbol}<sub>${escapeHtml(lower)}</sub>${upper ? `<sup>${escapeHtml(upper)}</sup>` : ''}&nbsp;`;
    document.execCommand('insertHTML', false, html);
  };

  const exportDocumentPDF = () => {
    if (!editorRef.current) return;
    const opt = {
      margin: [12, 12, 12, 12],
      filename: `${examData.courseCode || 'exam'}_question_paper.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const },
    };
    html2pdf().set(opt).from(editorRef.current).save();
  };

  const collectDocxRunsFromNode = (
    node: ChildNode,
    fmt: { bold?: boolean; italic?: boolean; underline?: boolean; superScript?: boolean; subScript?: boolean }
  ): InstanceType<typeof TextRun>[] => {
    const runs: InstanceType<typeof TextRun>[] = [];
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (text) {
        runs.push(new TextRun({
          text,
          bold: fmt.bold,
          italics: fmt.italic,
          underline: fmt.underline ? {} : undefined,
          superScript: fmt.superScript,
          subScript: fmt.subScript,
          font: 'Times New Roman',
          size: 22,
        }));
      }
      return runs;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return runs;

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') {
      runs.push(new TextRun({ text: '', break: 1 }));
      return runs;
    }

    const nextFmt = { ...fmt };
    if (tag === 'b' || tag === 'strong') nextFmt.bold = true;
    if (tag === 'i' || tag === 'em') nextFmt.italic = true;
    if (tag === 'u') nextFmt.underline = true;
    if (tag === 'sup') nextFmt.superScript = true;
    if (tag === 'sub') nextFmt.subScript = true;

    el.childNodes.forEach(child => {
      runs.push(...collectDocxRunsFromNode(child, nextFmt));
    });
    return runs;
  };

  const convertEditorBlockToDocx = async (
    el: HTMLElement
  ): Promise<(InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[]> => {
    const tag = el.tagName.toLowerCase();

    if (tag === 'table') {
      const rows: InstanceType<typeof TableRow>[] = [];
      const trEls = Array.from(el.querySelectorAll('tr'));
      for (const tr of trEls) {
        const cells: InstanceType<typeof TableCell>[] = [];
        const tdEls = Array.from(tr.querySelectorAll('td, th'));
        for (const td of tdEls) {
          const cellRuns = collectDocxRunsFromNode(td, {});
          cells.push(new TableCell({
            children: [new Paragraph({ children: cellRuns.length ? cellRuns : [new TextRun('')], alignment: AlignmentType.CENTER })],
            margins: { top: 80, bottom: 80, left: 80, right: 80 },
          }));
        }
        rows.push(new TableRow({ children: cells }));
      }
      return rows.length ? [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })] : [];
    }

    if (tag === 'img') {
      const src = (el as HTMLImageElement).getAttribute('src') || '';
      if (!src) return [];
      try {
        const resp = await fetch(src);
        const buf = await resp.arrayBuffer();
        return [new Paragraph({
          children: [new ImageRun({ data: new Uint8Array(buf), transformation: { width: 220, height: 140 }, type: 'png' })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
        })];
      } catch {
        return [];
      }
    }

    if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(el.children).filter(c => c.tagName.toLowerCase() === 'li');
      return items.map((li, idx) => {
        const runs = collectDocxRunsFromNode(li, {});
        const prefix = tag === 'ol' ? `${idx + 1}. ` : '• ';
        return new Paragraph({
          children: [new TextRun({ text: prefix, font: 'Times New Roman', size: 22 }), ...runs],
          spacing: { after: 60 },
        });
      });
    }

    if (tag === 'hr') {
      return [new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '0f172a' } },
        spacing: { after: 160 },
      })];
    }

    const blockChildTags = ['div', 'p', 'table', 'ul', 'ol', 'h1', 'h2', 'h3', 'hr'];
    const hasBlockChildren = Array.from(el.children).some(c => blockChildTags.includes(c.tagName.toLowerCase()));

    if (hasBlockChildren) {
      const results: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          results.push(...await convertEditorBlockToDocx(child as HTMLElement));
        } else if (child.nodeType === Node.TEXT_NODE && (child.textContent || '').trim()) {
          results.push(new Paragraph({ children: [new TextRun({ text: child.textContent || '', font: 'Times New Roman', size: 22 })] }));
        }
      }
      return results;
    }

    const runs = collectDocxRunsFromNode(el, {});
    const isHeading = /^h[1-3]$/.test(tag);
    const align = el.style.textAlign === 'center' ? AlignmentType.CENTER
      : el.style.textAlign === 'right' ? AlignmentType.RIGHT
      : AlignmentType.LEFT;

    return [new Paragraph({
      children: runs.length ? runs : [new TextRun('')],
      alignment: align,
      heading: isHeading ? (tag === 'h1' ? HeadingLevel.HEADING_1 : tag === 'h2' ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3) : undefined,
      spacing: { after: 100 },
    })];
  };

  const exportDocumentWord = async () => {
    if (!editorRef.current) return;
    const blocks: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
    for (const child of Array.from(editorRef.current.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        blocks.push(...await convertEditorBlockToDocx(child as HTMLElement));
      } else if (child.nodeType === Node.TEXT_NODE && (child.textContent || '').trim()) {
        blocks.push(new Paragraph({ children: [new TextRun({ text: child.textContent || '', font: 'Times New Roman', size: 22 })] }));
      }
    }

    const doc = new Document({
      sections: [{ properties: {}, children: blocks.length ? blocks : [new Paragraph('')] }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${examData.courseCode || 'exam'}_question_paper_edited.docx`);
  };

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
\\author{${examData.collegeName}}
\\date{${formatDate(examData.date, examData.month, examData.year)}}

\\begin{document}

\\begin{center}
    \\textbf{\\Large ${examData.collegeName}} \\\\
    \\textbf{${examData.examTitle}} \\\\
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
    // Fetch the bundled logo asset and convert it to raw bytes for docx ImageRun
    const logoResponse = await fetch(defaultLogo);
    const logoArrayBuffer = await logoResponse.arrayBuffer();
    const logoData = new Uint8Array(logoArrayBuffer);

    const headerChildren = [
      // Logo
      new Paragraph({
        children: [
          new ImageRun({
            data: logoData,
            transformation: { width: 100, height: 100 },
            type: 'png',
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      }),

      // College Name
      new Paragraph({
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
      }),

      // Exam Details Table
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE },
          bottom: { style: BorderStyle.SINGLE, size: 1 },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
          insideHorizontal: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.NONE },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
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

    let globalQuestionNumber = 0;
    const bodyChildren = examData.parts.flatMap(part => {
      const partChildren = [
        new Paragraph({
          children: [
            new TextRun({
              text: part.name.toUpperCase(),
              bold: true,
              size: 24,
              font: "Times New Roman",
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 50 },
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE },
            bottom: { style: BorderStyle.NONE },
            left: { style: BorderStyle.NONE },
            right: { style: BorderStyle.NONE },
            insideHorizontal: { style: BorderStyle.NONE },
            insideVertical: { style: BorderStyle.NONE },
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: part.instructions || "Answer all the questions", bold: true, size: 20, font: "Times New Roman" })] })],
                }),
                new TableCell({
                  children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${part.questionsToAnswer ?? part.questionCount} x ${part.marksPerQuestion} = ${part.totalMarks} marks`, bold: true, size: 20, font: "Times New Roman" })] })],
                }),
              ],
            }),
          ],
        }),
        
        ...part.questions.flatMap((q) => {
          const questionElements: any[] = [];
          
          if (q.isOr) {
            questionElements.push(
              new Paragraph({
                children: [new TextRun({ text: "(OR)", bold: true, size: 20, font: "Times New Roman" })],
                alignment: AlignmentType.CENTER,
                spacing: { before: 100, after: 100 },
              })
            );
          } else {
            globalQuestionNumber++;
          }

          questionElements.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${globalQuestionNumber}. `, bold: true, size: 20, font: "Times New Roman" }),
                ...renderMathWithBreaks(q.text || "", { size: 20, font: "Times New Roman" }),
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
                  rows: table.rows.map(row => 
                    new TableRow({
                      children: row.map(cell => 
                        new TableCell({
                          children: [new Paragraph({ children: buildMathRuns(cell, { size: 18, font: "Times New Roman" }) })],
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
                  ...renderMathWithBreaks(sq.text || "", { size: 20, font: "Times New Roman" }),
                  ...(sq.marks ? [new TextRun({ text: ` [${sq.marks}]`, bold: true, size: 20, font: "Times New Roman" })] : []),
                ],
                spacing: { before: 100, after: 50 },
              })
            );
          });

          return questionElements;
        })
      ];
      return partChildren;
    });

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              size: {
                orientation: PageOrientation.LANDSCAPE,
                width: 15817,
                height: 12246,
              },
              margin: {
                top: 811,
                bottom: 448,
                left: 539,
                right: 448,
              },
            },
            column: {
              count: 2,
              space: 448,
            },
          },
          children: [...headerChildren, ...bodyChildren],
        }
      ],
    });

    const examNumber = examData.examTitle === 'First' ? '1' : 
                       examData.examTitle === 'Second' ? '2' : 
                       examData.examTitle === 'Third' ? '3' : '1';
    const fileName = `${examData.courseCode || 'CIA'}_Q_${examNumber}CIA.docx`;

    const blob = await Packer.toBlob(doc);
    saveAs(blob, fileName);
  };

  const resetExam = () => {
    if (confirm('Are you sure you want to reset? All progress will be lost.')) {
      setExamData(INITIAL_DATA);
      localStorage.removeItem('cia-exam-draft');
    }
  };

  const loadSample = () => {
    const sampleData: ExamData = {
      ...INITIAL_DATA,
      courseCode: 'CS302',
      courseName: 'Database Management Systems',
      collegeName: 'St. Xavier\'s College of Engineering',
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
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
                <FileText size={24} />
              </div>
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
                  onClick={() => setActiveTab('document')}
                  className={cn(
                    "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                    activeTab === 'document' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  <FileText size={16} />
                  <span className="hidden sm:inline">Edit Document</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'edit' ? (
          <div className="space-y-8">
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
                    <label className="block text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">College Name</label>
                    <input
                      type="text"
                      name="collegeName"
                      value={examData.collegeName || ''}
                      onChange={handleBasicDetailsChange}
                      placeholder="Enter college name"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-base"
                    />
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
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">College Logo</label>
                    <div className="flex items-center gap-4">
                      <img src={defaultLogo} alt="Logo" className="w-12 h-12 object-contain border border-slate-200 rounded-lg" />
                      <span className="text-sm text-slate-500">Default college logo</span>
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
                                          <textarea
                                            value={q.text || ''}
                                            onChange={(e) => updateQuestion(part.id, q.id, { text: e.target.value })}
                                            placeholder={`Enter question ${qIdx + 1}...`}
                                            rows={2}
                                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-base focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none resize-none transition-all"
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
                                            <input
                                              type="text"
                                              value={sq.text || ''}
                                              onChange={(e) => updateSubQuestion(part.id, q.id, sq.id, { text: e.target.value })}
                                              placeholder="Sub-question text..."
                                              className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
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
        ) : activeTab === 'preview' ? (
          /* Preview Mode */
          <div className="flex flex-col items-center space-y-8">
            <div 
              className="bg-white exam-paper-shadow font-serif text-slate-900 overflow-hidden" 
              style={{ 
                width: '279mm', 
                height: '216mm',
                paddingTop: '14.3mm',
                paddingBottom: '7.9mm',
                paddingLeft: '9.5mm',
                paddingRight: '7.9mm'
              }}
              ref={previewRef}
            >
              {/* Exam Content - Two Columns with forced flow */}
              <div className="columns-2 [column-fill:auto] h-full gap-[7.9mm]">
                {/* Exam Header - Now inside the first column */}
                <div className="break-inside-avoid mb-4 border-b border-slate-900 pb-3">
                  <div className="flex flex-col items-center text-center mb-2">
                    {/* Logo Area */}
                    <div className="w-full flex justify-center mb-1">
                      <img src={defaultLogo} alt="Logo" className="h-20 w-auto object-contain" />
                    </div>
                    
                    <h2 className="text-[12px] font-bold uppercase w-full">
                      {examData.collegeName || ''}
                    </h2>

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

                {(() => {
                  let globalNum = 0;
                  return examData.parts.map((part) => (
                    <div key={part.id} className="space-y-1 mb-2">
                      <div className="text-center mb-0.5">
                        <h3 className="text-sm font-bold uppercase tracking-widest">{part.name}</h3>
                      </div>
                      
                      <div className="flex justify-between items-end text-[12px] font-bold mb-1">
                        <p>{part.instructions || 'Answer all the questions'}</p>
                        <p>{part.questionsToAnswer ?? part.questionCount} x {part.marksPerQuestion} = {part.totalMarks} marks</p>
                      </div>

                      <div className="space-y-1">
                        {part.questions.map((q) => {
                          if (!q.isOr) globalNum++;
                          return (
                            <React.Fragment key={q.id}>
                              {q.isOr && (
                                <div className="text-center font-bold py-0.5 uppercase tracking-widest text-[11px]">(OR)</div>
                              )}
                              <div className="relative break-inside-avoid">
                                <div className="flex gap-2">
                                  <span className="font-bold min-w-[16px] text-[13px]">{globalNum}.</span>
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
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              ));
                })()}
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => window.print()}
                className="bg-white border border-slate-200 text-slate-700 px-6 py-3 rounded-xl font-semibold flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm"
              >
                <Printer size={20} />
                Print Paper
              </button>
              <button
                onClick={exportWord}
                className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-semibold flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-md flex-1 md:flex-initial justify-center"
              >
                <FileText size={20} />
                Download Word Format
              </button>
            </div>
          </div>
        ) : (
          /* Edit Document Mode */
          <div className="flex flex-col items-center space-y-6">
            <div className="w-full max-w-4xl bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              {/* Formatting Toolbar */}
              <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-3 py-2">
                <button type="button" onClick={() => runEditorCommand('bold')} className="p-2 rounded-lg hover:bg-slate-200 text-slate-700" title="Bold"><Bold size={16} /></button>
                <button type="button" onClick={() => runEditorCommand('italic')} className="p-2 rounded-lg hover:bg-slate-200 text-slate-700" title="Italic"><Italic size={16} /></button>
                <button type="button" onClick={() => runEditorCommand('underline')} className="p-2 rounded-lg hover:bg-slate-200 text-slate-700" title="Underline"><Underline size={16} /></button>
                <span className="w-px h-6 bg-slate-300 mx-1" />
                <button type="button" onClick={() => runEditorCommand('justifyLeft')} className="p-2 rounded-lg hover:bg-slate-200 text-slate-700" title="Align left"><AlignLeft size={16} /></button>
                <button type="button" onClick={() => runEditorCommand('justifyCenter')} className="p-2 rounded-lg hover:bg-slate-200 text-slate-700" title="Align center"><AlignCenter size={16} /></button>
                <button type="button" onClick={() => runEditorCommand('justifyRight')} className="p-2 rounded-lg hover:bg-slate-200 text-slate-700" title="Align right"><AlignRight size={16} /></button>
                <span className="w-px h-6 bg-slate-300 mx-1" />
                <button type="button" onClick={() => runEditorCommand('insertUnorderedList')} className="p-2 rounded-lg hover:bg-slate-200 text-slate-700" title="Bullet list"><List size={16} /></button>
                <button type="button" onClick={() => runEditorCommand('insertOrderedList')} className="p-2 rounded-lg hover:bg-slate-200 text-slate-700" title="Numbered list"><ListOrdered size={16} /></button>
                <span className="w-px h-6 bg-slate-300 mx-1" />
                <button type="button" onClick={() => runEditorCommand('superscript')} className="p-2 rounded-lg hover:bg-slate-200 text-slate-700" title="Superscript"><Superscript size={16} /></button>
                <button type="button" onClick={() => runEditorCommand('subscript')} className="p-2 rounded-lg hover:bg-slate-200 text-slate-700" title="Subscript"><Subscript size={16} /></button>
                <span className="w-px h-6 bg-slate-300 mx-1" />
                <button type="button" onClick={() => runEditorCommand('undo')} className="p-2 rounded-lg hover:bg-slate-200 text-slate-700" title="Undo"><Undo2 size={16} /></button>
                <button type="button" onClick={() => runEditorCommand('redo')} className="p-2 rounded-lg hover:bg-slate-200 text-slate-700" title="Redo"><Redo2 size={16} /></button>
                <span className="w-px h-6 bg-slate-300 mx-1" />
                <button type="button" onClick={regenerateDocument} className="p-2 rounded-lg hover:bg-slate-200 text-slate-700 flex items-center gap-1.5 text-xs font-medium" title="Regenerate from Exam Data tab">
                  <RefreshCw size={14} /> Regenerate
                </button>
              </div>

              {/* Math Symbols Panel */}
              <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-3 py-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-1 flex items-center gap-1"><Sigma size={12} /> Math</span>
                {['α','β','γ','δ','θ','λ','μ','π','σ','φ','Δ','Σ','Ω','±','×','÷','≤','≥','≠','≈','∞','√','∫','∂','∇','→','∈','∪','∩','·'].map(sym => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => insertSymbol(sym)}
                    className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 text-sm"
                    title={`Insert ${sym}`}
                  >
                    {sym}
                  </button>
                ))}
                <span className="w-px h-6 bg-slate-300 mx-1" />
                <button type="button" onClick={insertFraction} className="px-2 h-7 rounded-md hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 text-xs font-medium" title="Insert fraction">
                  a⁄b
                </button>
                <button type="button" onClick={() => insertLimits('Σ')} className="px-2 h-7 rounded-md hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 text-xs font-medium" title="Insert summation with limits">
                  Σ limits
                </button>
                <button type="button" onClick={() => insertLimits('∫')} className="px-2 h-7 rounded-md hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 text-xs font-medium" title="Insert integral with limits">
                  ∫ limits
                </button>
              </div>

              {/* Editable Document */}
              <div className="bg-slate-100 p-4 sm:p-8 overflow-x-auto">
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  className="bg-white mx-auto shadow-sm font-serif text-slate-900 text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-indigo-300 rounded-sm"
                  style={{ width: '210mm', minHeight: '297mm', padding: '18mm' }}
                />
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={exportDocumentPDF}
                className="bg-white border border-slate-200 text-slate-700 px-6 py-3 rounded-xl font-semibold flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm"
              >
                <Printer size={20} />
                Download PDF
              </button>
              <button
                onClick={exportDocumentWord}
                className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-semibold flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-md flex-1 md:flex-initial justify-center"
              >
                <FileText size={20} />
                Download Word Format
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Floating Success Indicator */}
      <div className="fixed bottom-8 right-8 no-print">
        <div className="bg-white border border-slate-200 px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-xs font-medium text-slate-600">
          <CheckCircle2 size={14} className="text-emerald-500" />
          Draft Saved Locally
        </div>
      </div>
    </div>
  );
}
