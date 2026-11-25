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
  readonly rememberOptions?: boolean;
  prepareOptions?(options: Options, context: Context, signal: AbortSignal, onProgress: (update: ToolProgress) => void): Promise<Options>;
  parseOptions(value: unknown): Options;
  apply(input: Input, options: Options): Promise<Output>;
}

export interface ToolProgress {
  readonly message: string;
  readonly progress: number;
}
