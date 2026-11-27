import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, Layers, ShieldCheck } from 'lucide-react';
import { ImageWorkspace } from '../../components/workspace/image-workspace';

export const metadata: Metadata = { title: 'Images · FileKit' };

export default function ImagesPage() {
  return (
    <>
      <header className="site-header workspace-header">
        <div className="site-bar">
          <div className="site-brand">
            <Link href="/" prefetch={false} className="wordmark" aria-label="FileKit home">
              <Layers size={20} className="brand-icon" aria-hidden /> FileKit
            </Link>
            <span className="brand-divider" aria-hidden />
            <Link href="/" prefetch={false} className="back-link"><ChevronLeft size={15} aria-hidden /> All tools</Link>
          </div>
          <span className="privacy"><ShieldCheck size={16} aria-hidden />
            <span className="privacy-long">Files stay on this device</span>
            <span className="privacy-short">On-device</span>
          </span>
        </div>
      </header>
      <ImageWorkspace />
    </>
  );
}
