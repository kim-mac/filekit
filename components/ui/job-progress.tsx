'use client';

import { useEffect, useRef, useState } from 'react';
import type { ModelDownload, ToolProgress } from '../../lib/core/contracts';
import { Notice } from './notice';
import { Progress } from './progress';

const megabyte = 2 ** 20;
const sizeFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const countFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function timeLabel(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function ProgressSummary({ message, className }: { message: string; className: string }) {
  const [announced, setAnnounced] = useState(message);
  const latest = useRef(message);
  useEffect(() => { latest.current = message; }, [message]);
  useEffect(() => {
    const timer = window.setInterval(() => setAnnounced(latest.current), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <p className={className} role="status">{announced}</p>;
}

function DownloadProgress({ download, className }: { download: ModelDownload; className: string }) {
  const { loaded, total, received = loaded } = download;
  const [start] = useState(() => ({ at: performance.now(), received }));
  const seconds = (performance.now() - start.at) / 1000;
  const transferred = received - start.received;
  const remaining = transferred > 0 && seconds >= .25
    ? Math.max(1, Math.ceil((total - loaded) * seconds / transferred))
    : undefined;
  const format = total >= 10 * megabyte ? countFormat : sizeFormat;
  const percent = Math.min(99, Math.floor(100 * loaded / total));
  const message = `Downloading model… ${format.format(loaded / megabyte)} / ${format.format(total / megabyte)} MB (${percent}%)`;

  return (
    <Notice announce={false}>
      <p>One-time model download (~{format.format(total / megabyte)} MB). It’s saved on this device.</p>
      <ProgressSummary message={message} className={className} />
      <Progress value={percent} aria-label="Model download progress" getValueLabel={() => message} />
      <p>{remaining ? `About ${timeLabel(remaining)} remaining` : 'Estimating time remaining…'}</p>
    </Notice>
  );
}

export function JobProgress({ update, label, statusClass = 'section-note', file }: {
  update: ToolProgress;
  label: string;
  statusClass?: string;
  file?: { index: number; total: number };
}) {
  const [started] = useState(() => performance.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.floor((performance.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [started]);
  const { step, totalSteps, tiles, download } = update;
  const stepValue = (step - 1) / totalSteps;
  const tileValue = tiles ? Math.floor(100 * tiles.done / tiles.total) : 0;
  const value = tiles ? tileValue : Math.floor(100 * (file ? (file.index - 1 + stepValue) / file.total : stepValue));
  const message = tiles ? `Tile ${tiles.done} of ${tiles.total}, ${tileValue}%` : `Step ${step} of ${totalSteps}: ${update.message}`;
  const summary = file && file.total > 1 ? `File ${file.index} of ${file.total} · ${message}` : message;
  if (download && download.loaded < download.total) {
    return <DownloadProgress key={download.id} download={download} className={statusClass} />;
  }
  return (
    <div className="job-progress">
      <div className="progress-meta">
        <ProgressSummary key={`${file?.index}-${step}-${Boolean(tiles)}-${tiles?.done === tiles?.total}`}
          message={summary} className={statusClass} />
        <span className="section-note">{timeLabel(elapsed)}<span className="sr-only"> elapsed</span></span>
      </div>
      <Progress aria-label={label} getValueLabel={() => summary} value={value} />
    </div>
  );
}
