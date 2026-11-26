import { Maximize } from 'lucide-react';
import { isMobileDevice } from '../../core/device';
import type { ToolDefinition } from '../../core/contracts';
import models from '../../workers/upscale/models.json';
import type { ImageToolContext } from './context';
import type { ImageState } from './formats';
import { defaultUpscale, parseUpscale, upscaleLimitError, upscaleSize, type UpscaleOptions } from './upscale-options';

export const upscaleTool: ToolDefinition<ImageState, UpscaleOptions, ImageState, ImageToolContext> = {
  id: 'upscale',
  name: 'Upscale',
  category: 'image',
  icon: Maximize,
  defaultOptions: defaultUpscale,
  parseOptions: parseUpscale,
  getApplyError(options, { size }) {
    return upscaleLimitError(upscaleSize(size, options.scale), isMobileDevice());
  },
  OptionsPanel({ value: options, context, onChange }) {
    const mobile = isMobileDevice();
    const { width, height } = upscaleSize(context.size, options.scale);
    const error = upscaleLimitError({ width, height }, mobile);
    const model = models[options.mode === 'photo' ? 'general' : 'anime'];
    return (
      <div className="option-fields">
        <fieldset>
          <legend>Scale</legend>
          <div className="format-options">
            {([2, 4] as const).map(scale => (
              <label key={scale}>
                <input type="radio" name="upscale-scale" checked={options.scale === scale}
                  onChange={() => onChange({ ...options, scale })} />
                <span>{scale}×</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Image mode</legend>
          <div className="format-options">
            {([['photo', 'Photo'], ['art', 'Art/Text']] as const).map(([mode, label]) => (
              <label key={mode}>
                <input type="radio" name="upscale-mode" checked={options.mode === mode}
                  onChange={() => onChange({ ...options, mode })} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p aria-live="polite">Result {width.toLocaleString('en-US')} × {height.toLocaleString('en-US')} px</p>
        {error && <p className="file-error" role="status">{error}</p>}
        <p>{model.label} · {(model.bytes / 2 ** 20).toFixed(2)} MiB model download</p>
        <p>{mobile ? 'WASM · smaller tiles' : 'WebGPU with WASM fallback'}</p>
        {context.upscale && <p>Applied with {context.upscale.model} · {context.upscale.provider === 'webgpu' ? 'WebGPU' : 'WASM'}</p>}
      </div>
    );
  },
  async prepareOptions(options, context, signal, report) {
    const value = { ...options, mobile: isMobileDevice() };
    await context.preparePreview({ toolId: 'upscale', options: value }, signal, report);
    return value;
  },
  async apply(input, options) {
    return { ...input, upscaleEdit: options };
  },
};
