import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isMobileDevice } from '../../lib/core/device';
import { processingMessage } from '../../lib/core/processing-error';
import type { EditCommand, ToolProgress } from '../../lib/core/contracts';
import type { CategoryRegistry } from '../../lib/core/registry';
import { Button } from '../ui/button';
import { JobProgress } from '../ui/job-progress';
import { Notice } from '../ui/notice';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

const desktopTools = '(min-width: 840px) and (not (any-pointer: coarse))';

function subscribeToToolLayout(update: () => void) {
  const media = window.matchMedia(desktopTools);
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}

const useVerticalTools = () => useSyncExternalStore(subscribeToToolLayout,
  () => !isMobileDevice() && window.matchMedia(desktopTools).matches, () => false);

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
  const vertical = useVerticalTools();
  const tools = registry.list();
  const [activeId, setActiveId] = useState(tools[0]?.id);
  const [draft, setDraft] = useState<{ revision: object; options: Readonly<Record<string, unknown>> }>();
  const activeJob = useRef<AbortController>(null);
  const [progress, setProgress] = useState<ToolProgress>();
  const [status, setStatus] = useState<{ message: string; error?: boolean }>();
  useEffect(() => {
    setProgress(undefined);
    setStatus(undefined);
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
  const longOperation = session && tool.mayTakeAMinute?.(options, session.context);
  const applyDisabled = !session || disabled || busy || Boolean(tool.getApplyError?.(options, session.context));
  async function submit() {
    if (!session || applyDisabled || activeJob.current) return;
    const controller = new AbortController();
    try {
      let value = tool.parseOptions(options);
      setStatus(undefined);
      if (tool.prepareOptions) {
        activeJob.current = controller;
        onBusyChange(true);
        setProgress({ message: 'Preparing image', step: 1, totalSteps: 3 });
        value = await tool.prepareOptions(value, session.context, controller.signal, update => {
          if (activeJob.current !== controller || controller.signal.aborted) return;
          setProgress(update);
        });
      }
      if (!controller.signal.aborted) session.onApply({ toolId: tool.id, options: tool.parseOptions(value) });
    } catch (error) {
      if (!controller.signal.aborted) setStatus({ message: processingMessage(error, 'This edit could not be applied. Try again.'), error: true });
    } finally {
      if (activeJob.current === controller) {
        activeJob.current = null;
        onBusyChange(false);
        setProgress(undefined);
      }
    }
  }

  return (
    <Tabs className="tool-panel" value={activeId} activationMode="manual" orientation={vertical ? 'vertical' : 'horizontal'}
      onValueChange={id => { setActiveId(id); setStatus(undefined); }}>
      <TabsList className="tool-bar" aria-label="Available tools"
        {...(!vertical && (!session || disabled || busy) ? { tabIndex: 0 } : {})}>
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
          {longOperation && !busy && !applyDisabled && (
            <div className="tool-feedback"><Notice announce={false}>This may take a minute on this device.</Notice></div>
          )}
          <Button className="apply" type="submit" aria-disabled={applyDisabled}>Apply {tool.name.toLowerCase()}</Button>
          {progress && (
            <div className="tool-feedback option-fields">
              <JobProgress update={progress} label="Tool progress" />
              <Button variant="outline" type="button" onClick={() => {
                activeJob.current?.abort();
                activeJob.current = null;
                onBusyChange(false);
                setProgress(undefined);
                setStatus({ message: 'Edit canceled.' });
              }}>Cancel edit</Button>
            </div>
          )}
          {status && <div className="tool-feedback"><Notice variant={status.error ? 'error' : 'info'}
            onDismiss={() => setStatus(undefined)}>{status.message}</Notice></div>}
        </form>}
      </TabsContent>
    </Tabs>
  );
}
