import { RadioGroup, RadioGroupItem } from './radio-group';

interface ChoiceGroupProps<Value extends string> {
  label: string;
  items: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
  disabled?: boolean;
  className?: string;
}

export function ChoiceGroup<Value extends string>({ label, items, value, onChange, disabled, className }: ChoiceGroupProps<Value>) {
  return (
    <RadioGroup className={`choice-group ${className ?? ''}`} aria-label={label} value={value} disabled={disabled}
      onValueChange={next => onChange(next as Value)}>
      {items.map(item => (
        <label key={item.value}>
          <RadioGroupItem aria-label={item.label} value={item.value} />
          <span aria-hidden>{item.label}</span>
        </label>
      ))}
    </RadioGroup>
  );
}
