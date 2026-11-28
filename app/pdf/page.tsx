import type { Metadata } from 'next';
import { SiteHeader } from '../../components/site-header';
import { PdfWorkspace } from '../../components/workspace/pdf/pdf-workspace';

export const metadata: Metadata = { title: 'PDF · FileKit' };

export default function PdfPage() {
  return <><SiteHeader current="pdf" /><PdfWorkspace /></>;
}
