import type { Metadata } from 'next';
import { SiteHeader } from '../../components/site-header';
import { ImageWorkspace } from '../../components/workspace/image-workspace';

export const metadata: Metadata = { title: 'Images · FileKit' };

export default function ImagesPage() {
  return (
    <>
      <SiteHeader current="image" />
      <ImageWorkspace />
    </>
  );
}
