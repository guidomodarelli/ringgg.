/** PDF lengths are in points, 72 per inch. */
const POINTS_PER_INCH = 72;
const MM_PER_INCH = 25.4;
/** Page sizes keep two decimals. */
const POINT_PRECISION = 100;
/** Cross-reference offsets are written with this many digits. */
const OFFSET_DIGITS = 10;
/** The objects of the file, in the order they are written. */
const OBJECTS = { catalog: 1, pages: 2, page: 3, image: 4, content: 5 };

/** A PDF number for a length in millimeters. */
function points(millimeters: number) {
  return String(Math.round((millimeters * POINTS_PER_INCH * POINT_PRECISION) / MM_PER_INCH) / POINT_PRECISION);
}

const reference = (id: number) => `${id} 0 R`;

/**
 * A one-page PDF of `widthMm × heightMm` whose page is a JPEG image, edge to edge. Browsers encode
 * JPEGs as baseline JFIF, which PDF readers decode as is (`DCTDecode`), so the image needs no re-encoding.
 */
export function jpegPagePdf(jpeg: Uint8Array, image: { width: number; height: number }, page: { widthMm: number; heightMm: number }) {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, ...body: (string | Uint8Array)[]) => {
    offsets[id] = length;
    write(`${id} 0 obj\n`);
    body.forEach(write);
    write('\nendobj\n');
  };
  const width = points(page.widthMm);
  const height = points(page.heightMm);
  const content = `q ${width} 0 0 ${height} 0 0 cm /Poster Do Q`;
  // The second line marks the file as binary for the tools that sniff it.
  write('%PDF-1.4\n%âãÏÓ\n');
  object(OBJECTS.catalog, `<< /Type /Catalog /Pages ${reference(OBJECTS.pages)} >>`);
  object(OBJECTS.pages, `<< /Type /Pages /Kids [${reference(OBJECTS.page)}] /Count 1 >>`);
  object(OBJECTS.page, `<< /Type /Page /Parent ${reference(OBJECTS.pages)} /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Poster ${reference(OBJECTS.image)} >> >> /Contents ${reference(OBJECTS.content)} >>`);
  object(OBJECTS.image, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream');
  object(OBJECTS.content, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const crossReference = length;
  // Every entry takes exactly 20 bytes: a 10-digit offset, a 5-digit generation, its type and a two-byte end of line.
  const entries = offsets.slice(1).map((offset) => `${String(offset).padStart(OFFSET_DIGITS, '0')} 00000 n \n`).join('');
  write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${offsets.length} /Root ${reference(OBJECTS.catalog)} >>\nstartxref\n${crossReference}\n%%EOF\n`);
  const pdf = new Uint8Array(length);
  let position = 0;
  for (const part of parts) { pdf.set(part, position); position += part.length; }
  return pdf;
}
