import { Suspense, useEffect, useRef, useState } from 'react';
import type { EditCommand, ToolProgress } from '../../lib/core/contracts';
import type { CategoryRegistry } from '../../lib/core/registry';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

export function ToolPanel<State, Context>({
  registry, session, onBusyChange, disabled,
}: {
  registry: CategoryRegistry<State, Context>;
  session?: {
    context: Context;
    initialOptions: Readonly<Record<string, unknown>>;
    revision: object;
    onApply: (command: EditCommand) => void;
  };
  onBusyChange: (busy: boolean) => void;
  disabled: boolean;
}) {
  const revision = session?.revision;
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
      if (activeJob.current) {
        activeJob.current.abort();
        activeJob.current = null;
        onBusyChange(false);
      }
    };
  }, [onBusyChange, revision]);
  const drafts = draft && draft.revision === revision ? draft.options : {};
  if (!activeId) return null;
  const tool = registry.get(activeId);
  const options = drafts[activeId] ?? session?.initialOptions[activeId] ?? tool.defaultOptions;

  const busy = Boolean(progress);
  const applyDisabled = !session || disabled || busy || Boolean(tool.getApplyError?.(options, session.context));
  async function submit() {
    if (!session || applyDisabled || activeJob.current) return;
    const controller = new AbortController();
    try {
      let value = tool.parseOptions(options);
      setStatus('');
      if (tool.prepareOptions) {
        activeJob.current = controller;
        onBusyChange(true);
        setProgress({ message: 'Preparing edit…', progress: 0 });
        value = await tool.prepareOptions(value, session.context, controller.signal, update => {
          if (!controller.signal.aborted) setProgress(update);
        });
      }
      if (!controller.signal.aborted) session.onApply({ toolId: tool.id, options: tool.parseOptions(value) });
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : 'This edit could not be applied.');
    } finally {
      if (activeJob.current === controller) {
        activeJob.current = null;
        onBusyChange(false);
        setProgress(undefined);
      }
    }
  }

  return (
    <Tabs className="tool-panel" value={activeId} activationMode="manual"
      onValueChange={id => { setActiveId(id); setStatus(''); }}>
      <TabsList className="tool-bar" aria-label="Available tools">
        {tools.map(({ id, name, icon: Icon }) => (
          <TabsTrigger key={id} value={id} disabled={!session || disabled || busy}>
            <Icon aria-hidden /> {name}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={activeId}>
        {!session ? <p className="section-note">Add an image to start</p> : <form onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}>
          <fieldset className="tool-controls" disabled={disabled || busy}>
            <Suspense fallback={<p role="status">Opening tool…</p>}>
              <tool.OptionsPanel
                value={options}
                context={session.context}
                onChange={(value) => setDraft({ revision: session.revision, options: { ...drafts, [activeId]: value } })}
              />
            </Suspense>
          </fieldset>
          <Button className="apply" type="submit" aria-disabled={applyDisabled}>Apply {tool.name.toLowerCase()}</Button>
          {progress && (
            <div className="option-fields">
              <p role="status">{progress.message}</p>
              <Progress aria-label="Tool progress" value={progress.progress === undefined ? null : progress.progress * 100} />
              <Button variant="outline" type="button" onClick={() => {
                activeJob.current?.abort();
                activeJob.current = null;
                onBusyChange(false);
                setProgress(undefined);
                setStatus('Edit canceled.');
              }}>Cancel edit</Button>
            </div>
          )}
          {status && <p role="status">{status}</p>}
        </form>}
      </TabsContent>
    </Tabs>
  );
}
