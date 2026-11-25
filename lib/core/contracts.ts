import type { ComponentType } from 'react';

export type Category = 'image' | 'pdf' | 'audio' | 'video';

export interface EditCommand {
  readonly toolId: string;
  readonly options: unknown;
}

export interface ToolDefinition<Input, Options, Output, Context = undefined> {
  readonly id: string;
  readonly name: string;
  readonly category: Category;
  readonly icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  readonly OptionsPanel: ComponentType<{
    value: Options;
    context: Context;
    onChange: (options: Options) => void;
  }>;
  readonly defaultOptions: Options;
  parseOptions(value: unknown): Options;
  apply(input: Input, options: Options): Promise<Output>;
}
