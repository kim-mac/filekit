interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

export function ColorField({ label, value, onChange, disabled }: ColorFieldProps) {
  return (
    <label className="color-field">
      <span>{label}</span>
      <span className="color-value">
        <input type="color" value={value} disabled={disabled} onChange={event => onChange(event.currentTarget.value)} />
        <span aria-hidden>{value.toUpperCase()}</span>
      </span>
    </label>
  );
}
