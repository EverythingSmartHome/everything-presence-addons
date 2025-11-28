import { useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'everything-presence-zone-configurator-theme';

const getSystemTheme = (): ResolvedTheme => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark'; // Default to dark if system preference unavailable
};

const loadTheme = (): ThemeMode => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'auto') {
      return stored;
    }
  } catch (e) {
    console.warn('Failed to load theme from localStorage:', e);
  }
  return 'dark'; // Default to dark
};

const saveTheme = (theme: ThemeMode): void => {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch (e) {
    console.warn('Failed to save theme to localStorage:', e);
  }
};

const applyTheme = (resolvedTheme: ResolvedTheme): void => {
  const root = document.documentElement;
  if (resolvedTheme === 'light') {
    root.classList.remove('dark');
    root.classList.add('light');
  } else {
    root.classList.remove('light');
    root.classList.add('dark');
  }
};

export const useTheme = () => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(loadTheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  // Calculate the resolved (actual) theme
  const resolvedTheme: ResolvedTheme = themeMode === 'auto' ? systemTheme : themeMode;

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Apply theme to document whenever it changes
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Save theme to localStorage when mode changes
  useEffect(() => {
    saveTheme(themeMode);
  }, [themeMode]);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
  }, []);

  return {
    themeMode,
    resolvedTheme,
    systemTheme,
    setThemeMode,
    isDark: resolvedTheme === 'dark',
    isLight: resolvedTheme === 'light',
  };
};
