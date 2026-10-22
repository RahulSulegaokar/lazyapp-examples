import { describe, expect, it } from 'vitest';
import { publicAssetUrl, renderPdf, textWidth, toPdfText, wrapText } from '../src/index.js';

describe('renderPdf', () => {
  const pdf = Buffer.from(
    renderPdf({
      title: 'Brickfield (Aurora)',
      subtitle: 'Whitefield · ₹92 L',
      footer: 'Demo',
      blocks: [
        { kind: 'heading', text: 'At a glance' },
        { kind: 'table', rows: [['Price', '₹92 L']] },
        { kind: 'bullets', items: ['Metro – 8 min', 'Pool'] },
        { kind: 'paragraph', text: 'word '.repeat(2000) },
        { kind: 'note', text: 'Illustrative.' },
      ],
    }),
  ).toString('latin1');

  it('writes a well-formed PDF with an exact cross-reference table', () => {
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    offsets.forEach((offset, index) => {
      expect(pdf.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    });
  });

  it('breaks long content onto more pages and escapes text', () => {
    expect(Number(/\/Count (\d+)/.exec(pdf)?.[1])).toBeGreaterThan(1);
    expect(pdf).toContain('(Brickfield \\(Aurora\\)) Tj');
    expect(pdf).toContain('Rs. 92 L');
  });
});

describe('PDF text helpers', () => {
  it('maps text to WinAnsi', () => {
    expect(toPdfText('₹1,048 · “quoted” — ok…')).toBe('Rs. 1,048 - "quoted" - ok...');
  });

  it('wraps to the width it is given', () => {
    const lines = wrapText('the quick brown fox jumps over the lazy dog', 11, 80);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      expect(textWidth(line, 11)).toBeLessThanOrEqual(80);
    }
  });
});

describe('publicAssetUrl', () => {
  it('builds the demo server URL and refuses names it would not serve', () => {
    expect(publicAssetUrl('https://demo.test/', 'real-estate', 'brochure.pdf')).toBe(
      'https://demo.test/public/real-estate/brochure.pdf',
    );
    expect(() => publicAssetUrl('https://demo.test', 'x', '../secret.pdf')).toThrow();
    expect(() => publicAssetUrl('https://demo.test', 'x', 'script.js')).toThrow();
  });
});
