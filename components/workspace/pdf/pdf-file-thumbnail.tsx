import { FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PageRef } from '../../../lib/tools/pdf/pages';
import type { PreviewResult } from '../../../lib/workers/pdf/types';
import { useObjectUrl } from '../use-object-url';

export function PdfFileThumbnail({ page, render }: {
  page: PageRef;
  render: (page: PageRef, edge: number) => Promise<PreviewResult>;
}) {
  const tile = useRef<HTMLSpanElement>(null);
  // The cover's render key remounts the component when its content changes.
  const [cover] = useState(page);
  const [blob, setBlob] = useState<Blob>();
  const url = useObjectUrl(blob);

  useEffect(() => {
    let active = true;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || !active) return;
      observer.disconnect();
      void render(cover, 160).then(result => {
        if (active) setBlob(result.blob);
      }, () => {}); // Keep the placeholder if the worker cannot render the cover.
    });
    observer.observe(tile.current!);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [cover, render]);

  return <span className="pdf-file-thumbnail" ref={tile}>
    {url ? <img src={url} alt="" draggable={false} /> : <FileText size={21} aria-hidden />}
  </span>;
}
