import { Download, Image, LoaderCircle, X } from 'lucide-react';
import { Button } from '../ui/button';
import { useObjectUrl } from './use-object-url';

interface FileTileProps {
  name: string;
  thumbnail?: Blob;
  selected: boolean;
  status: string;
  processing: boolean;
  error?: string;
  disabled: boolean;
  ready: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onRemove: () => void;
}

export function FileTile({ name, thumbnail, selected, status, processing, error, disabled, ready, onSelect, onDownload, onRemove }: FileTileProps) {
  const url = useObjectUrl(thumbnail);
  return (
    <li className="file-tile">
      <div className="file-row">
        <button type="button" className="select-file" aria-current={selected} disabled={disabled} onClick={onSelect} title={name}>
          <span className="file-thumbnail">
            {url ? (
              /* eslint-disable-next-line @next/next/no-img-element -- Local worker thumbnail. */
              <img src={url} alt="" draggable={false} />
            ) : <Image size={21} aria-hidden />}
          </span>
          <span className="file-name">{name}</span>
          <small className={error ? 'file-error' : ''}>
            {processing && <LoaderCircle size={12} className="file-spinner" aria-hidden />}
            {status}
          </small>
        </button>
        <div className="file-actions">
          <Button aria-label={`Download ${name}`} title="Download with edits" type="button" size="icon-sm"
            variant="secondary" disabled={disabled || !ready} onClick={onDownload}><Download aria-hidden /></Button>
          <Button aria-label={`Remove ${name}`} title="Remove file" type="button" size="icon-sm"
            variant="secondary" disabled={disabled} onClick={onRemove}><X aria-hidden /></Button>
        </div>
      </div>
      {error && <p className="file-error file-error-detail" role="alert">{error}</p>}
    </li>
  );
}
