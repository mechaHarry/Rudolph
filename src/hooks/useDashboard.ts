import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../theme/ThemeProvider';

// The UI renders first. Loading chart/grid code and fetching market data never
// gates the theme controls or their skeletons.
export function useDashboard() {
  const { family, resolvedAppearance } = useTheme();
  const refresh = useRef<(() => void) | undefined>(undefined);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setError(false);
    import('../legacy/dashboard').then(runtime => {
      if (cancelled) return;
      dispose = runtime.mountDashboard();
      refresh.current = runtime.refreshDashboardTheme;
      refresh.current();
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => {
      cancelled = true;
      refresh.current = undefined;
      dispose?.();
    };
  }, []);

  useEffect(() => { refresh.current?.(); }, [family, resolvedAppearance]);
  return error;
}
