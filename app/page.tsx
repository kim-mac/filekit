import Link from 'next/link';
import { ArrowUpRight, AudioLines, FileText, Image, Layers, ShieldCheck, Video } from 'lucide-react';
import { categories } from '../lib/core/categories';
import { Card } from '../components/ui/card';

const icons = { image: Image, pdf: FileText, audio: AudioLines, video: Video };

export default function HomePage() {
  return (
    <>
      <header className="site-header">
        <div className="site-bar">
          <Link href="/" prefetch={false} className="wordmark" aria-label="FileKit home"><Layers className="brand-icon" size={20} aria-hidden />FileKit</Link>
          <span className="privacy"><ShieldCheck size={17} aria-hidden /> Private by design</span>
        </div>
      </header>
      <main className="home">
        <div className="home-intro">
          <h1>FileKit<span>.</span></h1>
          <p>File tools that run on your device.</p>
        </div>
        <section className="category-grid" aria-label="Tool categories">
          {categories.map(({ id, name, description, href }) => {
            const Icon = icons[id];
            const content = (
              <>
                <div className="category-top">
                  <span className="category-icon"><Icon size={22} aria-hidden /></span>
                  {href ? <ArrowUpRight size={20} aria-hidden /> : <span className="coming-soon">Coming soon</span>}
                </div>
                <h2>{name}</h2>
                <p>{description}</p>
              </>
            );
            return href ? (
              <Link key={id} href={href} prefetch={false} className="category-active"><Card className="category-card">{content}</Card></Link>
            ) : (
              <Card key={id} className="category-card">{content}</Card>
            );
          })}
        </section>
        <footer className="home-footer"><Link href="/about/licenses" prefetch={false}>Licenses</Link></footer>
      </main>
    </>
  );
}
