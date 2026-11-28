import { useEffect, useState } from 'react';
import { Notice } from '../../../components/ui/notice';
import { isMobileDevice } from '../../core/device';
import { Select } from '../../../components/ui/select';
import { ColorField } from '../../../components/ui/color-field';
import { RadioGroup, RadioGroupItem } from '../../../components/ui/radio-group';
import { backgroundModel, isBackgroundModel, rememberBackgroundModel } from './background-model';
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
  const [model, setModel] = useState(backgroundModel);
  const [autoUsesFast, setAutoUsesFast] = useState(isMobileDevice);
  useEffect(() => {
    if (model !== 'full') return;
    let current = true;
    void import('../../workers/bg0/client').then(({ autoBackgroundModel }) => autoBackgroundModel()).then(result => {
      if (current) setAutoUsesFast(result === 'lite');
    }, () => { if (current) setAutoUsesFast(true); });
    return () => { current = false; };
  }, [model]);
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
      <div className="option-fields field">
        <label htmlFor="background-model">Model</label>
        <Select id="background-model" value={model} disabled={context.disabled} onChange={event => {
          const next = event.currentTarget.value;
          if (!isBackgroundModel(next)) return;
          rememberBackgroundModel(next);
          setModel(next);
        }}>
          <option value="auto">Auto (recommended)</option>
          <option value="full">Best quality — slower, ~451 MB one-time download</option>
          <option value="lite">Fast — quicker, ~94 MB</option>
        </Select>
      </div>
      {model === 'full' && autoUsesFast && (
        <Notice variant="warning">Your device may be slow or run out of memory with Best quality. FileKit will switch to Fast automatically if it fails.</Notice>
      )}
      {model === 'auto' && isMobileDevice() && !liteDismissed && (
        <Notice announce={false} onDismiss={dismissLite}>Using Lite quality on this device. For best results, use a laptop or desktop.</Notice>
      )}
      {value.mask?.fellBack && <Notice>FileKit switched to Fast because Best quality couldn't run on this device.</Notice>}
      {value.mask && <p className="section-note">Model used: {value.mask.tier === 'Full' ? 'Best quality (BiRefNet)' : value.mask.outputMaxEdge ? 'Fast (quantized BiRefNet Lite)' : 'Fast (BiRefNet Lite)'} · {value.mask.provider === 'webgpu' ? 'WebGPU' : 'WASM'}</p>}
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
