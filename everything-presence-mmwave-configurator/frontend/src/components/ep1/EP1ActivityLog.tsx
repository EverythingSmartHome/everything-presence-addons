import React, { useEffect, useRef, useState } from 'react';
import { ActivityEvent, ActivityEventType, getActivityEventDetails, formatTimeAgo, formatDuration } from './ep1Utils';

interface EP1ActivityLogProps {
  presence: boolean;
  mmwave: boolean;
  pir: boolean;
  maxEvents?: number;
}

export const EP1ActivityLog: React.FC<EP1ActivityLogProps> = ({
  presence,
  mmwave,
  pir,
  maxEvents = 15,
}) => {
  const [collapsed, setCollapsed] = useState(true);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [currentSessionStart, setCurrentSessionStart] = useState<number | null>(null);
  const [lastPresenceChange, setLastPresenceChange] = useState<number | null>(null);

  // Track previous values to detect changes
  const prevValues = useRef({ presence, mmwave, pir });

  useEffect(() => {
    const now = Date.now();
    const newEvents: ActivityEvent[] = [];

    // Check for presence changes
    if (presence !== prevValues.current.presence) {
      const type: ActivityEventType = presence ? 'presence_on' : 'presence_off';
      const details = getActivityEventDetails(type);
      newEvents.push({
        id: `${type}-${now}`,
        type,
        timestamp: now,
        label: details.label,
        color: details.color,
      });

      // Track session timing
      if (presence) {
        setCurrentSessionStart(now);
      } else {
        setCurrentSessionStart(null);
      }
      setLastPresenceChange(now);
    }

    // Check for mmwave changes
    if (mmwave !== prevValues.current.mmwave) {
      const type: ActivityEventType = mmwave ? 'mmwave_on' : 'mmwave_off';
      const details = getActivityEventDetails(type);
      newEvents.push({
        id: `${type}-${now}`,
        type,
        timestamp: now,
        label: details.label,
        color: details.color,
      });
    }

    // Check for PIR changes
    if (pir !== prevValues.current.pir) {
      const type: ActivityEventType = pir ? 'pir_on' : 'pir_off';
      const details = getActivityEventDetails(type);
      newEvents.push({
        id: `${type}-${now}`,
        type,
        timestamp: now,
        label: details.label,
        color: details.color,
      });
    }

    // Add new events and trim to max
    if (newEvents.length > 0) {
      setEvents((prev) => [...newEvents, ...prev].slice(0, maxEvents));
    }

    // Update previous values
    prevValues.current = { presence, mmwave, pir };
  }, [presence, mmwave, pir, maxEvents]);

  // Update time display every second
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => forceUpdate((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Calculate current session duration
  const sessionDuration = currentSessionStart ? (Date.now() - currentSessionStart) / 1000 : null;

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between text-sm font-semibold text-slate-200 hover:text-white transition-colors"
      >
        <span>Activity Log</span>
        <div className="flex items-center gap-2">
          {events.length > 0 && (
            <span
              onClick={(e) => { e.stopPropagation(); setEvents([]); }}
              className="text-[10px] text-slate-500 hover:text-slate-400 transition-colors font-normal"
            >
              Clear
            </span>
          )}
          <span className={`text-slate-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}>▲</span>
        </div>
      </button>

      {!collapsed && (
        <>
      {/* Current Status Summary */}
      <div className="grid grid-cols-2 gap-2 mb-3 mt-3">
        {/* Time Since Last Change */}
        <div className="bg-slate-800/50 rounded-lg p-2">
          <div className="text-[10px] text-slate-500 mb-0.5">Last Change</div>
          <div className="text-sm font-medium text-slate-200">
            {lastPresenceChange ? formatTimeAgo(lastPresenceChange) : '--'}
          </div>
        </div>

        {/* Current Session Duration */}
        <div className="bg-slate-800/50 rounded-lg p-2">
          <div className="text-[10px] text-slate-500 mb-0.5">
            {presence ? 'Session Duration' : 'Time Since Clear'}
          </div>
          <div className={`text-sm font-medium ${presence ? 'text-emerald-400' : 'text-slate-400'}`}>
            {sessionDuration !== null
              ? formatDuration(sessionDuration)
              : lastPresenceChange
              ? formatDuration((Date.now() - lastPresenceChange) / 1000)
              : '--'}
          </div>
        </div>
      </div>

      {/* Event List */}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {events.length === 0 ? (
          <div className="text-xs text-slate-500 text-center py-4">
            No events recorded yet.
            <br />
            Events will appear as presence changes.
          </div>
        ) : (
          events.map((event) => {
            const details = getActivityEventDetails(event.type);
            return (
              <div
                key={event.id}
                className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-slate-700/30 transition-colors"
              >
                <span className="text-sm">{details.emoji}</span>
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-medium ${event.color}`}>{event.label}</span>
                </div>
                <span className="text-[10px] text-slate-500 whitespace-nowrap">
                  {formatTimeAgo(event.timestamp)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Event Count */}
      {events.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-700/50 text-[10px] text-slate-500 text-center">
          Showing {events.length} of last {maxEvents} events
        </div>
      )}
        </>
      )}
    </div>
  );
};
