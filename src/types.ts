export interface SubQuestion {
  id: string;
  text: string;
  marks?: number;
}

export interface TableData {
  rows: string[][];
  hasHeader?: boolean;
}

export interface Question {
  id: string;
  text: string;
  subQuestions: SubQuestion[];
  isOr?: boolean; // If true, this question is an alternative to the previous one
  images: string[]; // Array of image URLs/base64
  tables: TableData[]; // Array of tables
}

export interface ExamPart {
  id: string;
  name: string;
  instructions?: string;
  questionCount: number;
  questionsToAnswer?: number; // How many questions the student needs to answer
  marksPerQuestion: number;
  totalMarks: number;
  questions: Question[];
}

export interface ExamData {
  courseCode: string;
  courseName: string;
  examTitle: string;
  duration: string;
  maxMarks: string;
  date: string;
  month?: string;
  year?: string;
  collegeName: string;
  semester: string;
  program: string;
  logoUrl: string | null;
  parts: ExamPart[];
}
