import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';

const icons = { info: Info, warning: TriangleAlert, error: CircleAlert };

export function Notice({ variant = 'info', children, onDismiss, announce = true }: {
  variant?: keyof typeof icons;
  children: ReactNode;
  onDismiss?: () => void;
  announce?: boolean;
}) {
  const Icon = icons[variant];
  return (
    <div className="notice" data-variant={variant}>
      <Icon size={16} aria-hidden />
      <div role={announce ? variant === 'error' ? 'alert' : 'status' : undefined}>{children}</div>
      {onDismiss && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Dismiss notice" title="Dismiss notice" onClick={onDismiss}>
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}
