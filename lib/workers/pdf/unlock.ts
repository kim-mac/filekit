import createQpdf from '@neslinesli93/qpdf-wasm';

async function rewritePdf(file: Blob, args: string[]) {
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
    const status = module.callMain([...args, '/original/input', '/output']);
    if (status !== 0) throw new Error('QPDF could not rewrite the PDF.');
    const bytes = fs.readFile('/output');
    try {
      return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    } finally {
      fs.unlink('/output');
    }
  } finally {
    fs.unmount('/original');
  }
}

export async function unlockPdf(file: Blob, password: string) {
  try {
    return await rewritePdf(file, [`--password=${password}`, '--warning-exit-0', '--decrypt']);
  } catch {
    throw new Error('This PDF opens with its password, but FileKit could not unlock it for editing.');
  }
}

export async function removeUnusedResources(file: Blob) {
  // The pages operation makes QPDF trim inherited/shared resource dictionaries.
  try {
    return await rewritePdf(file, ['--remove-unreferenced-resources=yes', '--pages', '.', '--']);
  } catch {
    throw new Error('Could not verify removal of unused PDF resources. The redacted file was not saved.');
  }
}
