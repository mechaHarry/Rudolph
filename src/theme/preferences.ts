export const themeFamilies = ['oneui', 'glass', 'webex', 'fluent', 'material', 'carbon'] as const;
export const appearances = ['auto', 'light', 'dark'] as const;
export type ThemeFamily = (typeof themeFamilies)[number];
export type Appearance = (typeof appearances)[number];
export type ThemePreferences = { family: ThemeFamily; appearance: Appearance };

export const themeLabels: Record<ThemeFamily, string> = {
  oneui: 'Samsung OneUI', glass: 'Apple Liquid Glass', webex: 'Cisco Momentum',
  fluent: 'Windows Fluent', material: 'Google Material', carbon: 'IBM Carbon',
};

export function normalizePreferences(family: unknown, appearance: unknown): ThemePreferences {
  const normalizedAppearance = appearance === 'system' ? 'auto' : appearance;
  const legacyAppearance = family === 'light' || family === 'dark' ? family : 'auto';
  return {
    family: themeFamilies.includes(family as ThemeFamily) ? family as ThemeFamily : 'oneui',
    appearance: appearances.includes(normalizedAppearance as Appearance)
      ? normalizedAppearance as Appearance : appearance ? 'auto' : legacyAppearance,
  };
}

export function readPreferences(): ThemePreferences {
  try {
    return normalizePreferences(localStorage.getItem('rudolph-theme'), localStorage.getItem('rudolph-appearance'));
  } catch {
    return normalizePreferences(null, null);
  }
}

export function savePreferences(preferences: ThemePreferences) {
  try {
    localStorage.setItem('rudolph-theme', preferences.family);
    localStorage.setItem('rudolph-appearance', preferences.appearance);
  } catch { /* The active theme remains usable when storage is unavailable. */ }
}

export function applyPreferences(preferences: ThemePreferences, prefersLight: boolean) {
  const mode = preferences.appearance === 'auto' ? (prefersLight ? 'light' : 'dark') : preferences.appearance;
  for (const name of [...document.body.classList]) {
    if (name.startsWith('theme-') || name.startsWith('mode-')) document.body.classList.remove(name);
  }
  document.body.classList.add(`theme-${preferences.family}`, `mode-${mode}`);
  document.body.dataset.themeFamily = preferences.family;
  document.body.dataset.appearancePreference = preferences.appearance;
  document.body.dataset.resolvedAppearance = mode;
}

export function bootstrapTheme() {
  applyPreferences(readPreferences(), window.matchMedia('(prefers-color-scheme: light)').matches);
}
