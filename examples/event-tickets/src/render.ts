import { crc32, deflateSync } from 'node:zlib';
import { encode } from 'uqr';

/**
 * Ticket rendering with no native dependencies: a QR matrix (uqr), a PNG written by hand
 * (node:zlib for deflate and CRC-32), and a one-page PDF drawn with vector rectangles and the
 * PDF standard Helvetica font. WhatsApp fetches both from the demo server by URL.
 */

/** QR modules: `true` is dark. Error correction M survives a cracked phone screen. */
export function qrMatrix(text: string): boolean[][] {
  return encode(text, { ecc: 'M', border: 0 }).data;
}

/** A crisp black-on-white PNG of the QR code with a 4-module quiet zone. */
export function qrPng(text: string, moduleSize = 12): Buffer {
  const modules = qrMatrix(text);
  const quiet = 4;
  const size = (modules.length + quiet * 2) * moduleSize;
  const row = Buffer.alloc(1 + size);
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y += 1) {
    row.fill(255);
    row[0] = 0; // filter: none
    const my = Math.floor(y / moduleSize) - quiet;
    for (let x = 0; x < size; x += 1) {
      const mx = Math.floor(x / moduleSize) - quiet;
      if (modules[my]?.[mx] === true) {
        row[1 + x] = 0;
      }
    }
    rows.push(Buffer.from(row));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

export interface TicketPdfInput {
  readonly title: string;
  readonly kind: string;
  readonly when: string;
  readonly venue: string;
  readonly holder: string;
  readonly tier: string;
  readonly admits: number;
  readonly bookingId: string;
  readonly total: string;
  readonly qrText: string;
}

/** A6 portrait, in points. */
const PAGE = { width: 298, height: 420 } as const;

/** A one-page PDF ticket: header band, details, the QR code drawn as vector squares. */
export function ticketPdf(input: TicketPdfInput): Buffer {
  const ops: string[] = [];
  const text = (font: 'F1' | 'F2', size: number, x: number, y: number, value: string, grey = 0.1) => {
    ops.push(`${grey} g BT /${font} ${size} Tf ${x} ${y} Td (${pdfString(value)}) Tj ET`);
  };

  // Header band.
  ops.push('0.067 0.369 0.235 rg', `0 ${PAGE.height - 92} ${PAGE.width} 92 re f`);
  ops.push('1 g');
  let y = PAGE.height - 30;
  ops.push(`BT /F1 9 Tf 20 ${y} Td (${pdfString(input.kind.toUpperCase())}) Tj ET`);
  for (const line of wrap(input.title, 26).slice(0, 2)) {
    y -= 22;
    ops.push(`BT /F2 18 Tf 20 ${y} Td (${pdfString(line)}) Tj ET`);
  }

  // Details.
  y = PAGE.height - 118;
  const field = (label: string, value: string) => {
    text('F1', 7.5, 20, y, label.toUpperCase(), 0.45);
    y -= 13;
    for (const line of wrap(value, 44).slice(0, 2)) {
      text('F2', 10.5, 20, y, line);
      y -= 13;
    }
    y -= 6;
  };
  field('When', input.when);
  field('Where', input.venue);
  field('Ticket holder', `${input.holder} · ${input.tier} · Admit ${input.admits}`);

  // QR code, centred in the lower half.
  const modules = qrMatrix(input.qrText);
  const qrSize = 132;
  const cell = qrSize / modules.length;
  const left = (PAGE.width - qrSize) / 2;
  const top = 38 + qrSize;
  ops.push('0 g');
  modules.forEach((row, my) => {
    row.forEach((dark, mx) => {
      if (dark) {
        ops.push(
          `${(left + mx * cell).toFixed(2)} ${(top - (my + 1) * cell).toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re`,
        );
      }
    });
  });
  ops.push('f');
  text('F2', 9, 20, 22, `Booking ${input.bookingId} · ${input.total}`);
  text('F1', 7, 20, 12, 'Show this QR code at the entrance. Powered by LazyApp.', 0.45);

  const content = deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    { dict: `<< /Length ${content.length} /Filter /FlateDecode >>`, stream: content },
  ]);
}

type PdfObject = string | { readonly dict: string; readonly stream: Buffer };

/** Serialises numbered objects with a correct cross-reference table. */
function buildPdf(objects: readonly PdfObject[]): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets: number[] = [];
  let length = parts[0]?.length ?? 0;
  objects.forEach((object, index) => {
    offsets.push(length);
    const body =
      typeof object === 'string'
        ? Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'latin1')
        : Buffer.concat([
            Buffer.from(`${index + 1} 0 obj\n${object.dict}\nstream\n`, 'latin1'),
            object.stream,
            Buffer.from('\nendstream\nendobj\n', 'latin1'),
          ]);
    parts.push(body);
    length += body.length;
  });
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(length),
    '%%EOF\n',
  ].join('\n');
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

/**
 * Text for a PDF string in WinAnsi: escapes `\ ( )`, maps the typography this demo uses
 * (·, –, ’, ₹) to WinAnsi or ASCII, and drops anything else rather than printing garbage.
 */
export function pdfString(value: string): string {
  const mapped = value
    .replace(/₹\s?/g, 'Rs ')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/×/g, 'x');
  let out = '';
  for (const char of mapped) {
    if (char === '·') {
      out += '\\267';
    } else if (char === '\\' || char === '(' || char === ')') {
      out += `\\${char}`;
    } else if (/^[\x20-\x7E]$/.test(char)) {
      out += char;
    }
  }
  return out;
}

/** Greedy word wrap at `width` characters. */
export function wrap(value: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of value.split(/\s+/)) {
    if (line === '') {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') {
    lines.push(line);
  }
  return lines;
}
