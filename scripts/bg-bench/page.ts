import { releaseProxy, transfer, wrap } from 'comlink';
import models from './models.json';
import fixtures from '../../test/fixtures/bg/fixtures.json';
import type { Backend, BenchWorker, Fixture } from './protocol';

let worker: Worker | undefined;
let remote: ReturnType<typeof wrap<BenchWorker>> | undefined;

async function load(id: string, backend: Backend, requireHardware = false) {
  const model = models.find(item => item.id === id);
  if (!model) throw new Error(`Unknown model ${id}`);
  await close();
  worker = new Worker('/dev/bg-bench/bundle/worker.js', { type: 'module' });
  remote = wrap<BenchWorker>(worker);
  return remote.load(model, backend, requireHardware);
}

async function readFixture(path: string) {
  const response = await fetch(`/dev/bg-bench/fixtures/${path}`, { mode: 'same-origin' });
  if (!response.ok) throw new Error(`Fixture load failed: ${path} (HTTP ${response.status})`);
  return response.arrayBuffer();
}

async function predict(fixture: Fixture, repeats: number, refine: boolean) {
  if (!remote) throw new Error('Load a model first');
  const index = fixtures.findIndex(item => item.id === fixture.id);
  if (index === -1) throw new Error('Unknown fixture');
  const image = await readFixture(`${index}/image`);
  const truth = fixture.mask ? await readFixture(`${index}/alpha`) : null;
  return remote.predict(
    transfer(image, [image]), truth && transfer(truth, [truth]), fixture.id, repeats, refine && !!fixture.refine,
  );
}

async function close() {
  try {
    await remote?.close();
  } finally {
    remote?.[releaseProxy]();
    worker?.terminate();
    remote = undefined;
    worker = undefined;
  }
}

Object.assign(window, { bgBench: { load, predict, close } });

const form = document.querySelector('form')!;
const selector = document.querySelector<HTMLSelectElement>('#model')!;
const backend = document.querySelector<HTMLSelectElement>('#backend')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const results = document.querySelector<HTMLDivElement>('#results')!;
const button = form.querySelector('button')!;
const previews: string[] = [];
for (const model of models) {
  const name = model.shipEligible ? model.name : `${model.name} (reference only)`;
  selector.add(new Option(name, model.id));
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  for (const url of previews.splice(0)) URL.revokeObjectURL(url);
  results.replaceChildren();
  try {
    status.textContent = 'Loading model weights and starting the worker…';
    const auto = backend.value === 'auto';
    let activeBackend: Backend = auto ? 'webgpu' : backend.value as Backend;
    const model = selector.value;
    async function fallback(error: unknown) {
      if (!auto || activeBackend !== 'webgpu') throw error;
      activeBackend = 'wasm';
      status.textContent = 'WebGPU failed. Starting the WASM worker…';
      return load(model, activeBackend);
    }
    const start = performance.now();
    await load(model, activeBackend, auto).catch(fallback);
    const setupMs = Math.round(performance.now() - start);
    for (const fixture of fixtures) {
      status.textContent = `Processing ${fixture.id} using ${activeBackend}…`;
      const result = await predict(fixture, 1, false).catch(async error => {
        await fallback(error);
        return predict(fixture, 1, false);
      });
      const image = new Image();
      image.alt = `${fixture.id}, showing original, predicted mask, and checkerboard cutout`;
      image.src = URL.createObjectURL(result.baseline.row);
      previews.push(image.src);
      results.append(image);
    }
    status.textContent = `Completed ${fixtures.length} fixtures. Last backend: ${activeBackend}. Initial setup took ${setupMs} ms.`;
  } catch (error) {
    status.textContent = String(error);
  } finally {
    try {
      await close();
    } finally {
      button.disabled = false;
    }
  }
});
