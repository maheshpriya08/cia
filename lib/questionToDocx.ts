/**
 * questionToDocxXml — turns one question's source text into Word paragraph XML.
 *
 * Solves two things at once:
 *
 *   1. Maths. `$…$` becomes a real Word equation via latexToOmml, so it is
 *      editable in Word and prints correctly, instead of arriving as literal
 *      dollar signs.
 *
 *   2. Line breaks. In the current output, a question written across several
 *      lines comes out run together — "…(b = 0).Initial Weights: w1…". That
 *      happens when newlines are dropped while building the run. Here a single
 *      newline becomes <w:br/> and a blank line starts a new <w:p>.
 *
 * Returns a string of one or more <w:p> elements, ready to splice into
 * word/document.xml (the m: namespace is already declared on the root).
 */

import { toOmmlRun, toOmmlParagraph, escapeXml } from './latexToOmml';
import { parseMathSegments } from './latex';

export interface QuestionRenderOptions {
  /** e.g. "4." — rendered bold before the text. */
  number?: string;
  /** Half-points: 24 = 12pt. Matches the current paper. */
  fontSizeHalfPoints?: number;
  /** Word style id to apply to each paragraph. */
  styleId?: string;
  /** Marks shown right-aligned at the end, e.g. "(10 marks)". */
  marks?: string;
  /**
   * A <w:pPr>…</w:pPr> fragment lifted from the target cell or paragraph.
   * Passing the template's own properties is how the output keeps its font,
   * justification and spacing instead of falling back to Normal style.
   */
  paragraphPropsXml?: string;
  /** A <w:rPr>…</w:rPr> fragment applied to every text run, same reasoning. */
  runPropsXml?: string;
}

function textRun(
  text: string,
  opts: { bold?: boolean; size?: number; runPropsXml?: string } = {}
): string {
  let props = '';

  if (opts.runPropsXml) {
    // Reuse the template's run properties, adding bold when asked.
    props = opts.bold
      ? opts.runPropsXml.replace('<w:rPr>', '<w:rPr><w:b/>')
      : opts.runPropsXml;
  } else if (opts.bold || opts.size) {
    props =
      `<w:rPr>${opts.bold ? '<w:b/>' : ''}` +
      `${opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : ''}</w:rPr>`;
  }

  return `<w:r>${props}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraph(children: string, styleId?: string, paragraphPropsXml?: string): string {
  const props = paragraphPropsXml
    ? paragraphPropsXml
    : styleId
      ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>`
      : '';
  return `<w:p>${props}${children}</w:p>`;
}

export function questionToDocxXml(
  source: string,
  {
    number,
    fontSizeHalfPoints,
    styleId,
    marks,
    paragraphPropsXml,
    runPropsXml,
  }: QuestionRenderOptions = {}
): string {
  const size = fontSizeHalfPoints;
  const runOpts = { size, runPropsXml };
  // A blank line separates paragraphs; single newlines are breaks within one.
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const out: string[] = [];

  blocks.forEach((block, blockIndex) => {
    const children: string[] = [];

    if (blockIndex === 0 && number) {
      children.push(textRun(`${number} `, { ...runOpts, bold: true }));
    }

    const lines = block.split('\n');

    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) children.push('<w:r><w:br/></w:r>');

      for (const segment of parseMathSegments(line)) {
        if (segment.type === 'text') {
          if (segment.content) children.push(textRun(segment.content, runOpts));
        } else if (segment.display) {
          // A display equation cannot sit inside a run — close this paragraph,
          // emit the equation on its own, and continue in a fresh paragraph.
          if (children.length) {
            out.push(paragraph(children.join(''), styleId, paragraphPropsXml));
            children.length = 0;
          }
          out.push(paragraph(toOmmlParagraph(segment.content), styleId, paragraphPropsXml));
        } else {
          children.push(toOmmlRun(segment.content));
        }
      }
    });

    if (blockIndex === blocks.length - 1 && marks) {
      children.push('<w:r><w:tab/></w:r>', textRun(marks, { ...runOpts, bold: true }));
    }

    if (children.length) out.push(paragraph(children.join(''), styleId, paragraphPropsXml));
  });

  return out.join('');
}

/**
 * Convenience for docxtemplater users: the raw-XML module (`{@question}`)
 * expects a single string of block-level XML, which is exactly what
 * questionToDocxXml returns.
 *
 *   const doc = new Docxtemplater(zip, { modules: [new (require('docxtemplater-image-module-free'))()] });
 *   doc.render({ q1: questionToDocxXml(q.text, { number: '1.' }) });
 *
 * In the template, write {@q1} — not {q1} — or the XML is escaped and prints
 * as visible tags.
 */
export default questionToDocxXml;
