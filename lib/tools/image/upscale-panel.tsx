import { Notice } from '../../../components/ui/notice';
import { OutputEstimate } from '../../../components/workspace/output-estimate';
import { RadioGroup, RadioGroupItem } from '../../../components/ui/radio-group';
import { ChoiceGroup } from '../../../components/ui/choice-group';
import { isMobileDevice } from '../../core/device';
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
        <RadioGroup aria-label="Image mode" value={options.mode} disabled={context.disabled}
          onValueChange={mode => onChange({ ...options, mode: mode === 'photo' ? 'photo' : 'art' })}>
          {([
            ['photo', 'Photo', 'For photos of people, landscapes, or products.'],
            ['art', 'Graphics', 'For illustrations, logos, screenshots, or text.'],
          ] as const).map(([mode, label, description]) => (
            <label className="background-choice" key={mode}>
              <RadioGroupItem value={mode} aria-label={label} aria-describedby={`upscale-${mode}-description`} />
              <span><strong>{label}</strong><small id={`upscale-${mode}-description`}>{description}</small></span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>
      <p aria-live="polite">Result {width.toLocaleString('en-US')} × {height.toLocaleString('en-US')} px</p>
      {!error && <OutputEstimate estimator={context.estimator} preview={context.previewBlob} output={context.output}
        size={{ width, height }} paused={context.disabled} />}
      {error && <Notice variant="warning">{error}</Notice>}
      {context.upscale && <p className="section-note">Applied with {context.upscale.model} · {context.upscale.provider === 'webgpu' ? 'WebGPU' : 'WASM'}</p>}
    </div>
  );
}
