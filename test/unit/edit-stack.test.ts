import { describe, expect, it } from 'vitest';
import { activeCommands, createEditStack, recordEdit, redo, undo } from '../../lib/core/edit-stack';

const original = new File(['original'], 'original.png');
const convert = (quality: number) => ({ toolId: 'convert', options: { format: 'jpeg', quality } });

describe('Edit stack', () => {
  it('starts with the original and an empty history', () => {
    const stack = createEditStack(original);
    expect(stack.original).toBe(original);
    expect(stack.cursor).toBe(0);
    expect(activeCommands(stack)).toEqual([]);
    expect(undo(stack)).toBe(stack);
    expect(redo(stack)).toBe(stack);
  });

  it('replays the active prefix and clamps undo and redo at the bounds', () => {
    const first = recordEdit(createEditStack(original), convert(62));
    const full = recordEdit(first, convert(83));
    const start = undo(undo(full));
    expect(activeCommands(first)).toEqual([convert(62)]);
    expect(activeCommands(full)).toEqual([convert(62), convert(83)]);
    expect(activeCommands(start)).toEqual([]);
    expect(undo(start)).toBe(start);
    expect(activeCommands(redo(start))).toEqual([convert(62)]);
    const end = redo(redo(start));
    expect(activeCommands(end)).toEqual(activeCommands(full));
    expect(redo(end)).toBe(end);
  });

  it('truncates redo when recording a new immutable command snapshot', () => {
    const first = recordEdit(createEditStack(original), convert(62));
    const full = recordEdit(first, convert(83));
    const command = convert(40);
    const branched = recordEdit(undo(full), command);
    command.options.quality = 12;
    expect(branched.commands).toEqual([convert(62), convert(40)]);
    expect(branched.cursor).toBe(2);
    expect(redo(branched)).toBe(branched);
    expect(full.commands).toEqual([convert(62), convert(83)]);
  });

  it('keeps edits and cursors separate even for files with identical names', () => {
    const left = createEditStack(original);
    const other = new File(['different'], original.name);
    const right = recordEdit(createEditStack(other), convert(22));
    const edited = recordEdit(left, convert(70));
    expect(activeCommands(undo(edited))).toEqual([]);
    expect(activeCommands(right)).toEqual([convert(22)]);
    expect(right.original).toBe(other);
    expect(edited.original).toBe(original);
  });
});
