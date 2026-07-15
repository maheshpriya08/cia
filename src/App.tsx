import React, { useState, useEffect, useRef } from 'react';
import logo from "./assets/logo.png";
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
  Printer
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
import logo from './assets/logo.png';

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
  collegeName: 'SRINIVASA RAMANUJAN CENTRE, KUMBAKONAM – 612001',
  semester: '',
  program: PROGRAMS[0],
  logoUrl: logo,
  parts: [
    { id: 'part-a', name: 'Part A', instructions: 'Answer all the questions', questionCount: 5, questionsToAnswer: 5, marksPerQuestion: 2, totalMarks: 10, questions: Array.from({ length: 5 }, (_, i) => ({ id: `q-a-${i}`, text: '', subQuestions: [], images: [], tables: [] })) },
    { id: 'part-b', name: 'Part B', instructions: 'Answer all the questions', questionCount: 4, questionsToAnswer: 4, marksPerQuestion: 4, totalMarks: 16, questions: Array.from({ length: 4 }, (_, i) => ({ id: `q-b-${i}`, text: '', subQuestions: [], images: [], tables: [] })) },
    { id: 'part-c', name: 'Part C', instructions: 'Answer any 2 questions', questionCount: 3, questionsToAnswer: 2, marksPerQuestion: 12, totalMarks: 24, questions: Array.from({ length: 3 }, (_, i) => ({ id: `q-c-${i}`, text: '', subQuestions: [], images: [], tables: [] })) },
  ]
};

const formatMathForWord = (text: string): string => {
  if (!text) return "";
  
  let result = text;
  
  // Handle fractions: \frac{num}{den} -> (num/den)
  result = result.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1/$2)');
  
  // Handle subscripts and superscripts: x^2 -> x², x_2 -> x₂
  const superscripts: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ' };
  const subscripts: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', 'a': 'ₐ', 'e': 'ₑ', 'o': 'ₒ', 'x': 'ₓ', 'h': 'ₕ', 'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'p': 'ₚ', 's': 'ₛ', 't': 'ₜ' };

  result = result.replace(/\^\{?([0-9+\-=()ni])\}?/g, (_, p1) => superscripts[p1] || `^${p1}`);
  result = result.replace(/_\{?([0-9+\-=()aeoxhklmnpst])\}?/g, (_, p1) => subscripts[p1] || `_${p1}`);

  const replacements: Record<string, string> = {
    '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\epsilon': 'ε',
    '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ', '\\iota': 'ι', '\\kappa': 'κ',
    '\\lambda': 'λ', '\\mu': 'μ', '\\nu': 'ν', '\\xi': 'ξ', '\\pi': 'π',
    '\\rho': 'ρ', '\\sigma': 'σ', '\\tau': 'τ', '\\upsilon': 'υ', '\\phi': 'φ',
    '\\chi': 'χ', '\\psi': 'ψ', '\\omega': 'ω',
    '\\Delta': 'Δ', '\\Sigma': 'Σ', '\\Omega': 'Ω', '\\Theta': 'Θ', '\\Phi': 'Φ',
    '\\pm': '±', '\\sqrt': '√', '\\times': '×', '\\div': '÷', '\\neq': '≠',
    '\\leq': '≤', '\\geq': '≥', '\\infty': '∞', '\\approx': '≈',
    '\\rightarrow': '→', '\\leftarrow': '←', '\\Rightarrow': '⇒', '\\Leftarrow': '⇐',
    '\\forall': '∀', '\\exists': '∃', '\\in': '∈', '\\notin': '∉', '\\subset': '⊂',
    '\\supset': '⊃', '\\cup': '∪', '\\cap': '∩', '\\int': '∫', '\\partial': '∂',
    '\\nabla': '∇', '\\angle': '∠', '\\perp': '⊥', '\\parallel': '∥',
    '\\cdot': '·', '\\dots': '...', '\\cdots': '...', '\\vdots': '⋮', '\\ddots': '⋱',
    '\\{': '{', '\\}': '}', '\\$': '$', '\\%': '%', '\\&': '&', '\\_': '_',
  };

  // Replace symbols
  Object.entries(replacements).forEach(([latex, unicode]) => {
    const escaped = latex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), unicode);
  });

  // Remove LaTeX delimiters
  result = result.replace(/\$\$/g, '').replace(/\$/g, '');
  
  // Final cleanup: remove remaining backslashes and braces
  result = result.replace(/\\/g, '').replace(/\{/g, '').replace(/\}/g, '');
  
  return result.trim();
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
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [expandedPart, setExpandedPart] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

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
            const newSubQuestion: SubQuestion = { id: `sq-${Date.now()}`, text: '', marks: 1 };
            return { ...q, subQuestions: [...q.subQuestions, newSubQuestion] };
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
            return { ...q, subQuestions: q.subQuestions.filter(sq => sq.id !== sqId) };
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

  const addQuestion = (partId: string) => {
    const newQuestion: Question = { id: `q-${Date.now()}`, text: '', subQuestions: [], images: [], tables: [] };
    setExamData(prev => ({
      ...prev,
      parts: prev.parts.map(p => {
        if (p.id !== partId) return p;
        const updatedQuestions = [...p.questions, newQuestion];
        return { ...p, questions: updatedQuestions, questionCount: updatedQuestions.length };
      })
    }));
  };

  const deleteQuestion = (partId: string, qId: string) => {
    setExamData(prev => ({
      ...prev,
      parts: prev.parts.map(p => {
        if (p.id !== partId) return p;
        const updatedQuestions = p.questions.filter(q => q.id !== qId);
        return { ...p, questions: updatedQuestions, questionCount: updatedQuestions.length };
      })
    }));
  };

  const addImageToQuestion = (partId: string, qId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setExamData(prev => ({
          ...prev,
          parts: prev.parts.map(p => {
            if (p.id !== partId) return p;
            return {
              ...p,
              questions: p.questions.map(q =>
                q.id === qId ? { ...q, images: [...q.images, reader.result as string] } : q
              )
            };
          })
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = (partId: string, qId: string, imgIndex: number) => {
    setExamData(prev => ({
      ...prev,
      parts: prev.parts.map(p => {
        if (p.id !== partId) return p;
        return {
          ...p,
          questions: p.questions.map(q => {
            if (q.id !== qId) return q;
            return { ...q, images: q.images.filter((_, i) => i !== imgIndex) };
          })
        };
      })
    }));
  };

  const addTableToQuestion = (partId: string, qId: string) => {
    setExamData(prev => ({
      ...prev,
      parts: prev.parts.map(p => {
        if (p.id !== partId) return p;
        return {
          ...p,
          questions: p.questions.map(q => {
            if (q.id !== qId) return q;
            const newTable = {
              id: `table-${Date.now()}`,
              headers: ['Column 1', 'Column 2'],
              rows: [['', ''], ['', '']]
            };
            return { ...q, tables: [...q.tables, newTable] };
          })
        };
      })
    }));
  };

  const updateTable = (partId: string, qId: string, tableId: string, updates: any) => {
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
              tables: q.tables.map(t => t.id === tableId ? { ...t, ...updates } : t)
            };
          })
        };
      })
    }));
  };

  const removeTable = (partId: string, qId: string, tableId: string) => {
    setExamData(prev => ({
      ...prev,
      parts: prev.parts.map(p => {
        if (p.id !== partId) return p;
        return {
          ...p,
          questions: p.questions.map(q => {
            if (q.id !== qId) return q;
            return { ...q, tables: q.tables.filter(t => t.id !== tableId) };
          })
        };
      })
    }));
  };

  // ...rest of file unchanged
}
