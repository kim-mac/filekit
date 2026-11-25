import { useState } from 'react';
import type { EditCommand } from '../../lib/core/contracts';
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
  const drafts = draft?.revision === revision ? draft.options : {};
  if (!activeId) return null;
  const tool = registry.get(activeId);
  const options = drafts[activeId] ?? initialOptions[activeId] ?? tool.defaultOptions;

  return (
    <div className="tool-panel">
      <div className="tool-bar" role="group" aria-label="Available tools">
        {tools.map(({ id, name, icon: Icon }) => (
          <button key={id} type="button" aria-pressed={activeId === id} onClick={() => setActiveId(id)} disabled={disabled}>
            <Icon size={17} aria-hidden /> {name}
          </button>
        ))}
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) onApply({ toolId: activeId, options: tool.parseOptions(options) });
      }}>
        <fieldset className="tool-controls" disabled={disabled}>
          <tool.OptionsPanel
            value={options}
            context={context}
            onChange={(value) => setDraft({ revision, options: { ...drafts, [activeId]: value } })}
          />
        </fieldset>
        <button className="button secondary apply" type="submit" aria-disabled={disabled}>Apply {tool.name.toLowerCase()}</button>
      </form>
    </div>
  );
}
