import type { CSSProperties } from 'react';
import { Slider } from '../ui/slider';

interface ImageComparisonProps {
  name: string;
  editedUrl: string;
  originalUrl?: string;
  width: number;
  height: number;
  position: number;
  onPositionChange: (position: number) => void;
}

export function ImageComparison({ name, editedUrl, originalUrl, width, height, position, onPositionChange }: ImageComparisonProps) {
  return (
    <div className="preview-media" style={{ '--preview-ratio': width / height, '--split': `${position}%` } as CSSProperties}>
      {/* Preview and comparison URLs point to local Blobs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="preview-image" src={editedUrl} alt={`Preview of ${name}`} draggable={false} />
      {originalUrl && (
        <>
          <div className="comparison-before">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={originalUrl} alt={`Original framing of ${name}`} draggable={false} />
          </div>
          <span className="comparison-label before-label" aria-hidden>Before</span>
          <span className="comparison-label after-label" aria-hidden>After</span>
          <span className="comparison-line" aria-hidden />
          <Slider className="comparison-slider" aria-label="Before and after split"
            value={[position]} onValueChange={([next]) => onPositionChange(next)} />
        </>
      )}
    </div>
  );
}
