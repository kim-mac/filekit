import { Info } from 'lucide-react';
import { Popover } from 'radix-ui';
import { outputFormats } from '../../lib/tools/image/formats';
import type { ImageInfo } from '../../lib/workers/image/types';
import { Button } from '../ui/button';

export function ImageDetails({ info }: { info: ImageInfo }) {
  const details = info.details;
  const data = [
    ['Format', info.format === 'heic' ? 'HEIC' : outputFormats[info.format].label],
    ['Color mode', details?.colorMode ?? 'Unknown'],
    ['Bit depth', details?.bitDepth ? `${details.bitDepth} bit` : 'Unknown'],
    ['Transparency', (details?.transparent ?? info.hasAlpha) ? 'Yes' : 'No'],
    ['Camera make', details?.cameraMake],
    ['Camera model', details?.cameraModel],
    ['Date taken', details?.taken],
    ['Color profile', details?.profile],
  ];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button type="button" variant="outline" size="sm"><Info aria-hidden /> Details</Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="image-details" aria-label="Original image details" align="start" sideOffset={8} collisionPadding={12}>
          <dl>
            {data.map(([label, value]) => value && <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          {details?.hasLocation && <p className="section-note">Contains location data — removed on export.</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
