import { OutputEstimate } from '../../../components/workspace/output-estimate';
import { ColorField } from '../../../components/ui/color-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Slider } from '../../../components/ui/slider';
import { Toggle } from '../../../components/ui/toggle';
import type { ImageToolContext } from './context';
import { formatIconDimensions } from './size-estimate';
import { iconSizes, outputFormats, resolveOutput, type ConvertOptions, type OutputSelection } from './formats';

export default function ConvertOptionsPanel({ value, onChange, context }: {
  value: ConvertOptions;
  onChange: (options: ConvertOptions) => void;
  context: ImageToolContext;
}) {
  const { originalFormat, hasAlpha, disabled } = context;
  const resolved = resolveOutput(originalFormat, value);
  const { format } = resolved;
  const output = outputFormats[format];
  const sizes = value.iconSizes ?? iconSizes;
  return (
    <div className="option-fields">
      <p className="original-format">Original format: <strong>{originalFormat === 'heic' ? 'HEIC' : outputFormats[originalFormat].label}</strong></p>
      <div className="option-fields field">
        <label htmlFor="output-format">Output format</label>
        <Select value={value.format} onValueChange={format => onChange({ ...value, format: format as OutputSelection })} disabled={disabled}>
          <SelectTrigger id="output-format" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="original">Keep original format</SelectItem>
            {Object.entries(outputFormats).map(([format, { label }]) => (
              <SelectItem key={format} value={format}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value.format === 'original' && originalFormat === 'heic' && <p className="section-note">HEIC input is exported as JPG.</p>}
        {format === 'gif' && <p className="section-note">Exports one frame. Animated inputs use their first frame.</p>}
      </div>
      {output.lossy && (
        <div className="quality-field">
          <span>Quality <output>{value.quality}%</output></span>
          <Slider className="h-9" aria-label="Quality" min={1} max={100} value={[value.quality]}
            aria-describedby="convert-quality-help" onValueChange={([quality]) => onChange({ ...value, quality })} disabled={disabled} />
          <p className="section-note" id="convert-quality-help">Higher = better look, bigger file</p>
        </div>
      )}
      {hasAlpha && !output.alpha && (
        <ColorField label="Fill transparent areas with" value={value.background} disabled={disabled}
          onChange={background => onChange({ ...value, background })} />
      )}
      {format === 'ico' && (
        <fieldset className="option-fields field">
          <legend>Icon sizes</legend>
          <div className="icon-sizes">
            {iconSizes.map(size => (
              <Toggle key={size} variant="outline" pressed={sizes.includes(size)} disabled={disabled}
                onPressedChange={active => {
                  const next = active ? [...sizes, size] : sizes.filter(selected => selected !== size);
                  if (next.length) onChange({ ...value, iconSizes: next });
                }}
              >{size} px</Toggle>
            ))}
          </div>
          <p className="section-note">{formatIconDimensions(sizes)} in one file. Images are fitted and centered.</p>
        </fieldset>
      )}
      <OutputEstimate estimator={context.estimator} preview={context.previewBlob} output={resolved}
        size={context.size} paused={disabled} />
    </div>
  );
}
