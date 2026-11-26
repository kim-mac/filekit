import { ColorField } from '../../../components/ui/color-field';
import { RadioGroup, RadioGroupItem } from '../../../components/ui/radio-group';
import type { BackgroundOptions } from './background-options';
import type { ImageToolContext } from './context';

const backgroundModes = [
  { value: 'transparent', label: 'Transparent', detail: 'Leave the area behind the subject clear.' },
  { value: 'solid', label: 'Color', detail: 'Replace the background with one color.' },
  { value: 'blur', label: 'Blur background (portrait effect)', detail: 'Soften the background and keep the subject sharp.' },
] as const;

export default function RemoveBackgroundOptionsPanel({ value, onChange, context }: {
  value: BackgroundOptions;
  onChange: (value: BackgroundOptions) => void;
  context: ImageToolContext;
}) {
  return (
    <div className="option-fields">
      {value.mask && <p>Quality mode {value.mask.tier} · {value.mask.provider === 'webgpu' ? 'WebGPU' : 'WASM'}</p>}
      {value.mask?.outputMaxEdge && !context.upscale && <p>Maximum output edge on this device is {value.mask.outputMaxEdge} px.</p>}
      <fieldset className="option-fields field">
        <legend id="background-mode-label">Background after removal</legend>
        <RadioGroup aria-labelledby="background-mode-label" value={value.mode} disabled={context.disabled}
          onValueChange={mode => onChange({ ...value, mode: mode as BackgroundOptions['mode'] })}>
          {backgroundModes.map(({ value: mode, label, detail }) => (
            <label className="background-choice" key={mode}>
              <RadioGroupItem value={mode} aria-labelledby={`background-${mode}-label`} aria-describedby={`background-${mode}-description`} />
              <span>
                <strong id={`background-${mode}-label`}>{label}</strong>
                <small id={`background-${mode}-description`}>{detail}</small>
              </span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>
      {value.mode === 'solid' && (
        <ColorField label="Background color" value={value.color} disabled={context.disabled}
          onChange={color => onChange({ ...value, color })} />
      )}
    </div>
  );
}
