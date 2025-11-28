/**
 * EP1 Dashboard Utility Functions
 * Shared calculations and thresholds for EP1 monitoring features
 */

// ============================================================================
// CO2 Thresholds and Utilities
// ============================================================================

export interface CO2Level {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
}

export const getCO2Level = (ppm: number): CO2Level => {
  if (ppm < 800) {
    return {
      label: 'Good',
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
      borderColor: 'border-emerald-500/30',
      description: 'Fresh air, excellent ventilation',
    };
  } else if (ppm < 1000) {
    return {
      label: 'Moderate',
      color: 'text-yellow-400',
      bgColor: 'bg-yellow-500/10',
      borderColor: 'border-yellow-500/30',
      description: 'Acceptable, consider ventilation',
    };
  } else if (ppm < 2000) {
    return {
      label: 'Poor',
      color: 'text-orange-400',
      bgColor: 'bg-orange-500/10',
      borderColor: 'border-orange-500/30',
      description: 'Stale air, open windows recommended',
    };
  } else {
    return {
      label: 'Unhealthy',
      color: 'text-red-400',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/30',
      description: 'Poor air quality, ventilate immediately',
    };
  }
};

// ============================================================================
// Comfort Index Calculations
// ============================================================================

export interface ComfortLevel {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  emoji: string;
}

/**
 * Calculate dew point using Magnus formula approximation
 * @param tempC Temperature in Celsius
 * @param humidity Relative humidity percentage (0-100)
 * @returns Dew point in Celsius
 */
export const calculateDewPoint = (tempC: number, humidity: number): number => {
  // Magnus formula constants
  const a = 17.27;
  const b = 237.7;

  const alpha = ((a * tempC) / (b + tempC)) + Math.log(humidity / 100);
  const dewPoint = (b * alpha) / (a - alpha);

  return Math.round(dewPoint * 10) / 10;
};

/**
 * Calculate heat index (feels like temperature)
 * Only meaningful when temp > 27°C and humidity > 40%
 * @param tempC Temperature in Celsius
 * @param humidity Relative humidity percentage
 * @returns Heat index in Celsius, or null if not applicable
 */
export const calculateHeatIndex = (tempC: number, humidity: number): number | null => {
  // Heat index is only meaningful in warm conditions
  if (tempC < 27 || humidity < 40) {
    return null;
  }

  // Rothfusz regression equation (converted from Fahrenheit formula)
  const T = tempC;
  const RH = humidity;

  const HI = -8.785 +
    1.611 * T +
    2.339 * RH -
    0.146 * T * RH -
    0.012 * T * T -
    0.016 * RH * RH +
    0.002 * T * T * RH +
    0.001 * T * RH * RH -
    0.000002 * T * T * RH * RH;

  return Math.round(HI * 10) / 10;
};

/**
 * Get comfort level based on temperature and humidity
 */
export const getComfortLevel = (tempC: number, humidity: number): ComfortLevel => {
  // Temperature zones
  const isCold = tempC < 18;
  const isCool = tempC >= 18 && tempC < 20;
  const isOptimal = tempC >= 20 && tempC <= 24;
  const isWarm = tempC > 24 && tempC <= 26;
  const isHot = tempC > 26;

  // Humidity zones
  const isDry = humidity < 30;
  const isLowHumidity = humidity >= 30 && humidity < 40;
  const isOptimalHumidity = humidity >= 40 && humidity <= 60;
  const isHighHumidity = humidity > 60 && humidity <= 70;
  const isVeryHumid = humidity > 70;

  // Determine comfort level
  if (isOptimal && isOptimalHumidity) {
    return {
      label: 'Comfortable',
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
      borderColor: 'border-emerald-500/30',
      emoji: '😊',
    };
  }

  if ((isOptimal || isCool || isWarm) && (isOptimalHumidity || isLowHumidity || isHighHumidity)) {
    return {
      label: 'Acceptable',
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/30',
      emoji: '🙂',
    };
  }

  if (isCold) {
    return {
      label: 'Too Cold',
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-500/10',
      borderColor: 'border-cyan-500/30',
      emoji: '🥶',
    };
  }

  if (isHot && isVeryHumid) {
    return {
      label: 'Hot & Humid',
      color: 'text-red-400',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/30',
      emoji: '🥵',
    };
  }

  if (isHot) {
    return {
      label: 'Too Hot',
      color: 'text-orange-400',
      bgColor: 'bg-orange-500/10',
      borderColor: 'border-orange-500/30',
      emoji: '🔥',
    };
  }

  if (isDry) {
    return {
      label: 'Too Dry',
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/30',
      emoji: '🏜️',
    };
  }

  if (isVeryHumid) {
    return {
      label: 'Too Humid',
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/30',
      emoji: '💧',
    };
  }

  return {
    label: 'Moderate',
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/10',
    borderColor: 'border-slate-500/30',
    emoji: '😐',
  };
};

// ============================================================================
// Light Level Utilities
// ============================================================================

export interface LightLevel {
  label: string;
  color: string;
  recommendation: string;
  emoji: string;
}

export const getLightLevel = (lux: number): LightLevel => {
  if (lux < 10) {
    return {
      label: 'Dark',
      color: 'text-slate-500',
      recommendation: 'Too dark for most activities',
      emoji: '🌑',
    };
  } else if (lux < 50) {
    return {
      label: 'Dim',
      color: 'text-slate-400',
      recommendation: 'Low light - suitable for relaxation',
      emoji: '🌙',
    };
  } else if (lux < 200) {
    return {
      label: 'Low',
      color: 'text-yellow-600',
      recommendation: 'Ambient lighting - basic tasks',
      emoji: '💡',
    };
  } else if (lux < 500) {
    return {
      label: 'Moderate',
      color: 'text-yellow-400',
      recommendation: 'Good for general activities',
      emoji: '☀️',
    };
  } else if (lux < 1000) {
    return {
      label: 'Bright',
      color: 'text-amber-400',
      recommendation: 'Ideal for reading & detailed work',
      emoji: '🌤️',
    };
  } else {
    return {
      label: 'Very Bright',
      color: 'text-orange-400',
      recommendation: 'Very bright - may cause glare',
      emoji: '🌞',
    };
  }
};

// ============================================================================
// Activity Log Types
// ============================================================================

export type ActivityEventType =
  | 'presence_on'
  | 'presence_off'
  | 'mmwave_on'
  | 'mmwave_off'
  | 'pir_on'
  | 'pir_off';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  timestamp: number;
  label: string;
  color: string;
}

export const getActivityEventDetails = (type: ActivityEventType): { label: string; color: string; emoji: string } => {
  switch (type) {
    case 'presence_on':
      return { label: 'Presence detected', color: 'text-emerald-400', emoji: '👤' };
    case 'presence_off':
      return { label: 'Presence cleared', color: 'text-slate-400', emoji: '👻' };
    case 'mmwave_on':
      return { label: 'mmWave triggered', color: 'text-blue-400', emoji: '📡' };
    case 'mmwave_off':
      return { label: 'mmWave cleared', color: 'text-slate-400', emoji: '📡' };
    case 'pir_on':
      return { label: 'PIR motion', color: 'text-purple-400', emoji: '🔴' };
    case 'pir_off':
      return { label: 'PIR cleared', color: 'text-slate-400', emoji: '⚪' };
  }
};

// ============================================================================
// Statistics Utilities
// ============================================================================

export interface DailyStats {
  date: string; // YYYY-MM-DD
  deviceId: string;
  occupancySeconds: number;
  totalSeconds: number;
  tempSum: number;
  tempCount: number;
  tempMin: number | null;
  tempMax: number | null;
  detectionEvents: number;
  lastUpdate: number;
}

export const createEmptyStats = (deviceId: string, date: string): DailyStats => ({
  date,
  deviceId,
  occupancySeconds: 0,
  totalSeconds: 0,
  tempSum: 0,
  tempCount: 0,
  tempMin: null,
  tempMax: null,
  detectionEvents: 0,
  lastUpdate: Date.now(),
});

export const getStatsKey = (deviceId: string, date: string): string => {
  return `ep1_stats_${deviceId}_${date}`;
};

export const getTodayDateString = (): string => {
  return new Date().toISOString().split('T')[0];
};

export const formatDuration = (seconds: number): string => {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
};

export const formatTimeAgo = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};
