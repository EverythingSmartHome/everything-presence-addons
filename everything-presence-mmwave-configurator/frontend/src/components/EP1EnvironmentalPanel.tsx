import React from 'react';
import { EP1EnvironmentalData } from '../api/types';
import { getLightLevel } from './ep1/ep1Utils';

interface EP1EnvironmentalPanelProps {
  environmental: EP1EnvironmentalData;
  co2?: number | null;
}

export const EP1EnvironmentalPanel: React.FC<EP1EnvironmentalPanelProps> = ({ environmental, co2 }) => {
  const { temperature, humidity, illuminance } = environmental;

  // Format values with fallback for null
  const tempDisplay = temperature !== null ? `${temperature.toFixed(1)}°C` : '--';
  const humidityDisplay = humidity !== null ? `${humidity.toFixed(1)}%` : '--';
  const illuminanceDisplay = illuminance !== null ? `${Math.round(illuminance)} lx` : '--';

  // Get light level context
  const lightLevel = illuminance !== null ? getLightLevel(illuminance) : null;

  // Check if CO2 sensor is available
  const hasCO2 = co2 !== null && co2 !== undefined;
  const gridCols = hasCO2 ? 'grid-cols-4' : 'grid-cols-3';

  return (
    <div className={`grid ${gridCols} gap-3`}>
      {/* Temperature Card */}
      <div className="rounded-xl border border-orange-600/30 bg-gradient-to-br from-orange-600/10 to-orange-600/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-2xl">🌡️</div>
          <div className="text-xs font-semibold text-orange-200/70 uppercase tracking-wide">Temperature</div>
        </div>
        <div className="text-3xl font-bold text-orange-100">{tempDisplay}</div>
      </div>

      {/* Humidity Card */}
      <div className="rounded-xl border border-blue-600/30 bg-gradient-to-br from-blue-600/10 to-blue-600/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-2xl">💧</div>
          <div className="text-xs font-semibold text-blue-200/70 uppercase tracking-wide">Humidity</div>
        </div>
        <div className="text-3xl font-bold text-blue-100">{humidityDisplay}</div>
      </div>

      {/* Illuminance Card with Light Level Context */}
      <div className="rounded-xl border border-yellow-600/30 bg-gradient-to-br from-yellow-600/10 to-yellow-600/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-2xl">{lightLevel?.emoji || '💡'}</div>
          <div className="text-xs font-semibold text-yellow-200/70 uppercase tracking-wide">Light</div>
        </div>
        <div className="text-3xl font-bold text-yellow-100">{illuminanceDisplay}</div>
        {lightLevel && (
          <div className="mt-2 pt-2 border-t border-yellow-600/20">
            <div className={`text-xs font-medium ${lightLevel.color}`}>{lightLevel.label}</div>
            <div className="text-[10px] text-yellow-200/50 mt-0.5 leading-tight">{lightLevel.recommendation}</div>
          </div>
        )}
      </div>

      {/* CO2 Card (only if sensor available) */}
      {hasCO2 && (
        <div className="rounded-xl border border-emerald-600/30 bg-gradient-to-br from-emerald-600/10 to-emerald-600/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-2xl">🌬️</div>
            <div className="text-xs font-semibold text-emerald-200/70 uppercase tracking-wide">CO2</div>
          </div>
          <div className="text-3xl font-bold text-emerald-100">{Math.round(co2!)} <span className="text-lg">ppm</span></div>
        </div>
      )}
    </div>
  );
};
