import type { Category } from './contracts';

export const categories = [
  { id: 'image', name: 'Images', description: 'Convert photos and graphics to JPG, PNG, WebP, or AVIF.', href: '/images/' },
  { id: 'pdf', name: 'PDF', description: 'Organize, merge, split, and convert PDF pages.', href: '/pdf/' },
  { id: 'audio', name: 'Audio', description: 'Work with recordings and audio files.', href: null },
  { id: 'video', name: 'Video', description: 'Work with clips and video files.', href: null },
] as const satisfies readonly {
  id: Category;
  name: string;
  description: string;
  href: string | null;
}[];
