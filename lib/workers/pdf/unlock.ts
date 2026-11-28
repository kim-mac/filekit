import createQpdf from '@neslinesli93/qpdf-wasm';

export async function unlockPdf(file: Blob, password: string) {
  const options = {
    locateFile: () => new URL('/workers/pdf/qpdf.wasm', self.location.origin).href,
    noInitialRun: true,
    print: () => {},
    printErr: () => {},
  };
  const module = await createQpdf(options);
  const fs = module.FS as typeof module.FS & { unlink(path: string): void };
  fs.mkdir('/original');
  fs.mount(module.WORKERFS, { blobs: [{ name: 'input', data: file }] }, '/original');
  try {
    module.callMain([`--password=${password}`, '--warning-exit-0', '--decrypt', '/original/input', '/output']);
    const bytes = fs.readFile('/output');
    try {
      return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    } finally {
      fs.unlink('/output');
    }
  } catch {
    throw new Error('This PDF opens with its password, but FileKit could not unlock it for editing.');
  } finally {
    fs.unmount('/original');
  }
}
