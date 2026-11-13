import { LOG_LEVELS, LogLevelName } from './apiClient';

/**
 * ESPHome log lines arrive pre-formatted with ANSI colours, e.g.
 *   "\x1b[0;36m[D][ld2450:123]: Target 1 moved\x1b[0m"
 * The line number after the tag is present on newer ESPHome versions only.
 */

export interface ParsedLogLine {
  level: LogLevelName;
  tag: string | null;
  msg: string;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const LINE = /^\[(VV|[EWICDV])\]\[([^\]]+?)(?::\d+)?\]:\s?([\s\S]*)$/;

export const stripAnsi = (text: string): string => text.replace(ANSI, '');

export const parseLogLine = (level: number, raw: string): ParsedLogLine => {
  const levelName: LogLevelName = LOG_LEVELS[level] ?? 'DEBUG';
  const text = stripAnsi(raw).replace(/\s+$/, '');
  const match = LINE.exec(text);
  if (!match) {
    return { level: levelName, tag: null, msg: text };
  }
  return { level: levelName, tag: match[2], msg: match[3] };
};
