import { Dialog } from 'radix-ui';
import { useRef } from 'react';
import type { ToolProgress } from '../../../lib/core/contracts';
import { Button } from '../../ui/button';
import { JobProgress } from '../../ui/job-progress';
import { Notice } from '../../ui/notice';

export function PasswordDialog({ name, error, unlocking, progress, onClose, onUnlock }: {
  name?: string;
  error: string;
  unlocking: boolean;
  progress?: ToolProgress;
  onClose: () => void;
  onUnlock: (password: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <Dialog.Root open={Boolean(name)} onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="pdf-dialog-overlay" />
      <Dialog.Content className="pdf-dialog" onOpenAutoFocus={event => {
        event.preventDefault();
        input.current?.focus();
      }} onCloseAutoFocus={event => {
        event.preventDefault();
        document.querySelector<HTMLElement>('.file-row[data-selected] .select-file, .empty-picker')?.focus();
      }}>
        <Dialog.Title>Unlock PDF</Dialog.Title>
        <Dialog.Description>Enter the password for {name}. FileKit uses it on this device and discards it after the attempt.</Dialog.Description>
        <form className="option-fields" onSubmit={event => {
          event.preventDefault();
          const control = input.current;
          if (!control || unlocking) return;
          const password = control.value;
          control.value = '';
          onUnlock(password);
        }}>
          <label className="field pdf-field"><span>Password</span>
            <input ref={input} type="password" autoComplete="off" required disabled={unlocking}
              aria-invalid={Boolean(error) || undefined} />
          </label>
          {error && <Notice variant="error">{error}</Notice>}
          {unlocking && progress && <JobProgress update={progress} label="Unlock progress" />}
          <div className="pdf-actions">
            <Button type="submit" disabled={unlocking}>Unlock</Button>
            <Button type="button" variant="outline" disabled={unlocking} onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
