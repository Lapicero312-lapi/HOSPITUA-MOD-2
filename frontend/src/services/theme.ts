import { useCallback, useEffect, useState } from 'react';

/**
 * Tema claro u oscuro. Por defecto sigue la preferencia del sistema; si la Recepcionista lo elige, se
 * guarda en `localStorage` y se respeta en las próximas visitas. `index.html` lo aplica antes de pintar.
 */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'hospitua.theme';
const SYSTEM_DARK = '(prefers-color-scheme: dark)';

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return 'light';
  }
  return window.matchMedia(SYSTEM_DARK).matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(
    () => storedTheme() ?? systemTheme(),
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Mientras la Recepcionista no elija, el tema acompaña al del sistema.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const media = window.matchMedia(SYSTEM_DARK);
    const follow = () => {
      if (storedTheme() === null) {
        setTheme(media.matches ? 'dark' : 'light');
      }
    };
    media.addEventListener?.('change', follow);
    return () => media.removeEventListener?.('change', follow);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Sin almacenamiento, el cambio dura hasta recargar.
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
