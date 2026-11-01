import { describe, expect, it, vi } from 'vitest';
import { QR_FILE_NAME, dataUrlToFile, isShareCancelled, needsShareToSave } from '@/lib/qr-download';

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

describe('needsShareToSave', () => {
  const file = dataUrlToFile(PNG);
  const share = () => Promise.resolve();

  it('uses the share sheet in the app installed from Safari on iPhone', () => {
    const canShare = vi.fn(() => true);
    expect(needsShareToSave({ standalone: true, canShare, share }, file)).toBe(true);
    expect(canShare).toHaveBeenCalledWith({ files: [file] });
  });

  it('keeps the regular download in a browser tab, on iPhone or elsewhere', () => {
    expect(needsShareToSave({ standalone: false, canShare: () => true, share }, file)).toBe(false);
    expect(needsShareToSave({ canShare: () => true, share }, file)).toBe(false);
  });

  it('keeps the download when the installed app cannot share files', () => {
    expect(needsShareToSave({ standalone: true }, file)).toBe(false);
    expect(needsShareToSave({ standalone: true, canShare: () => false, share }, file)).toBe(false);
    expect(needsShareToSave({ standalone: true, canShare: () => { throw new TypeError('no files'); }, share }, file)).toBe(false);
  });
});

describe('isShareCancelled', () => {
  it('treats only a closed share sheet as a cancellation', () => {
    expect(isShareCancelled(new DOMException('closed', 'AbortError'))).toBe(true);
    expect(isShareCancelled(new DOMException('blocked', 'NotAllowedError'))).toBe(false);
    expect(isShareCancelled(new Error('boom'))).toBe(false);
  });
});
