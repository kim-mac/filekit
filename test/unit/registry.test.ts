import { describe, expect, it } from 'vitest';
import type { ToolDefinition } from '../../lib/core/contracts';
import { CategoryRegistry } from '../../lib/core/registry';
import { convertTool } from '../../lib/tools/image/convert';
import { defaultOutput, outputName } from '../../lib/tools/image/formats';
import { fullGeometry } from '../../lib/tools/image/geometry';
import { imageTools } from '../../lib/tools/image';

const component = () => null;
const multiply: ToolDefinition<number, number, number> = {
  id: 'multiply',
  name: 'Multiply',
  category: 'image',
  icon: component,
  OptionsPanel: component,
  defaultOptions: 2,
  parseOptions(value) {
    if (typeof value !== 'number') throw new Error('Expected a number');
    return value;
  },
  async apply(input, value) { return input * value; },
};
const add: typeof multiply = { ...multiply, id: 'add', async apply(input, value) { return input + value; } };

describe('Category registry', () => {
  it('lists plugins in toolbar order and looks up stable IDs', () => {
    const registry = new CategoryRegistry<number>('image');
    registry.register(multiply);
    registry.register(add);
    expect(registry.list().map(({ id }) => id)).toEqual(['multiply', 'add']);
    expect(registry.get('multiply').name).toBe('Multiply');
    expect(() => registry.get('missing')).toThrow('Unknown image tool');
  });

  it('rejects duplicate IDs and category mismatches', () => {
    const registry = new CategoryRegistry<number>('image');
    registry.register(multiply);
    expect(() => registry.register(multiply)).toThrow('Duplicate tool ID');
    expect(() => registry.register({ ...add, category: 'pdf' })).toThrow('belongs to pdf');
    expect(registry.list()).toHaveLength(1);
  });

  it('validates and applies commands in order', async () => {
    const registry = new CategoryRegistry<number>('image');
    registry.register(multiply);
    registry.register(add);
    await expect(registry.replay(3, [
      { toolId: 'add', options: 2 }, { toolId: 'multiply', options: 4 },
    ])).resolves.toBe(20);
    await expect(registry.replay(3, [{ toolId: 'multiply', options: '2' }])).rejects.toThrow('Expected a number');
  });
});

describe('Convert plugin', () => {
  it('changes only the export settings', async () => {
    expect(imageTools.list().map(({ id }) => id)).toEqual(['convert', 'crop', 'remove-background']);
    const geometry = fullGeometry({ width: 2, height: 3 });
    const input = { geometry, output: defaultOutput('heic') };
    const options = { format: 'jpeg', quality: 52, background: '#000000' };
    const result = await imageTools.replay(input, [{ toolId: 'convert', options }]);
    expect(result.geometry).toBe(geometry);
    expect(result.output).toEqual(options);
    expect(input.output).toEqual({ format: 'png', quality: 85, background: '#ffffff' });
  });

  it.each([
    null, { format: 'gif' }, { format: 'toString' },
    { ...convertTool.defaultOptions, quality: 0 },
    { ...convertTool.defaultOptions, quality: 101 },
    { ...convertTool.defaultOptions, quality: 1.5 },
    { ...convertTool.defaultOptions, background: 'white' },
  ])('rejects invalid conversion options %j', (options) => {
    expect(() => convertTool.parseOptions(options)).toThrow();
  });

  it('derives safe names for downloads and ZIP entries', () => {
    expect(outputName('holiday.final.HEIC', 'jpeg')).toBe('holiday.final.jpg');
    expect(outputName('../trip\\photo.gif', 'avif')).toBe('.._trip_photo.avif');
    expect(outputName('.gif', 'webp')).toBe('image.webp');
  });
});
