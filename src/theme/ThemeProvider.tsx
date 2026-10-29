import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { applyPreferences, readPreferences, savePreferences, type Appearance, type ThemeFamily } from './preferences';

type ThemeContextValue = ReturnType<typeof readPreferences> & {
  resolvedAppearance: 'light' | 'dark';
  setFamily: (family: ThemeFamily) => void;
  setAppearance: (appearance: Appearance) => void;
};
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(readPreferences);
  const [prefersLight, setPrefersLight] = useState(() => window.matchMedia('(prefers-color-scheme: light)').matches);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const syncSystem = () => setPrefersLight(query.matches);
    const syncStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'rudolph-theme' || event.key === 'rudolph-appearance') {
        setPreferences(readPreferences());
      }
    };
    query.addEventListener('change', syncSystem);
    window.addEventListener('storage', syncStorage);
    syncSystem();
    return () => {
      query.removeEventListener('change', syncSystem);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);

  useLayoutEffect(() => {
    applyPreferences(preferences, prefersLight);
  }, [preferences, prefersLight]);

  const update = (next: typeof preferences) => {
    savePreferences(next);
    setPreferences(next);
  };

  return <ThemeContext.Provider value={{
    ...preferences,
    resolvedAppearance: preferences.appearance === 'auto' ? (prefersLight ? 'light' : 'dark') : preferences.appearance,
    setFamily: family => update({ ...preferences, family }),
    setAppearance: appearance => update({ ...preferences, appearance }),
  }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme requires ThemeProvider');
  return theme;
}
