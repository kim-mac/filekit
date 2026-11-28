import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { pageRenderKey, type PageRef } from '../../../lib/tools/pdf/pages';
import type { PreviewResult } from '../../../lib/workers/pdf/types';
import { Button } from '../../ui/button';
import { Notice } from '../../ui/notice';
import { useObjectUrl } from '../use-object-url';
import { usePreviewView } from '../use-preview-view';
import { PdfEditLayer } from './pdf-edit-layer';
import type { PdfEditor } from './use-pdf-editor';

export function SinglePage({ page, number, render, editor }: {
  page: PageRef;
  number: number;
  render: (page: PageRef, edge: number) => Promise<PreviewResult>;
  editor: PdfEditor;
}) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<{ key: string; value?: PreviewResult }>();
  const key = pageRenderKey(page);
  const current = preview?.key === key ? preview : undefined;
  const pageRef = useRef(page);
  pageRef.current = page;
  const value = current?.value;
  const url = useObjectUrl(value?.blob);
  const viewport = usePreviewView(stage, value?.size, page.id);
  useEffect(() => {
    let live = true;
    void render(pageRef.current, 2048).then(result => {
      if (live) setPreview({ key, value: result });
    }, () => {
      if (live) setPreview({ key });
    });
    return () => { live = false; };
  }, [key, render]);
  return <>
    <div ref={setStage} className={`preview-stage pdf-single ${url ? 'is-loaded' : ''} ${viewport.panning ? 'is-panning' : ''}`}
      aria-busy={!current}>
      {url && value && <div className="preview-plane" style={{
        transform: `translate(${viewport.view.x}px, ${viewport.view.y}px) scale(${viewport.view.scale})`,
      }}>
        <div className="preview-media" style={{ '--preview-ratio': value.size.width / value.size.height } as CSSProperties}>
          <img src={url} alt={`Preview of page ${number}`} draggable={false} />
          <PdfEditLayer key={page.id} editor={editor} preview={value} />
        </div>
      </div>}
      {!current && <p className="section-note" role="status">Rendering page {number}…</p>}
      {current && !value && <Notice variant="error">This page preview is unavailable. Try another page or export the PDF.</Notice>}
    </div>
    {url && <div className="zoom-controls" role="group" aria-label="Preview zoom">
      <Button type="button" size="icon" variant="ghost" aria-label="Zoom out" title="Zoom out" onClick={() => viewport.zoom(.8)}><Minus aria-hidden /></Button>
      <output aria-label="Zoom percentage">{viewport.percent}%</output>
      <Button type="button" size="icon" variant="ghost" aria-label="Zoom in" title="Zoom in" onClick={() => viewport.zoom(1.25)}><Plus aria-hidden /></Button>
      <Button type="button" size="sm" variant="outline" aria-pressed={viewport.atFit} onClick={viewport.reset}>Fit</Button>
      <Button type="button" size="sm" variant="outline" aria-pressed={viewport.atActualSize} onClick={viewport.actual}>100%</Button>
    </div>}
  </>;
}
