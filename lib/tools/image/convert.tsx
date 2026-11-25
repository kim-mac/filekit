import { Repeat2 } from 'lucide-react';
import type { ToolDefinition } from '../../core/contracts';
import type { ImageToolContext } from './context';
import { defaultConvertOptions, outputFormats, type ConvertOptions, type ImageState, type OutputFormat } from './formats';

function ConvertOptionsPanel({ value, onChange, context }: {
  value: ConvertOptions;
  onChange: (options: ConvertOptions) => void;
  context: ImageToolContext;
}) {
  return (
    <div className="option-fields">
      <fieldset>
        <legend>Output format</legend>
        <div className="format-options">
          {Object.entries(outputFormats).map(([format, { label }]) => (
            <label key={format}>
              <input
                type="radio"
                name="output-format"
                value={format}
                checked={value.format === format}
                onChange={() => onChange({ ...value, format: format as OutputFormat })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {outputFormats[value.format].lossy && (
        <label className="quality-field">
          <span>Quality <output>{value.quality}%</output></span>
          <input
            aria-label="Quality"
            type="range"
            min={1}
            max={100}
            value={value.quality}
            onChange={(event) => onChange({ ...value, quality: event.currentTarget.valueAsNumber })}
          />
        </label>
      )}
      {value.format === 'jpeg' && context.hasAlpha && context.backgroundColor && (
        <p>JPG uses the color set in Remove background.</p>
      )}
      {value.format === 'jpeg' && context.hasAlpha && !context.backgroundColor && (
        <fieldset className="background-options">
          <legend>JPG background</legend>
          <p>Transparent areas will use this color.</p>
          <div>
            {[['#ffffff', 'White'], ['#000000', 'Black']].map(([color, label]) => (
              <label key={color}>
                <input
                  type="radio"
                  name="jpg-background"
                  checked={value.background === color}
                  onChange={() => onChange({ ...value, background: color })}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

export const convertTool: ToolDefinition<ImageState, ConvertOptions, ImageState, ImageToolContext> = {
  id: 'convert',
  name: 'Convert',
  category: 'image',
  icon: Repeat2,
  OptionsPanel: ConvertOptionsPanel,
  defaultOptions: defaultConvertOptions,
  parseOptions(value) {
    if (typeof value !== 'object' || value === null) throw new Error('Invalid conversion options.');
    const { format, quality, background } = value as Record<string, unknown>;
    if (typeof format !== 'string' || !Object.hasOwn(outputFormats, format)) {
      throw new Error('Choose a supported output format.');
    }
    if (typeof quality !== 'number' || !Number.isInteger(quality) || quality < 1 || quality > 100) {
      throw new Error('Quality must be a whole number from 1 to 100.');
    }
    if (typeof background !== 'string' || !/^#[0-9a-f]{6}$/i.test(background)) {
      throw new Error('Choose a valid JPG background color.');
    }
    return { format: format as OutputFormat, quality, background };
  },
  async apply(input, options) {
    return { ...input, output: options };
  },
};
