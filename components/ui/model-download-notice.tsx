import type { ModelDownload } from '../../lib/core/contracts';
import { Notice } from './notice';
import { Progress } from './progress';

export function ModelDownloadNotice({ download }: { download: ModelDownload }) {
  const size = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(download.total / 1_000_000);
  return (
    <Notice>
      <p>One-time model download (~{size} MB). It’s saved on this device, so next time it starts instantly.</p>
      <Progress value={100 * download.loaded / download.total} aria-label="Model download progress" />
    </Notice>
  );
}
