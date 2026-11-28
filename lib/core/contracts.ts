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
  readonly actionLabel?: string;
  readonly rememberOptions?: boolean;
  prepareOptions?(options: Options, context: Context, signal: AbortSignal, onProgress: (update: ToolProgress) => void): Promise<Options>;
  mayTakeAMinute?(options: Options, context: Context): boolean;
  getApplyError?(options: Options, context: Context): string | undefined;
  parseOptions(value: unknown): Options;
  apply(input: Input, options: Options): Promise<Output>;
}

export interface ModelDownload {
  readonly id: string;
  readonly loaded: number;
  readonly total: number;
  readonly received?: number;
}

export interface ToolProgress {
  readonly message: string;
  readonly step: number;
  readonly totalSteps: number;
  readonly tiles?: { readonly done: number; readonly total: number };
  readonly download?: ModelDownload;
}
