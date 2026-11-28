import { useRef, useState, type ComponentType, type ReactNode } from 'react';
import { TooltipProvider } from '../ui/tooltip';

export function WorkspaceShell({ title, description, icon: Icon, picker, children, locked, onFiles }: {
  title: string;
  description: string;
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  picker: ReactNode;
  children: ReactNode;
  locked: boolean;
  onFiles: (files: File[]) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  return (
    <main className={`workspace page-container ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        depth.current++;
        if (!locked) setDragging(true);
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = locked ? 'none' : 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      }}
      onDrop={event => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (!locked) onFiles(Array.from(event.dataTransfer.files));
      }}>
      <div className="workspace-heading">
        <div className="workspace-title">
          <span className="workspace-icon"><Icon size={24} aria-hidden /></span>
          <div><h1>{title}</h1><p>{description}</p></div>
        </div>
        {picker}
      </div>
      <TooltipProvider delayDuration={500}>
        <div className="workspace-grid">{children}</div>
      </TooltipProvider>
    </main>
  );
}
