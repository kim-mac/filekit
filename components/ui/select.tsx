import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';

export function Select(props: ComponentProps<'select'>) {
  return (
    <span className="select-field">
      <select data-slot="select-trigger" {...props} />
      <ChevronDown size={16} aria-hidden />
    </span>
  );
}
