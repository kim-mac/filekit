'use client';

import Link from 'next/link';
import { ChevronDown, Layers, ShieldCheck } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useEffect, useState } from 'react';
import { categories } from '../lib/core/categories';
import type { Category } from '../lib/core/contracts';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

function CategorySwitcher({ current }: { current: Category }) {
  const currentName = categories.find(({ id }) => id === current)?.name;

  return (
    <nav aria-label="Tool categories">
      <div className="category-segments">
        {categories.map(({ id, name, href }) => href ? (
          <Link key={id} href={href} prefetch={false} aria-current={id === current ? 'page' : undefined}>{name}</Link>
        ) : (
          <button key={id} type="button" disabled>{name}<span className="category-soon">Soon</span></button>
        ))}
      </div>
      <div className="category-dropdown">
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <Button variant="outline" aria-label={`Switch category, current: ${currentName}`}>
              {currentName} <ChevronDown aria-hidden />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="category-menu" align="start" sideOffset={8}>
              {categories.map(({ id, name, href }) => href ? (
                <DropdownMenu.Item key={id} asChild>
                  <Link href={href} prefetch={false} aria-current={id === current ? 'page' : undefined}>{name}</Link>
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Item key={id} disabled>{name}<span className="category-soon">Soon</span></DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </nav>
  );
}

export function SiteHeader({ current }: { current?: Category }) {
  const [scrolled, setScrolled] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <header className="site-header page-container" data-scrolled={scrolled || undefined}>
      <div className="site-brand">
        <Link href="/" prefetch={false} className="wordmark" aria-label="FileKit home" aria-current={current ? undefined : 'page'}>
          <Layers size={20} aria-hidden /> FileKit
        </Link>
        {current && <CategorySwitcher current={current} />}
      </div>
      <span className="privacy privacy-long"><ShieldCheck size={16} aria-hidden /> Files stay on this device</span>
      <div className="privacy-compact">
        <TooltipProvider>
          <Tooltip open={privacyOpen} onOpenChange={setPrivacyOpen}>
            <TooltipTrigger asChild>
              <Button className="privacy" variant="secondary" size="icon" aria-label="Files stay on this device" onClick={event => {
                event.preventDefault();
                setPrivacyOpen(open => !open);
              }}>
                <ShieldCheck aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>Files stay on this device</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </header>
  );
}
