import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveFile } from './save-file.ts';

describe('saveFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('descarga el archivo con su nombre por un enlace temporal y después libera la dirección', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:sire');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const clicked: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });
    const file = new Blob(['línea\r\n'], { type: 'text/plain' });

    saveFile(file, 'SIRE_3f9a1c7b.txt');

    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(clicked).toEqual([
      { href: 'blob:sire', download: 'SIRE_3f9a1c7b.txt' },
    ]);
    // El enlace no se queda en la página.
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:sire');
  });
});
