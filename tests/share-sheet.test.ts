import { describe, expect, it, vi } from 'vitest';
import { isInstalledAppleApp, isShareCancelled, needsShareToSave } from '@/lib/share-sheet';

const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'ringgg-cartel.pdf', { type: 'application/pdf' });
const share = () => Promise.resolve();

describe('isInstalledAppleApp', () => {
  it('recognizes only the app installed from Safari, where printing and downloads do nothing', () => {
    expect(isInstalledAppleApp({ standalone: true })).toBe(true);
    expect(isInstalledAppleApp({ standalone: false })).toBe(false);
    expect(isInstalledAppleApp({})).toBe(false);
  });
});

describe('needsShareToSave', () => {
  it('uses the share sheet in the app installed from Safari on iPhone', () => {
    const canShare = vi.fn(() => true);
    expect(needsShareToSave({ standalone: true, canShare, share }, file)).toBe(true);
    expect(canShare).toHaveBeenCalledWith({ files: [file] });
  });

  it('keeps the regular download or print in a browser tab, on iPhone or elsewhere', () => {
    expect(needsShareToSave({ standalone: false, canShare: () => true, share }, file)).toBe(false);
    expect(needsShareToSave({ canShare: () => true, share }, file)).toBe(false);
  });

  it('says no when the installed app cannot share files', () => {
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
