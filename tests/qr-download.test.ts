import { describe, expect, it } from 'vitest';
import { QR_FILE_NAME, dataUrlToFile } from '@/lib/qr-download';

// A 1×1 transparent PNG, the same shape `qrcode` returns.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('dataUrlToFile', () => {
  it('turns the QR data URL into a named PNG with the same bytes', async () => {
    const file = dataUrlToFile(PNG);
    expect(file.name).toBe(QR_FILE_NAME);
    expect(file.type).toBe('image/png');
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.length).toBe(atob(PNG.split(',')[1]).length);
  });
});
