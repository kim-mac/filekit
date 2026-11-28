import { Info } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useEffect, useState } from 'react';
import type { PageSize } from '../../../lib/tools/pdf/layout';
import type { PageRef } from '../../../lib/tools/pdf/pages';
import { formatBytes } from '../../../lib/tools/image/size-estimate';
import { Button } from '../../ui/button';
import type { PdfEntry } from './use-pdf-documents';

const points = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function PdfDetails({ entry, count, page, bytes, getSize }: {
  entry: PdfEntry;
  count: number;
  page: PageRef;
  bytes?: number;
  getSize: (page: PageRef) => Promise<PageSize>;
}) {
  const [open, setOpen] = useState(false);
  const [dimensions, setDimensions] = useState<{ page: PageRef; size?: PageSize }>();
  const size = dimensions?.page === page ? dimensions.size : undefined;
  const details = entry.details;
  useEffect(() => {
    if (!open) return;
    let current = true;
    void getSize(page).then(size => {
      if (current) setDimensions({ page, size });
    }, () => {
      if (current) setDimensions({ page });
    });
    return () => { current = false; };
  }, [open, page, getSize]);
  const data = [
    ['Pages', String(count)],
    ['Page size', size ? `${points.format(size.width)} × ${points.format(size.height)} pt`
      : dimensions?.page === page ? 'Unavailable' : 'Reading…'],
    ['PDF version', details?.version ?? (entry.kind === 'pdf' ? 'Unknown' : 'New PDF')],
    ['Encrypted', details?.encrypted ? 'Yes' : 'No'],
    ['Has forms', details?.forms ? 'Yes' : 'No'],
    ['Title', details?.title ?? '—'],
    ['Author', details?.author ?? '—'],
    ['Producer', details?.producer ?? '—'],
    ['File size', bytes === undefined ? 'Available after export' : formatBytes(bytes)],
  ];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild><Button type="button" variant="outline" size="sm"><Info aria-hidden /> Details</Button></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="image-details" aria-label="PDF document details" align="start" sideOffset={8} collisionPadding={12}>
          <dl>{data.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
