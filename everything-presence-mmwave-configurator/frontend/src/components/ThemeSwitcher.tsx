import React from 'react';
import { useThemeContext, ThemeMode } from '../contexts/ThemeContext';

interface ThemeSwitcherProps {
  className?: string;
  compact?: boolean;
}

export const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({ className = '', compact = false }) => {
  const { themeMode, setThemeMode, resolvedTheme } = useThemeContext();

  const options: { value: ThemeMode; label: string; icon: string }[] = [
    { value: 'light', label: 'Light', icon: '☀️' },
    { value: 'dark', label: 'Dark', icon: '🌙' },
    { value: 'auto', label: 'Auto', icon: '💻' },
  ];

  if (compact) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => setThemeMode(option.value)}
            className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
              themeMode === option.value
                ? 'bg-aqua-500/20 border border-aqua-500/50 text-aqua-400'
                : 'bg-slate-800/50 border border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
            title={`${option.label}${option.value === 'auto' ? ` (currently ${resolvedTheme})` : ''}`}
          >
            {option.icon}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Theme</div>
      <div className="flex gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => setThemeMode(option.value)}
            className={`flex-1 flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              themeMode === option.value
                ? 'bg-aqua-500/20 border border-aqua-500/50 text-aqua-400'
                : 'bg-slate-800/50 border border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            <span className="text-base">{option.icon}</span>
            <span>{option.label}</span>
          </button>
        ))}
      </div>
      {themeMode === 'auto' && (
        <div className="text-[10px] text-slate-500 text-center">
          Using system preference ({resolvedTheme})
        </div>
      )}
    </div>
  );
};
