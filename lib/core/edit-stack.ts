import type { EditCommand } from './contracts';

export interface EditStack {
  readonly original: File;
  readonly commands: readonly EditCommand[];
  readonly cursor: number;
}

export function createEditStack(original: File): EditStack {
  return { original, commands: [], cursor: 0 };
}

export function activeCommands(stack: EditStack): readonly EditCommand[] {
  return stack.commands.slice(0, stack.cursor);
}

export function recordEdit(stack: EditStack, command: EditCommand): EditStack {
  return {
    ...stack,
    commands: [...activeCommands(stack), structuredClone(command)],
    cursor: stack.cursor + 1,
  };
}

export function undo(stack: EditStack): EditStack {
  return stack.cursor > 0 ? { ...stack, cursor: stack.cursor - 1 } : stack;
}

export function redo(stack: EditStack): EditStack {
  return stack.cursor < stack.commands.length ? { ...stack, cursor: stack.cursor + 1 } : stack;
}
