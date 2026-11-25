import { Scissors } from 'lucide-react';
import type { ToolDefinition } from '../../core/contracts';
import { defaultBackground, parseBackground, type BackgroundOptions } from './background-options';
import type { ImageToolContext } from './context';
import type { ImageState } from './formats';

export const removeBackgroundTool: ToolDefinition<ImageState, BackgroundOptions, ImageState, ImageToolContext> = {
  id: 'remove-background',
  name: 'Remove background',
  category: 'image',
  icon: Scissors,
  rememberOptions: true,
  defaultOptions: defaultBackground,
  parseOptions: parseBackground,
  OptionsPanel({ value, onChange }) {
    return (
      <div className="option-fields">
        {value.mask && <p>Quality mode {value.mask.tier} · {value.mask.provider === 'webgpu' ? 'WebGPU' : 'WASM'}</p>}
        {value.mask?.outputMaxEdge && <p>Maximum output edge on this device is {value.mask.outputMaxEdge} px.</p>}
        <fieldset>
          <legend>Background after removal</legend>
          <div className="format-options">
            {(['transparent', 'solid', 'blur'] as const).map((mode) => (
              <label key={mode}>
                <input type="radio" name="removal-fill" checked={value.mode === mode}
                  onChange={() => onChange({ ...value, mode })} />
                <span>{mode === 'transparent' ? 'Transparent' : mode === 'solid' ? 'Solid color' : 'Blur'}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {value.mode !== 'blur' && (
          <label className="background-color">
            <span>{value.mode === 'transparent' ? 'JPG fill color' : 'Background color'}</span>
            <input type="color" value={value.color} onChange={event => onChange({ ...value, color: event.currentTarget.value })} />
          </label>
        )}
      </div>
    );
  },
  async prepareOptions(options, { original, releaseImageMemory }, signal, report) {
    if (options.mask) return options;
    await releaseImageMemory();
    const { generateBackgroundMask } = await import('../../workers/bg0/client');
    const mask = await generateBackgroundMask(original, signal, report);
    return { ...options, mask };
  },
  async apply(input, options) {
    if (!options.mask) throw new Error('Generate a background mask before applying this edit.');
    return { ...input, backgroundEdit: options };
  },
};
