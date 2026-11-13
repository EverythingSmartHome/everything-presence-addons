/**
 * Bounded in-memory log buffer used while a debug session is recording.
 *
 * It doubles as a pino destination stream (`write(line)`), so it can be a
 * member of `pino.multistream`. Entries are only stored while recording; when
 * either the entry or byte limit is exceeded the oldest entries are dropped
 * and counted, so the newest activity (the reproduction) is always kept.
 */

export type LogEntry = Record<string, unknown>;

export interface LogBufferOptions {
  maxEntries: number;
  maxBytes: number;
}

export interface LogBufferSnapshot {
  entries: LogEntry[];
  dropped: number;
  bytes: number;
  maxEntries: number;
  maxBytes: number;
}

export const SERVER_LOG_BUFFER_LIMITS: LogBufferOptions = { maxEntries: 10_000, maxBytes: 5 * 1024 * 1024 };
export const CLIENT_LOG_BUFFER_LIMITS: LogBufferOptions = { maxEntries: 2_000, maxBytes: 1024 * 1024 };

interface StoredEntry {
  entry: LogEntry;
  bytes: number;
}

export class LogBuffer {
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private items: StoredEntry[] = [];
  private head = 0;
  private totalBytes = 0;
  private droppedCount = 0;
  private recording = false;

  constructor(options: LogBufferOptions) {
    this.maxEntries = Math.max(1, options.maxEntries);
    this.maxBytes = Math.max(1, options.maxBytes);
  }

  get isRecording(): boolean {
    return this.recording;
  }

  get size(): number {
    return this.items.length - this.head;
  }

  get dropped(): number {
    return this.droppedCount;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  /** Clear previous contents and start recording. */
  start(): void {
    this.clear();
    this.recording = true;
  }

  /** Stop recording; existing entries stay available for export. */
  stop(): void {
    this.recording = false;
  }

  clear(): void {
    this.items = [];
    this.head = 0;
    this.totalBytes = 0;
    this.droppedCount = 0;
  }

  /** pino destination interface: one serialized JSON line per call. */
  write(line: string): void {
    if (!this.recording) {
      return;
    }
    let entry: LogEntry;
    try {
      const parsed = JSON.parse(line);
      entry = parsed && typeof parsed === 'object' ? (parsed as LogEntry) : { msg: String(parsed) };
    } catch {
      entry = { msg: String(line).trim() };
    }
    this.store(entry, Buffer.byteLength(line, 'utf8'));
  }

  /** Append an already structured entry (client logs, session markers). */
  push(entry: LogEntry): void {
    if (!this.recording) {
      return;
    }
    let bytes: number;
    try {
      bytes = Buffer.byteLength(JSON.stringify(entry), 'utf8');
    } catch {
      return;
    }
    this.store(entry, bytes);
  }

  snapshot(): LogBufferSnapshot {
    return {
      entries: this.items.slice(this.head).map((item) => item.entry),
      dropped: this.droppedCount,
      bytes: this.totalBytes,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
    };
  }

  private store(entry: LogEntry, bytes: number): void {
    this.items.push({ entry, bytes });
    this.totalBytes += bytes;

    while (this.size > this.maxEntries || (this.totalBytes > this.maxBytes && this.size > 0)) {
      const removed = this.items[this.head];
      this.head += 1;
      this.totalBytes -= removed.bytes;
      this.droppedCount += 1;
    }

    // Compact occasionally so dropped entries can be garbage collected.
    if (this.head > 1024 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
  }
}
