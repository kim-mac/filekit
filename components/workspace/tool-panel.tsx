import { Suspense, useEffect, useRef, useState } from 'react';
import type { EditCommand, ToolProgress } from '../../lib/core/contracts';
import type { CategoryRegistry } from '../../lib/core/registry';

export function ToolPanel<State, Context>({
  registry, context, initialOptions, revision, onApply, disabled,
}: {
  registry: CategoryRegistry<State, Context>;
  context: Context;
  initialOptions: Readonly<Record<string, unknown>>;
  revision: object;
  onApply: (command: EditCommand) => void;
  disabled: boolean;
}) {
  const tools = registry.list();
  const [activeId, setActiveId] = useState(tools[0]?.id);
  const [draft, setDraft] = useState<{ revision: object; options: Readonly<Record<string, unknown>> }>();
  const activeJob = useRef<AbortController>(null);
  const [progress, setProgress] = useState<ToolProgress>();
  const [status, setStatus] = useState('');
  useEffect(() => {
    setProgress(undefined);
    setStatus('');
    return () => {
      activeJob.current?.abort();
      activeJob.current = null;
    };
  }, [revision]);
  const drafts = draft?.revision === revision ? draft.options : {};
  if (!activeId) return null;
  const tool = registry.get(activeId);
  const options = drafts[activeId] ?? initialOptions[activeId] ?? tool.defaultOptions;

  const busy = Boolean(progress);
  async function submit() {
    if (disabled || activeJob.current) return;
    const controller = new AbortController();
    try {
      let value = tool.parseOptions(options);
      setStatus('');
      if (tool.prepareOptions) {
        activeJob.current = controller;
        setProgress({ message: 'Preparing edit…', progress: 0 });
        value = await tool.prepareOptions(value, context, controller.signal, update => {
          if (!controller.signal.aborted) setProgress(update);
        });
      }
      if (!controller.signal.aborted) onApply({ toolId: tool.id, options: tool.parseOptions(value) });
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : 'This edit could not be applied.');
    } finally {
      if (activeJob.current === controller) {
        activeJob.current = null;
        setProgress(undefined);
      }
    }
  }

  return (
    <div className="tool-panel">
      <div className="tool-bar" role="group" aria-label="Available tools">
        {tools.map(({ id, name, icon: Icon }) => (
          <button key={id} type="button" aria-pressed={activeId === id} onClick={() => { setActiveId(id); setStatus(''); }} disabled={disabled || busy}>
            <Icon size={17} aria-hidden /> {name}
          </button>
        ))}
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}>
        <fieldset className="tool-controls" disabled={disabled || busy}>
          <Suspense fallback={<p role="status">Opening tool…</p>}>
            <tool.OptionsPanel
              value={options}
              context={context}
              onChange={(value) => setDraft({ revision, options: { ...drafts, [activeId]: value } })}
            />
          </Suspense>
        </fieldset>
        <button className="button secondary apply" type="submit" aria-disabled={disabled || busy}>Apply {tool.name.toLowerCase()}</button>
        {progress && (
          <div className="option-fields">
            <p role="status">{progress.message}</p>
            <progress aria-label="Tool progress" max={1} value={progress.progress} />
            <button className="button secondary" type="button" onClick={() => {
              activeJob.current?.abort();
              activeJob.current = null;
              setProgress(undefined);
              setStatus('Edit canceled.');
            }}>Cancel edit</button>
          </div>
        )}
        {status && <p role="status">{status}</p>}
      </form>
    </div>
  );
}
