import { useEffect, useId, useRef, useState } from 'react';
import { useTheme } from '../theme/ThemeProvider';
import { appearances, themeFamilies, themeLabels } from '../theme/preferences';

export function ThemeMenu() {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); button.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return <div className="theme-menu-wrap" id="theme-menu-wrap" ref={wrapper}>
    <button ref={button} id="theme-menu-btn" className="icon-btn" type="button" title="Theme"
      aria-label="Theme" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(!open)}>
      <svg className="header-control-icon rainbow-flower-icon" viewBox="0 0 24 24" aria-hidden="true">
        {['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet'].map((color, i) =>
          <ellipse key={color} className={`rainbow-petal rainbow-${color}`} cx="12" cy="6.5" rx="2.6" ry="4.2" transform={`rotate(${i * 51.43} 12 12)`} />)}
        <circle className="rainbow-flower-center" cx="12" cy="12" r="2.8" />
      </svg>
    </button>
    <div id={menuId} className={`theme-menu${open ? ' open' : ''}`} hidden={!open} aria-label="Theme preferences">
      <div role="group" aria-label="Theme family">
        {themeFamilies.map(family => <button key={family} type="button" data-theme={family}
          className={theme.family === family ? 'active' : ''} aria-pressed={theme.family === family}
          onClick={() => theme.setFamily(family)}>{themeLabels[family]}</button>)}
      </div>
      <div className="theme-menu-footer" role="group" aria-label="Appearance">
        <div className="theme-menu-footer-label">Appearance</div>
        <div className="appearance-toggle">
          {appearances.map(appearance => <button key={appearance} type="button" data-appearance={appearance}
            className={theme.appearance === appearance ? 'active' : ''} aria-pressed={theme.appearance === appearance}
            onClick={() => theme.setAppearance(appearance)}>{appearance.charAt(0).toUpperCase() + appearance.slice(1)}</button>)}
        </div>
      </div>
    </div>
  </div>;
}
