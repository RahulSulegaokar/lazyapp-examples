/**
 * A dependency-free writer for small, good-looking PDF documents: brochures, guides,
 * receipts. Examples render them once (`npm run assets`) into `examples/<id>/public/`,
 * and the demo server hosts them at `/public/<id>/<file>` for WhatsApp document messages.
 *
 * Scope is deliberately small: A4 pages, Helvetica (the PDF base font, so nothing is
 * embedded), a coloured title band, headings, paragraphs, bullet lists and two-column
 * tables, with word wrapping and automatic page breaks. Text is WinAnsi: `₹` becomes
 * `Rs.` and other characters outside Latin-1 are replaced.
 */

export type Rgb = readonly [number, number, number];

export type PdfBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'bullets'; readonly items: readonly string[] }
  | { readonly kind: 'table'; readonly rows: readonly (readonly [string, string])[] }
  | { readonly kind: 'note'; readonly text: string }
  | { readonly kind: 'spacer'; readonly height?: number };

export interface PdfDocument {
  readonly title: string;
  readonly subtitle?: string;
  /** Title band colour (0–1 per channel). */
  readonly accent?: Rgb;
  readonly blocks: readonly PdfBlock[];
  /** Small print at the bottom of every page. */
  readonly footer?: string;
}

const PAGE = { width: 595, height: 842, margin: 56 } as const;
const BAND_HEIGHT = 132;
const INK: Rgb = [0.13, 0.15, 0.18];
const MUTED: Rgb = [0.42, 0.45, 0.5];

/** Helvetica advance widths (1/1000 em) for ASCII 32–126, from the Adobe AFM. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
  500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469,
  556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
] as const;

/** Width of `text` in points at `size`. Bold is ~5% wider than regular. */
export function textWidth(text: string, size: number, bold = false): number {
  let units = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    units += HELVETICA_WIDTHS[code - 32] ?? 556;
  }
  return (units * size * (bold ? 1.05 : 1)) / 1000;
}

/** Maps text onto the PDF's WinAnsi encoding (₹ → Rs., typographic punctuation → ASCII). */
export function toPdfText(text: string): string {
  return text
    .replace(/₹\s?/g, 'Rs. ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[·•]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e]/g, '');
}

/** Greedy word wrap to `maxWidth` points. */
export function wrapText(text: string, size: number, maxWidth: number, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of toPdfText(text).split(/\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter((entry) => entry !== '')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (line !== '' && textWidth(candidate, size, bold) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

interface PageContent {
  readonly ops: string[];
}

/** Renders the document to PDF 1.4 bytes. */
export function renderPdf(doc: PdfDocument): Uint8Array {
  const accent = doc.accent ?? [0.05, 0.42, 0.36];
  const contentWidth = PAGE.width - PAGE.margin * 2;
  const pages: PageContent[] = [];
  let page: PageContent = { ops: [] };
  let y = 0;

  const newPage = (first: boolean): void => {
    page = { ops: [] };
    pages.push(page);
    if (first) {
      page.ops.push(fill(accent), `0 ${PAGE.height - BAND_HEIGHT} ${PAGE.width} ${BAND_HEIGHT} re f`);
      text(page, doc.title, PAGE.margin, PAGE.height - 70, 26, true, [1, 1, 1]);
      if (doc.subtitle !== undefined) {
        text(page, doc.subtitle, PAGE.margin, PAGE.height - 98, 12, false, [0.92, 0.96, 0.95]);
      }
      y = PAGE.height - BAND_HEIGHT - 36;
    } else {
      y = PAGE.height - PAGE.margin;
    }
    if (doc.footer !== undefined) {
      text(page, doc.footer, PAGE.margin, 32, 8, false, MUTED);
    }
  };
  const ensure = (height: number): void => {
    if (y - height < PAGE.margin) {
      newPage(false);
    }
  };

  newPage(true);
  for (const block of doc.blocks) {
    switch (block.kind) {
      case 'heading':
        ensure(40);
        y -= 10;
        text(page, block.text, PAGE.margin, y, 15, true, accent);
        y -= 22;
        break;
      case 'paragraph':
      case 'note': {
        const size = block.kind === 'note' ? 9 : 11;
        for (const line of wrapText(block.text, size, contentWidth)) {
          ensure(size + 6);
          text(page, line, PAGE.margin, y, size, false, block.kind === 'note' ? MUTED : INK);
          y -= size + 5;
        }
        y -= 8;
        break;
      }
      case 'bullets':
        for (const item of block.items) {
          const lines = wrapText(item, 11, contentWidth - 16);
          ensure(16 * lines.length);
          page.ops.push(fill(accent), `${PAGE.margin + 1} ${y + 2} 4 4 re f`);
          for (const line of lines) {
            text(page, line, PAGE.margin + 16, y, 11, false, INK);
            y -= 16;
          }
        }
        y -= 8;
        break;
      case 'table':
        for (const [index, [label, value]] of block.rows.entries()) {
          const lines = wrapText(value, 11, contentWidth * 0.6 - 8, true);
          const height = 10 + 15 * lines.length;
          ensure(height);
          if (index % 2 === 0) {
            page.ops.push(
              fill([0.95, 0.97, 0.96]),
              `${PAGE.margin} ${y - height + 14} ${contentWidth} ${height} re f`,
            );
          }
          text(page, label, PAGE.margin + 8, y, 11, false, MUTED);
          for (const [lineIndex, line] of lines.entries()) {
            text(page, line, PAGE.margin + contentWidth * 0.4, y - lineIndex * 15, 11, true, INK);
          }
          y -= height;
        }
        y -= 10;
        break;
      case 'spacer':
        y -= block.height ?? 12;
        break;
    }
  }

  return serialize(pages, toPdfText(doc.title));
}

function fill([r, g, b]: Rgb): string {
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`;
}

function text(
  page: PageContent,
  value: string,
  x: number,
  y: number,
  size: number,
  bold: boolean,
  colour: Rgb,
): void {
  const escaped = toPdfText(value).replace(/[\\()]/g, (char) => `\\${char}`);
  page.ops.push(
    `BT ${fill(colour)} /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${escaped}) Tj ET`,
  );
}

/** Writes objects, the cross-reference table and the trailer. Offsets are byte-exact (Latin-1). */
function serialize(pages: readonly PageContent[], title: string): Uint8Array {
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  const catalog = add('');
  const pagesRoot = add('');
  const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const info = add(
    `<< /Title (${title.replace(/[\\()]/g, (char) => `\\${char}`)}) /Producer (lazyapp-examples) >>`,
  );
  const kids: number[] = [];
  for (const page of pages) {
    const stream = page.ops.join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
          `/Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
  objects[pagesRoot - 1] =
    `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(out, 'latin1'));
}
