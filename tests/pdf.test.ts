import { describe, expect, it } from 'vitest';
import { jpegPagePdf } from '@/lib/pdf';

/** Bytes that stand for a JPEG: start and end markers around arbitrary data, including bytes above 127. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x80, 0xfe, 0x0a, 0x28, 0xff, 0xd9]);

/** Latin-1 keeps one character per byte, so string offsets are byte offsets. */
const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

describe('jpegPagePdf', () => {
  const pdf = jpegPagePdf(JPEG, { width: 1181, height: 1772 }, { widthMm: 100, heightMm: 150 });
  const text = latin1(pdf);

  it('makes a PDF of one page of the given size in points', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 1');
    expect(text).toContain('/MediaBox [0 0 283.46 425.2]');
  });

  it('embeds the JPEG untouched as the page image, with its pixel size', () => {
    expect(text).toContain('/Width 1181 /Height 1772 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode');
    expect(text).toContain(`/Length ${JPEG.length} >>\nstream\n${latin1(JPEG)}\nendstream`);
    expect(text).toContain('q 283.46 0 0 425.2 0 0 cm /Poster Do Q');
  });

  it('points every cross-reference entry at its object, so readers open it without repairing it', () => {
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const table = /xref\n0 (\d+)\n([\s\S]*?)trailer/.exec(text.slice(startxref));
    const size = Number(table?.[1]);
    const entries = (table?.[2] ?? '').match(/.{20}/gs) ?? [];
    expect(entries).toHaveLength(size);
    expect(entries[0]).toBe('0000000000 65535 f \n');
    entries.slice(1).forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
    expect(text).toContain(`/Size ${size} /Root 1 0 R`);
  });
});
