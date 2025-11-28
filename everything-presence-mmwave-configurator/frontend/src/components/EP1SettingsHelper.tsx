import React from 'react';
import { RoomConfig, EP1Config, EP1Mode } from '../api/types';

interface EP1SettingsHelperProps {
  room: RoomConfig;
  config: EP1Config;
  onModeChange?: (mode: EP1Mode) => void;
}

export const EP1SettingsHelper: React.FC<EP1SettingsHelperProps> = ({ room, config, onModeChange }) => {
  // Calculate room dimensions and diagonal
  const calculateRoomMetrics = () => {
    if (!room.roomShell || room.roomShell.points.length < 3) {
      return null;
    }

    const points = room.roomShell.points;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    points.forEach(p => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });

    const widthMm = maxX - minX;
    const heightMm = maxY - minY;
    const diagonalMm = Math.sqrt(widthMm ** 2 + heightMm ** 2);

    return {
      width: widthMm / 1000, // Convert to meters
      height: heightMm / 1000,
      diagonal: diagonalMm / 1000,
    };
  };

  // Calculate optimal settings based on room size
  const calculateOptimalSettings = () => {
    const metrics = calculateRoomMetrics();
    if (!metrics) {
      return {
        maxDistance: 12.0,
        triggerDistance: 6.0,
        sensitivity: 7,
      };
    }

    // Max distance: cover room diagonal + 10% buffer, capped at 25m
    const maxDistance = Math.min(Math.ceil(metrics.diagonal * 1.1), 25);

    // Trigger distance: 75% of max distance
    const triggerDistance = Math.round(maxDistance * 0.75 * 10) / 10;

    // Sensitivity: lower for large rooms (reduce false positives)
    const area = metrics.width * metrics.height;
    const sensitivity = area > 20 ? 6 : 7;

    return {
      maxDistance,
      triggerDistance,
      sensitivity,
    };
  };

  // Generate context-specific tips
  const generateTips = () => {
    const metrics = calculateRoomMetrics();
    const tips: string[] = [];

    if (metrics) {
      tips.push(`Your room is ${metrics.width.toFixed(1)}m × ${metrics.height.toFixed(1)}m (diagonal: ${metrics.diagonal.toFixed(1)}m)`);

      if (metrics.diagonal > 8) {
        tips.push('Large room detected - consider increasing sensitivity for better coverage');
      } else if (metrics.diagonal < 4) {
        tips.push('Small room detected - lower sensitivity may reduce false positives');
      }
    }

    if (config.mode === 'Presence Detection') {
      tips.push('Presence Detection mode is optimized for battery life and simple occupancy');
    } else if (config.mode === 'Distance and Speed') {
      tips.push('Distance & Speed mode provides target distance but uses more power');
    }

    return tips;
  };

  const roomMetrics = calculateRoomMetrics();
  const optimal = calculateOptimalSettings();
  const tips = generateTips();

  return (
    <div className="space-y-4">
      {/* Mode Indicator */}
      <div className="rounded-xl border border-purple-600/30 bg-purple-600/10 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></div>
            <span className="text-sm font-semibold text-purple-100">Current Mode</span>
          </div>
          {onModeChange && (
            <button
              onClick={() => {
                const newMode = config.mode === 'Presence Detection' ? 'Distance and Speed' : 'Presence Detection';
                if (confirm(`Switch to ${newMode} mode? The sensor will restart.`)) {
                  onModeChange(newMode as EP1Mode);
                }
              }}
              className="text-xs px-3 py-1 rounded-lg border border-purple-400/50 bg-purple-500/20 text-purple-100 hover:bg-purple-500/30 transition-colors"
            >
              Switch Mode
            </button>
          )}
        </div>
        <div className="text-lg font-bold text-purple-50">
          {config.mode || 'Unknown'}
        </div>
      </div>

      {/* Room Metrics & Recommendations */}
      {roomMetrics && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Settings Recommendations</h3>

          <div className="space-y-3">
            {/* Current vs Recommended */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-400 text-xs mb-1">Max Distance</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-slate-100 font-semibold">{config.distanceMax ?? '--'}m</span>
                  {config.distanceMax !== optimal.maxDistance && (
                    <span className="text-emerald-400 text-xs">→ {optimal.maxDistance}m</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-slate-400 text-xs mb-1">Trigger Distance</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-slate-100 font-semibold">{config.triggerDistance ?? '--'}m</span>
                  {config.triggerDistance !== optimal.triggerDistance && (
                    <span className="text-emerald-400 text-xs">→ {optimal.triggerDistance}m</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-slate-400 text-xs mb-1">Sensitivity</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-slate-100 font-semibold">{config.sensitivity ?? '--'}</span>
                  {config.sensitivity !== optimal.sensitivity && (
                    <span className="text-emerald-400 text-xs">→ {optimal.sensitivity}</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-slate-400 text-xs mb-1">Off Latency</div>
                <div className="text-slate-100 font-semibold">{config.offLatency ?? '--'}s</div>
              </div>
            </div>

            {/* Tips */}
            {tips.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-700">
                <div className="text-xs font-semibold text-slate-300 mb-2">💡 Tips</div>
                <ul className="space-y-1">
                  {tips.map((tip, i) => (
                    <li key={i} className="text-xs text-slate-400 pl-3 relative before:content-['•'] before:absolute before:left-0">
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* No room shell warning */}
      {!roomMetrics && (
        <div className="rounded-xl border border-amber-600/30 bg-amber-600/10 p-4">
          <div className="text-sm text-amber-200">
            Draw your room layout to get personalized settings recommendations
          </div>
        </div>
      )}
    </div>
  );
};
