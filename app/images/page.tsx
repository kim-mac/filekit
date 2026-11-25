import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, ShieldCheck } from 'lucide-react';
import { ImageWorkspace } from '../../components/workspace/image-workspace';

export const metadata: Metadata = { title: 'Images · FileKit' };

export default function ImagesPage() {
  return (
    <>
      <header className="site-header">
        <div className="site-bar">
          <Link href="/" prefetch={false} className="back-link"><ChevronLeft size={17} aria-hidden /> All tools</Link>
          <span className="privacy"><ShieldCheck size={17} aria-hidden /> Files stay on this device</span>
        </div>
      </header>
      <ImageWorkspace />
    </>
  );
}
