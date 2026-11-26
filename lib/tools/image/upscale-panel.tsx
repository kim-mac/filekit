import { ChoiceGroup } from '../../../components/ui/choice-group';
import { isMobileDevice } from '../../core/device';
import models from '../../workers/upscale/models.json';
import { upscaleLimitError, upscaleSize, type UpscaleOptions } from './upscale-options';
import type { ImageToolContext } from './context';

export default function UpscaleOptionsPanel({ value: options, context, onChange }: {
  value: UpscaleOptions;
  onChange: (value: UpscaleOptions) => void;
  context: ImageToolContext;
}) {
  const mobile = isMobileDevice();
  const { width, height } = upscaleSize(context.size, options.scale);
  const error = upscaleLimitError({ width, height }, mobile);
  const model = models[options.mode === 'photo' ? 'general' : 'anime'];
  return (
    <div className="option-fields">
      <fieldset>
        <legend>Scale</legend>
        <ChoiceGroup label="Scale" items={[{ value: '2', label: '2×' }, { value: '4', label: '4×' }]}
          value={options.scale === 2 ? '2' : '4'} disabled={context.disabled}
          onChange={scale => onChange({ ...options, scale: scale === '2' ? 2 : 4 })} />
      </fieldset>
      <fieldset>
        <legend>Image mode</legend>
        <ChoiceGroup label="Image mode" items={[{ value: 'photo', label: 'Photo' }, { value: 'art', label: 'Art/Text' }]}
          value={options.mode} disabled={context.disabled} onChange={mode => onChange({ ...options, mode })} />
      </fieldset>
      <p aria-live="polite">Result {width.toLocaleString('en-US')} × {height.toLocaleString('en-US')} px</p>
      {error && <p className="file-error" role="status">{error}</p>}
      <p>{model.label} · {(model.bytes / 2 ** 20).toFixed(2)} MiB model download</p>
      <p>{mobile ? 'WASM · smaller tiles' : 'WebGPU with WASM fallback'}</p>
      {context.upscale && <p>Applied with {context.upscale.model} · {context.upscale.provider === 'webgpu' ? 'WebGPU' : 'WASM'}</p>}
    </div>
  );
}
