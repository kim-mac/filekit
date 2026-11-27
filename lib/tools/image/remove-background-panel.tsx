import { useState } from 'react';
import { Notice } from '../../../components/ui/notice';
import { isMobileDevice } from '../../core/device';
import { ColorField } from '../../../components/ui/color-field';
import { RadioGroup, RadioGroupItem } from '../../../components/ui/radio-group';
import type { BackgroundOptions } from './background-options';
import type { ImageToolContext } from './context';

const backgroundModes = [
  { value: 'transparent', label: 'Transparent', detail: 'Leave the area behind the subject clear.' },
  { value: 'solid', label: 'Color', detail: 'Replace the background with one color.' },
  { value: 'blur', label: 'Blur background (portrait effect)', detail: 'Keep the subject sharp. Blur the rest.' },
] as const;

export default function RemoveBackgroundOptionsPanel({ value, onChange, context }: {
  value: BackgroundOptions;
  onChange: (value: BackgroundOptions) => void;
  context: ImageToolContext;
}) {
  const [liteDismissed, setLiteDismissed] = useState(() => {
    try { return sessionStorage.getItem('filekit-lite-notice-dismissed') === '1'; }
    catch { return false; }
  });
  function dismissLite() {
    setLiteDismissed(true);
    try { sessionStorage.setItem('filekit-lite-notice-dismissed', '1'); }
    catch { /* The notice stays dismissed while this panel is open. */ }
  }
  return (
    <div className="option-fields">
      {isMobileDevice() && !liteDismissed && (
        <Notice announce={false} onDismiss={dismissLite}>Using Lite quality on this device. For best results, use a laptop or desktop.</Notice>
      )}
      {value.mask && <p className="section-note">Quality mode {value.mask.tier} · {value.mask.provider === 'webgpu' ? 'WebGPU' : 'WASM'}</p>}
      {value.mask?.outputMaxEdge && !context.upscale && <Notice variant="warning" announce={false}>The longest side of the exported image is limited to {value.mask.outputMaxEdge.toLocaleString('en-US')} px on this device.</Notice>}
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
