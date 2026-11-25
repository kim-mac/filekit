import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import fixtures from '../../test/fixtures/bg/fixtures.json' with { type: 'json' };
import models from './models.json' with { type: 'json' };
import bg0Models from './bg0-models.json' with { type: 'json' };
import { startServer } from './server.mjs';

const { values } = parseArgs({ options: {
  models: { type: 'string' }, backends: { type: 'string' }, fixtures: { type: 'string' },
  refine: { type: 'string', default: '' }, out: { type: 'string', default: '.cache/bg-bench/results' },
  repeats: { type: 'string', default: '3' }, 'timeout-ms': { type: 'string', default: '300000' },
  'software-webgpu': { type: 'boolean' },
} });

function select(requested, choices) {
  const ids = requested?.split(',') ?? choices;
  for (const id of ids) {
    if (!choices.includes(id)) throw new Error(`Unknown selection: ${id}`);
  }
  return [...new Set(ids)];
}

const candidates = [...models, ...bg0Models];
const modelIds = candidates.map(model => model.id);
const selectedModels = select(values.models, modelIds);
const selectedBackends = select(values.backends, ['wasm', 'webgpu']);
const selectedFixtures = select(values.fixtures, fixtures.map(fixture => fixture.id));
const refinedModels = values.refine ? select(values.refine, modelIds) : [];
const repeats = Number(values.repeats);
const timeoutMs = Number(values['timeout-ms']);
if (!Number.isSafeInteger(repeats) || repeats < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
  throw new Error('Repeats and timeout must be positive integers');
}
const out = resolve(values.out);
const softwareWebgpu = Boolean(values['software-webgpu']);

// Linux process PSS counts shared pages proportionally and observes WASM/native
// allocations as well as JS. GPU-device memory on hardware is outside this sample.
function processTreePss(root) {
  try {
    const children = new Map();
    for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      let stat;
      try {
        stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      } catch { continue; } // The process exited between directory and file reads.
      const parent = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(Number(pid));
    }
    let bytes = 0;
    const queue = [root];
    for (const pid of queue) {
      queue.push(...(children.get(pid) ?? []));
      try {
        const pss = /^Pss:\s+(\d+) kB$/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
        if (!pss) return null;
        bytes += Number(pss[1]) * 1024;
      } catch (error) {
        if (pid === root || !['ENOENT', 'ESRCH'].includes(error.code)) return null;
      }
    }
    return bytes;
  } catch {
    return null;
  }
}

function sampleMemory(pid) {
  const baselineBytes = platform() === 'linux' ? processTreePss(pid) : null;
  let peakBytes = baselineBytes;
  let samples = Number(baselineBytes !== null);
  if (baselineBytes === null) return { stop: () => null };
  function sample() {
    const current = processTreePss(pid);
    if (current === null) return;
    peakBytes = Math.max(peakBytes, current);
    samples++;
  }
  const timer = setInterval(sample, 250);
  return {
    stop() {
      clearInterval(timer);
      sample();
      return { method: 'browsertree-linux-pss-250ms', baselineBytes, peakBytes, peakDeltaBytes: peakBytes - baselineBytes, samples };
    },
  };
}

async function withTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function benchmark(baseUrl, model, backend) {
  const dir = join(out, backend, model.id);
  const maskDir = join(dir, 'masks');
  const rowDir = join(dir, 'rows');
  await mkdir(maskDir, { recursive: true });
  await mkdir(rowDir, { recursive: true });
  const args = backend === 'webgpu' && softwareWebgpu
    ? ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] : [];
  const result = { model: model.id, backend, browser: null, load: null, memory: null, fixtures: [], errors: [] };
  const rows = [];
  const refinementRows = [];
  let browserServer;
  let memory;
  try {
    browserServer = await chromium.launchServer({ executablePath: process.env.BG_CHROMIUM, args });
    const browser = await chromium.connect(browserServer.wsEndpoint());
    result.browser = browser.version();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const requestViolations = [];
    const origin = new URL(baseUrl).origin;
    await context.route('**/*', route => {
      const request = route.request();
      if (new URL(request.url()).origin === origin && request.method() === 'GET' && !request.postData()) {
        return route.continue();
      }
      requestViolations.push(request.url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on('console', message => {
      if (message.type() === 'warning' || message.type() === 'error') {
        console.error(`[${backend}/${model.id}] ${message.text()}`);
      }
    });
    await page.goto(baseUrl);
    await page.waitForFunction(() => Boolean(window.bgBench));
    memory = sampleMemory(browserServer.process().pid);

    result.load = await withTimeout(page.evaluate(({ id, ep }) => window.bgBench.load(id, ep),
      { id: model.id, ep: backend }), 'Model load');
    console.log(`${backend}/${model.id} loaded in ${Math.round(result.load.loadMs)} ms`);
    for (const fixture of fixtures.filter(item => selectedFixtures.includes(item.id))) {
      try {
        const prediction = await withTimeout(page.evaluate(async ({ item, count, refine }) => {
          const { baseline, guided, decontaminatedRow, ...numbers } = await window.bgBench.predict(item, count, refine);
          async function encode(blob) {
            const url = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () => reject(reader.error);
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
            return url.split(',')[1];
          }
          async function serialize(variant) {
            return { scores: variant.scores, mask: await encode(variant.mask), row: await encode(variant.row) };
          }
          return { ...numbers, baseline: await serialize(baseline), guided: guided && await serialize(guided),
            decontaminatedRow: decontaminatedRow && await encode(decontaminatedRow) };
        }, { item: fixture, count: repeats, refine: refinedModels.includes(model.id) }), fixture.id);
        const baselineRow = Buffer.from(prediction.baseline.row, 'base64');
        await writeFile(join(maskDir, `${fixture.id}.png`), Buffer.from(prediction.baseline.mask, 'base64'));
        await writeFile(join(rowDir, `${fixture.id}.png`), baselineRow);
        rows.push(baselineRow);
        if (prediction.guided) {
          const guidedRow = Buffer.from(prediction.guided.row, 'base64');
          const cleanedRow = Buffer.from(prediction.decontaminatedRow, 'base64');
          await writeFile(join(maskDir, `${fixture.id}-guided.png`), Buffer.from(prediction.guided.mask, 'base64'));
          refinementRows.push(baselineRow, guidedRow, cleanedRow);
        }
        result.fixtures.push({
          id: fixture.id, timingsMs: prediction.timingsMs, scores: prediction.baseline.scores,
          guidedScores: prediction.guided?.scores ?? null, refinementMs: prediction.refinementMs,
        });
        console.log(`  ${fixture.id}: ${prediction.timingsMs.map(Math.round).join(', ')} ms`);
      } catch (error) {
        result.errors.push({ fixture: fixture.id, error: String(error) });
        console.error(`  ${fixture.id}: ${error}`);
        // A timed-out or crashed worker cannot process another fixture.
        if (/timed out|crashed|closed/i.test(String(error))) break;
      }
    }
    if (requestViolations.length) result.errors.push({ stage: 'network', blocked: requestViolations });
  } catch (error) {
    result.errors.push({ stage: 'load', error: String(error) });
    console.error(`${backend}/${model.id}: ${error}`);
  } finally {
    result.memory = memory?.stop() ?? null;
    await browserServer?.kill();
    await writeFile(join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  }

  async function sheets(input, rowsPerPage, prefix) {
    if (!input.length) return;
    const { width, height } = await sharp(input[0]).metadata();
    for (let offset = 0; offset < input.length; offset += rowsPerPage) {
      const page = input.slice(offset, offset + rowsPerPage);
      await sharp({ create: { width, height: height * page.length, channels: 3, background: '#171b22' } })
        .composite(page.map((input, i) => ({ input, left: 0, top: height * i })))
        .png().toFile(join(dir, `${prefix}-${1 + offset / rowsPerPage}.png`));
    }
  }
  await sheets(rows, 5, 'comparison');
  await sheets(refinementRows, 6, 'refinement');
  return result;
}

await mkdir(out, { recursive: true });
const { server, url } = await startServer();
const report = {
  environment: { platform: platform(), kernel: release(), arch: arch(), cpu: cpus()[0]?.model,
    logicalCpuCount: cpus().length, softwareWebgpu, wasmThreads: 1,
    ort: JSON.parse(await readFile(new URL('../../node_modules/onnxruntime-web/package.json', import.meta.url), 'utf8')).version },
  repeats, results: [],
};
try {
  for (const backend of selectedBackends) {
    for (const model of candidates.filter(item => selectedModels.includes(item.id))) {
      const result = await benchmark(url, model, backend);
      report.results.push(result);
      await writeFile(join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    }
  }
} finally {
  server.close();
}
if (report.results.some(result => result.errors.length)) process.exitCode = 1;
