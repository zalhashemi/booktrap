import { useCallback, useState } from 'react';

export type Theme = 'dark' | 'light';

const THEME_KEY = 'booktrap.theme';
const THEME_COLORS: Record<Theme, string> = { dark: '#2B2733', light: '#F1F7F3' };

function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

/** Dark is the default. The choice is a per-browser convenience, so storage failures are ignored. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setThemeState(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode: the theme simply won't be remembered.
    }
  }, []);

  return { theme, setTheme };
}
