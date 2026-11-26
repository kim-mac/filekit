import { createElement } from 'react';
import type { Category, EditCommand, ToolDefinition } from './contracts';

type RegisteredTool<State, Context> = ToolDefinition<State, unknown, State, Context>;

export class CategoryRegistry<State, Context = undefined> {
  private readonly tools = new Map<string, RegisteredTool<State, Context>>();

  constructor(readonly category: Category) {}

  register<Options>(tool: ToolDefinition<State, Options, State, Context>) {
    if (tool.category !== this.category) {
      throw new Error(`Tool "${tool.id}" belongs to ${tool.category}, not ${this.category}.`);
    }
    if (this.tools.has(tool.id)) {
      throw new Error(`Duplicate tool ID "${tool.id}".`);
    }

    this.tools.set(tool.id, {
      ...tool,
      OptionsPanel: ({ value, context, onChange }) =>
        createElement(tool.OptionsPanel, { value: tool.parseOptions(value), context, onChange }),
      ...(tool.getApplyError ? {
        getApplyError: (options, context) => tool.getApplyError!(tool.parseOptions(options), context),
      } : {}),
      ...(tool.prepareOptions ? {
        prepareOptions: (options, context, signal, report) =>
          tool.prepareOptions!(tool.parseOptions(options), context, signal, report),
      } : {}),
      apply: (input, options) => tool.apply(input, tool.parseOptions(options)),
    });
  }

  list(): readonly RegisteredTool<State, Context>[] {
    return [...this.tools.values()];
  }

  get(id: string): RegisteredTool<State, Context> {
    const tool = this.tools.get(id);
    if (!tool) throw new Error(`Unknown ${this.category} tool "${id}".`);
    return tool;
  }

  async replay(input: State, commands: readonly EditCommand[]): Promise<State> {
    let state = input;
    for (const command of commands) {
      state = await this.get(command.toolId).apply(state, command.options);
    }
    return state;
  }
}
