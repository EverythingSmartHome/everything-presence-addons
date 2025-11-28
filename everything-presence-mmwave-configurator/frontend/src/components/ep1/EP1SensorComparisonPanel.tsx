import React, { useState } from 'react';

interface EP1SensorComparisonPanelProps {
  presence: boolean;
  mmwave: boolean;
  pir: boolean;
}

export const EP1SensorComparisonPanel: React.FC<EP1SensorComparisonPanelProps> = ({
  presence,
  mmwave,
  pir,
}) => {
  const [collapsed, setCollapsed] = useState(true);

  // Determine agreement status
  const bothActive = mmwave && pir;
  const bothInactive = !mmwave && !pir;
  const inAgreement = bothActive || bothInactive;

  // Determine which sensor is driving presence
  const drivingSensor = presence
    ? mmwave && pir
      ? 'Both'
      : mmwave
      ? 'mmWave'
      : pir
      ? 'PIR'
      : 'Unknown'
    : 'None';

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between text-sm font-semibold text-slate-200 hover:text-white transition-colors"
      >
        <span>Sensor Comparison</span>
        <span className={`text-slate-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}>▲</span>
      </button>

      {!collapsed && (
        <>
      {/* Sensor Status Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4 mt-3">
        {/* mmWave Sensor */}
        <div
          className={`rounded-lg p-3 border transition-all ${
            mmwave
              ? 'border-blue-500/50 bg-blue-500/10'
              : 'border-slate-700 bg-slate-800/50'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                mmwave ? 'bg-blue-400 animate-pulse' : 'bg-slate-600'
              }`}
            />
            <span className="text-xs font-semibold text-slate-300">mmWave</span>
          </div>
          <div className={`text-sm font-medium ${mmwave ? 'text-blue-400' : 'text-slate-500'}`}>
            {mmwave ? 'Detecting' : 'Clear'}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            Radar-based, static presence
          </div>
        </div>

        {/* PIR Sensor */}
        <div
          className={`rounded-lg p-3 border transition-all ${
            pir
              ? 'border-purple-500/50 bg-purple-500/10'
              : 'border-slate-700 bg-slate-800/50'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                pir ? 'bg-purple-400 animate-pulse' : 'bg-slate-600'
              }`}
            />
            <span className="text-xs font-semibold text-slate-300">PIR</span>
          </div>
          <div className={`text-sm font-medium ${pir ? 'text-purple-400' : 'text-slate-500'}`}>
            {pir ? 'Motion' : 'No Motion'}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            Infrared, movement-based
          </div>
        </div>
      </div>

      {/* Agreement Status */}
      <div
        className={`rounded-lg p-3 border ${
          inAgreement
            ? 'border-emerald-500/30 bg-emerald-500/10'
            : 'border-amber-500/30 bg-amber-500/10'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`text-lg ${inAgreement ? 'text-emerald-400' : 'text-amber-400'}`}
            >
              {inAgreement ? '✓' : '⚡'}
            </span>
            <div>
              <div
                className={`text-sm font-medium ${
                  inAgreement ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {inAgreement ? 'Sensors Agree' : 'Sensors Differ'}
              </div>
              <div className="text-[10px] text-slate-500">
                {inAgreement
                  ? bothActive
                    ? 'Both detecting presence'
                    : 'Both showing clear'
                  : mmwave && !pir
                  ? 'mmWave active, PIR inactive (static presence?)'
                  : 'PIR active, mmWave inactive (fast movement?)'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Driving Sensor */}
      {presence && (
        <div className="mt-3 pt-3 border-t border-slate-700/50">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Primary detection by:</span>
            <span
              className={`font-medium ${
                drivingSensor === 'Both'
                  ? 'text-emerald-400'
                  : drivingSensor === 'mmWave'
                  ? 'text-blue-400'
                  : drivingSensor === 'PIR'
                  ? 'text-purple-400'
                  : 'text-slate-400'
              }`}
            >
              {drivingSensor}
            </span>
          </div>
        </div>
      )}

      {/* Sensor Info */}
      <div className="mt-3 pt-3 border-t border-slate-700/50">
        <details className="group">
          <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-400 transition-colors">
            How sensors work together
          </summary>
          <div className="mt-2 text-[10px] text-slate-500 leading-relaxed">
            <p className="mb-1">
              <strong className="text-blue-400">mmWave</strong>: Detects stationary and moving objects using radar.
              Best for static presence (sitting, sleeping).
            </p>
            <p>
              <strong className="text-purple-400">PIR</strong>: Detects heat movement from people/animals.
              Best for detecting motion (walking, moving).
            </p>
          </div>
        </details>
      </div>
        </>
      )}
    </div>
  );
};
