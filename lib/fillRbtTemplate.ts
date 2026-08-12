/**
 * fillRbtTemplate — writes questions, CO and RBT levels into RBT_Template.docx.
 *
 * The template has three tables (PART A / B / C), each with a header row and
 * a set of numbered blank rows. Row 1 of each table is already fully styled —
 * Times New Roman 12pt, centred Q.No, justified question cell, centred CO and
 * RBT — so this clones that row rather than building cells from scratch. The
 * paper then matches the template exactly, including the parts you did not
 * ask me to touch.
 *
 * Row count adapts: 5 questions into a 3-row table adds rows; 2 into a 5-row
 * table removes the spares.
 *
 *   import { fillRbtTemplate } from './lib/fillRbtTemplate';
 *
 *   const blob = await fillRbtTemplate(templateArrayBuffer, {
 *     header: { programme: 'B.Sc. Mathematics with Computer Applications',
 *               courseCode: 'MAT338', courseName: 'Neural Networks & Deep Learning' },
 *     parts: [
 *       { part: 'A', questions: [{ text: '…', co: 'CO1', rbt: 'L4' }] },
 *       { part: 'B', questions: [...] },
 *       { part: 'C', questions: [...] },
 *     ],
 *   });
 *
 * Needs JSZip:  npm install jszip
 */

import JSZip from 'jszip';
import { questionToDocxXml } from './questionToDocx';
import { escapeXml } from './latexToOmml';

export interface RbtQuestion {
  /** Question source text, may contain $…$ maths. */
  text: string;
  /** Course outcome, chosen by the author — "CO1". Blank prints an empty cell. */
  co?: string;
  /** RBT level — "L4". Usually the accepted suggestion from classifyRbt. */
  rbt?: string;
}

export interface RbtPart {
  /** 'A' | 'B' | 'C' — matches the order of tables in the template. */
  part: string;
  questions: RbtQuestion[];
}

export interface RbtHeader {
  monthYear?: string;
  time?: string;
  ciaTest?: string;
  maxMarks?: string;
  programme?: string;
  courseCode?: string;
  courseName?: string;
}

export interface FillOptions {
  header?: RbtHeader;
  parts: RbtPart[];
  /** Continue numbering across parts (1,2,3 → 4,5 → 6). Default true. */
  continuousNumbering?: boolean;
}

/* ------------------------------------------------------------------ */
/* low-level XML surgery                                               */
/* ------------------------------------------------------------------ */

/** Split a table's XML into its <w:tr> rows plus the surrounding shell. */
function splitRows(tableXml: string): { head: string; rows: string[]; tail: string } {
  const rowPattern = /<w:tr[\s>][\s\S]*?<\/w:tr>/g;
  const rows: string[] = [];
  let match: RegExpExecArray | null;
  let firstStart = -1;
  let lastEnd = -1;

  while ((match = rowPattern.exec(tableXml)) !== null) {
    if (firstStart < 0) firstStart = match.index;
    lastEnd = match.index + match[0].length;
    rows.push(match[0]);
  }

  return {
    head: tableXml.slice(0, firstStart),
    rows,
    tail: tableXml.slice(lastEnd),
  };
}

/** The four <w:tc> cells of a row, in order. */
function splitCells(rowXml: string): string[] {
  const cells: string[] = [];
  const pattern = /<w:tc>[\s\S]*?<\/w:tc>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rowXml)) !== null) cells.push(match[0]);
  return cells;
}

/**
 * Replace a cell's paragraph content, keeping its <w:tcPr> and the paragraph's
 * own <w:pPr> — that's what preserves the template's fonts and alignment.
 */
function setCellText(cellXml: string, text: string): string {
  return replaceCellParagraphBody(cellXml, (runProps) =>
    text ? `<w:r>${runProps}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>` : ''
  );
}

/** Replace a cell's content with pre-built block XML (paragraphs, equations). */
function setCellBlocks(cellXml: string, blocksXml: string): string {
  const tcPrMatch = cellXml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/);
  const tcPr = tcPrMatch ? tcPrMatch[0] : '';
  return `<w:tc>${tcPr}${blocksXml || '<w:p/>'}</w:tc>`;
}

function replaceCellParagraphBody(
  cellXml: string,
  buildRuns: (runProps: string) => string
): string {
  const paragraphMatch = cellXml.match(/<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/);
  if (!paragraphMatch) return cellXml;

  const paragraph = paragraphMatch[0];
  const pPrMatch = paragraph.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : '';

  // The run properties live inside <w:pPr><w:rPr>…</w:rPr></w:pPr> in this
  // template; reusing them keeps Times New Roman 12pt without hardcoding it.
  const rPrMatch = pPr.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  const rPr = rPrMatch ? rPrMatch[0] : '';

  const openTag = paragraph.startsWith('<w:p/>') ? '<w:p>' : paragraph.slice(0, paragraph.indexOf('>') + 1);
  const rebuilt = `${openTag}${pPr}${buildRuns(rPr)}</w:p>`;

  return cellXml.replace(paragraph, rebuilt);
}

/** Pull the paragraph run-properties out of a template cell, for reuse. */
function cellRunProps(cellXml: string): string {
  const pPr = cellXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  if (!pPr) return '';
  const rPr = pPr[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  return rPr ? rPr[0] : '';
}

/** Font size in half-points from a run-properties fragment (24 → 12pt). */
function sizeFromRunProps(rPr: string): number | undefined {
  const match = rPr.match(/<w:sz w:val="(\d+)"\/>/);
  return match ? Number(match[1]) : undefined;
}

/* ------------------------------------------------------------------ */
/* row building                                                        */
/* ------------------------------------------------------------------ */

function buildRow(
  modelRow: string,
  questionNumber: number,
  question: RbtQuestion
): string {
  const cells = splitCells(modelRow);
  if (cells.length < 4) return modelRow;

  const [numberCell, questionCell, coCell, rbtCell] = cells;

  const questionRunProps = cellRunProps(questionCell);
  const questionPPr =
    questionCell.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';

  // Build the question as block XML so maths and line breaks both survive.
  const questionXml = questionToDocxXml(question.text, {
    fontSizeHalfPoints: sizeFromRunProps(questionRunProps),
    paragraphPropsXml: questionPPr,
    runPropsXml: questionRunProps,
  });

  let row = modelRow;
  row = row.replace(numberCell, setCellText(numberCell, String(questionNumber)));
  row = row.replace(questionCell, setCellBlocks(questionCell, questionXml));
  row = row.replace(coCell, setCellText(coCell, question.co ?? ''));
  row = row.replace(rbtCell, setCellText(rbtCell, question.rbt ?? ''));

  return row;
}

function fillTable(tableXml: string, part: RbtPart, startNumber: number): string {
  const { head, rows, tail } = splitRows(tableXml);
  if (rows.length < 2) return tableXml;

  const headerRow = rows[0];
  const modelRow = rows[1];

  const built = part.questions.map((question, index) =>
    buildRow(modelRow, startNumber + index, question)
  );

  return head + headerRow + built.join('') + tail;
}

/* ------------------------------------------------------------------ */
/* header fields                                                       */
/* ------------------------------------------------------------------ */

/**
 * The template's header lines are label-and-blank ("Course Code:" with nothing
 * after it), so this inserts the value immediately after the label.
 *
 * Two details in your template make the naive approach fail, and both are
 * handled here:
 *   - labels carry a trailing space ("Programme: "), so the label is not at
 *     the end of the text node;
 *   - "Course Code:" and "Course Name:" share a single <w:t>, separated by
 *     run-on spaces, so a value has to be inserted mid-string without
 *     disturbing the other label.
 *
 * Insertion consumes the run of spaces that follows the label, which is what
 * kept the two columns aligned in the blank template.
 */
function fillHeaderFields(documentXml: string, header: RbtHeader): string {
  const fields: Array<[string, string | undefined]> = [
    ['Programme:', header.programme],
    ['Course Code:', header.courseCode],
    ['Course Name:', header.courseName],
    ['Month and Year:', header.monthYear],
    ['CIA Test:', header.ciaTest],
    ['Time:', header.time],
    ['Max Marks:', header.maxMarks],
  ];

  let output = documentXml;

  for (const [label, value] of fields) {
    if (!value) continue;

    // Find every text node, then insert inside the one containing the label.
    output = output.replace(
      /<w:t(\s+xml:space="preserve")?>([^<]*)<\/w:t>/g,
      (whole, space: string | undefined, text: string) => {
        const at = text.indexOf(label);
        if (at < 0) return whole;
        // Don't double-fill if this label already has a value after it.
        const after = text.slice(at + label.length);
        if (after.trim().length > 0 && !after.trim().startsWith('Course Name:')) return whole;

        const gap = /^(\s*)/.exec(after)?.[1] ?? '';
        // Keep at least one space; preserve the rest of the alignment run.
        const keptGap = gap.length > 1 ? gap.slice(0, Math.max(1, gap.length - value.length)) : ' ';
        const rebuilt =
          text.slice(0, at + label.length) + ' ' + escapeXml(value) + keptGap + after.slice(gap.length);

        return `<w:t xml:space="preserve">${rebuilt}</w:t>`;
      }
    );
  }

  return output;
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * The whole transformation, as a pure string→string function.
 * Separated from the zip handling so it can be unit-tested directly and
 * reused server-side (Node, a Vercel function) where JSZip isn't wanted.
 */
export function fillDocumentXml(documentXml: string, options: FillOptions): string {
  let xml = documentXml;

  if (options.header) xml = fillHeaderFields(xml, options.header);

  // Tables appear in document order: PART A, PART B, PART C.
  const tablePattern = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  const tables = xml.match(tablePattern) ?? [];

  const continuous = options.continuousNumbering !== false;
  let nextNumber = 1;

  options.parts.forEach((part, index) => {
    const tableXml = tables[index];
    if (!tableXml) return; // fewer tables than parts — leave the rest alone

    const start = continuous ? nextNumber : 1;
    const filled = fillTable(tableXml, part, start);
    xml = xml.replace(tableXml, filled);
    nextNumber = start + part.questions.length;
  });

  return xml;
}

export async function fillRbtTemplate(
  template: ArrayBuffer | Uint8Array,
  options: FillOptions
): Promise<Blob> {
  const zip = await JSZip.loadAsync(template);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('word/document.xml missing — is this a .docx?');

  const xml = await documentFile.async('string');
  zip.file('word/document.xml', fillDocumentXml(xml, options));

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
}

/** Browser download helper. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
