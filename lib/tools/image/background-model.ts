export type BackgroundModel = 'auto' | 'full' | 'lite';

const modelKey = 'filekit-background-model';
let preference: BackgroundModel | undefined;

export function isBackgroundModel(value: unknown): value is BackgroundModel {
  return value === 'auto' || value === 'full' || value === 'lite';
}

export function backgroundModel(): BackgroundModel {
  if (preference) return preference;
  try {
    const stored = localStorage.getItem(modelKey);
    if (isBackgroundModel(stored)) return stored;
  } catch {
    // The selector still works when storage is unavailable.
  }
  return 'auto';
}

export function rememberBackgroundModel(model: BackgroundModel) {
  preference = model;
  try {
    localStorage.setItem(modelKey, model);
  } catch {
    // Keep the choice in memory for this visit.
  }
}

export function modelForBg0(model: BackgroundModel, autoPrefersLite: boolean): BackgroundModel {
  return model === 'auto' && autoPrefersLite ? 'lite' : model;
}
