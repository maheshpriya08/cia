/**
 * Reads a syllabus file into plain text, in the browser.
 *   .txt / .md / .csv  read directly
 *   .docx              unzipped with JSZip (already installed as a dependency of `docx`)
 *   .pdf               read with pdf.js, loaded from a CDN on first use
 * Scanned PDFs are images, not text, and cannot be read this way.
 */
import JSZip from 'jszip';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

export function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\n\s*\|\s*/g, ' | ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readDocx(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('This does not look like a .docx file.');
  return docxXmlToText(await doc.async('string'));
}

async function loadPdfJs(): Promise<any> {
  const w = window as any;
  if (!w.pdfjsLib) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load the PDF reader. Check your internet connection, or paste the syllabus text instead.'));
      document.head.appendChild(s);
    });
    w.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  return w.pdfjsLib;
}

async function readPdf(buf: ArrayBuffer): Promise<string> {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    let out = '';
    let lastY: number | null = null;
    for (const item of content.items as any[]) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform?.[5] as number | undefined;
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) out += '\n';
      else if (out && !out.endsWith(' ') && !out.endsWith('\n')) out += ' ';
      out += item.str;
      if (y !== undefined) lastY = y;
    }
    pages.push(out);
  }
  const text = pages.join('\n').replace(/[ \t]+/g, ' ').trim();
  if (text.length < 20) {
    throw new Error('No text found in this PDF. It may be a scan (an image). Paste the syllabus text instead.');
  }
  return text;
}

export async function readSyllabusFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (/\.(txt|md|csv)$/.test(name) || file.type.startsWith('text/')) return (await file.text()).trim();
  if (name.endsWith('.docx')) return readDocx(await file.arrayBuffer());
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return readPdf(await file.arrayBuffer());
  if (name.endsWith('.doc')) throw new Error('Old .doc files are not supported. Save it as .docx or PDF and upload again.');
  throw new Error('Please upload a PDF, Word (.docx) or text file.');
}
