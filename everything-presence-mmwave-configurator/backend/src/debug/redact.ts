/**
 * Deep redaction for exported debug bundles.
 *
 * - Secrets are always removed: values under token/password/auth/cookie/
 *   API key/PSK-like keys, Bearer credentials and JWT-shaped strings anywhere
 *   (including inside log messages), and any explicitly supplied secret value.
 *   Inside free text, values of credential/SSID assignments (`"key":"v"`,
 *   `key=v`, `key: v`) are replaced, and strings that are whole JSON
 *   documents are parsed and redacted structurally.
 * - MAC addresses (colon/dash form, bare 12-hex, the ESPHome unique_id prefix
 *   even when all digits, and any 12-hex value under MAC/unique_id keys)
 *   become stable placeholders `mac#N`.
 * - IP addresses become `ip#N` unless `includeNetworkDetails` is set.
 * - SSID/BSSID fields are dropped (and their values removed from text).
 */

export interface RedactOptions {
  includeNetworkDetails?: boolean;
  /** Exact secret values to scrub wherever they appear. */
  knownSecrets?: string[];
}

export const REDACTED = '[REDACTED]';

const SECRET_WORDS = 'token|passw|secret|auth|cookie|api[_-]?key|apikey|psk|credential|private[_-]?key';
const SECRET_KEY = new RegExp(`(${SECRET_WORDS})`, 'i');
const DROP_KEY = /^(b?ssid|wifi[_-]?b?ssid|.*[_-]b?ssid)$/i;
const SENSITIVE_STATE_ENTITY = /(b?ssid)/i;

// Keys whose values are removed when they appear inside free text (log messages,
// stringified console objects, response bodies, error messages).
const TEXT_KEY = `[A-Za-z0-9_.-]*(?:${SECRET_WORDS}|ssid)[A-Za-z0-9_.-]*`;
// "key": "value" / 'key': 123 (JSON or JS-object style).
const TEXT_JSON_ASSIGNMENT = new RegExp(
  `(["'])(${TEXT_KEY})\\1(\\s*:\\s*)(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|-?\\d[\\d.eE+-]*)`,
  'gi',
);
// \"key\":\"value\" (JSON escaped inside another JSON string).
const TEXT_ESCAPED_JSON_ASSIGNMENT = new RegExp(
  `(\\\\")(${TEXT_KEY})\\\\"(\\s*:\\s*)(?:\\\\"(?:[^\\\\]|\\\\(?!"))*\\\\"|-?\\d[\\d.eE+-]*)`,
  'gi',
);
// key=value / key: value (unquoted key); quoted values honour escaped quotes.
const TEXT_PLAIN_ASSIGNMENT = new RegExp(
  `(?<![A-Za-z0-9_.-])(${TEXT_KEY})(\\s*[=:]\\s*)(?!\\[REDACTED\\])("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[^\\s,;&}\\]"')]+)`,
  'gi',
);
// Fallback for values the passes above could not close: an unterminated quote
// (text cut at a length limit) or deeper escaping (\\\"key\\\":\\\"v\\\"). The key may be
// bare or quoted with any number of backslashes; everything from the value's
// opening quote to the end of the line is removed.
const TEXT_OPEN_ASSIGNMENT = new RegExp(
  `(?<![A-Za-z0-9_.-])(\\\\*["']?)(${TEXT_KEY})\\1(\\s*[=:]\\s*)(\\\\*["'])(?!\\[REDACTED\\])[^\\r\\n]*`,
  'gi',
);

// Keys whose string values hold MACs even when the MAC is all digits.
const MAC_KEY = /^(mac|mac_address|macAddress|unique_id|uniqueId)$/i;
const MAC_CONTAINER_KEY = 'entityUniqueIds';
const MAC_ANY_12HEX = /(?<![0-9A-Fa-f])[0-9A-Fa-f]{12}(?![0-9A-Fa-f])/g;
// ESPHome unique_id form anywhere in text: a 12-hex MAC (possibly all digits) at a
// word boundary, followed by - or _. Skips UUID tails (xxxx-<12 hex>).
const MAC_UNIQUE_ID_PREFIX = /(?<![0-9A-Za-z_])(?<![0-9A-Fa-f]{4}-)[0-9A-Fa-f]{12}(?=[-_])/g;
const MAX_JSON_TEXT = 1024 * 1024;

const BEARER = /\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const QUERY_SECRET = /([?&](?:access_token|token|api_key|apikey|password|auth)=)[^&\s"']+/gi;
const MAC_SEPARATED = /(?<![0-9A-Fa-f:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:-])/g;
// Bare 12-hex MACs (ESPHome unique_ids). Skips UUID tails (xxxx-<12 hex>) and all-digit numbers.
const MAC_BARE = /(?<![0-9A-Fa-f])(?<![0-9A-Fa-f]{4}-)(?=[0-9]*[A-Fa-f])[0-9A-Fa-f]{12}(?![0-9A-Fa-f])/g;
const IPV4 = /(?<![\d.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?![\d.])/g;
const IPV6 =
  /(?<![\w:])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?|::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6}))(?![\w:.])/g;

export interface Redactor {
  redact<T>(value: T): T;
  redactString(value: string): string;
  readonly stats: { macs: number; ips: number };
}

export const createRedactor = (options: RedactOptions = {}): Redactor => {
  const macs = new Map<string, string>();
  const ips = new Map<string, string>();
  const secrets = (options.knownSecrets ?? []).filter((s) => typeof s === 'string' && s.length >= 6);

  const macPlaceholder = (raw: string): string => {
    const normalized = raw.replace(/[:-]/g, '').toLowerCase();
    let placeholder = macs.get(normalized);
    if (!placeholder) {
      placeholder = `mac#${macs.size + 1}`;
      macs.set(normalized, placeholder);
    }
    return placeholder;
  };

  const ipPlaceholder = (raw: string): string => {
    const normalized = raw.toLowerCase();
    let placeholder = ips.get(normalized);
    if (!placeholder) {
      placeholder = `ip#${ips.size + 1}`;
      ips.set(normalized, placeholder);
    }
    return placeholder;
  };

  /** Strings that are whole JSON documents are redacted structurally. */
  const redactJsonText = (input: string): string | null => {
    const trimmed = input.trim();
    if (trimmed.length < 2 || trimmed.length > MAX_JSON_TEXT) return null;
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed === null || typeof parsed !== 'object') return null;
      return JSON.stringify(walk(parsed, new WeakSet(), false));
    } catch {
      return null;
    }
  };

  const redactText = (input: string): string => {
    let out = input;
    for (const secret of secrets) {
      if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    }
    out = out.replace(BEARER, `$1 ${REDACTED}`);
    out = out.replace(JWT, REDACTED);
    out = out.replace(QUERY_SECRET, `$1${REDACTED}`);
    out = out.replace(TEXT_JSON_ASSIGNMENT, `$1$2$1$3"${REDACTED}"`);
    out = out.replace(TEXT_ESCAPED_JSON_ASSIGNMENT, `$1$2\\"$3\\"${REDACTED}\\"`);
    out = out.replace(TEXT_PLAIN_ASSIGNMENT, `$1$2${REDACTED}`);
    out = out.replace(TEXT_OPEN_ASSIGNMENT, `$1$2$1$3$4${REDACTED}`);
    out = out.replace(MAC_SEPARATED, macPlaceholder);
    out = out.replace(MAC_UNIQUE_ID_PREFIX, macPlaceholder);
    out = out.replace(MAC_BARE, macPlaceholder);
    if (!options.includeNetworkDetails) {
      out = out.replace(IPV4, ipPlaceholder);
      out = out.replace(IPV6, ipPlaceholder);
    }
    return out;
  };

  const redactString = (input: string): string => redactJsonText(input) ?? redactText(input);

  const walk = (value: unknown, seen: WeakSet<object>, macContext: boolean): unknown => {
    if (typeof value === 'string') {
      return redactString(macContext ? value.replace(MAC_ANY_12HEX, macPlaceholder) : value);
    }
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (Array.isArray(value)) {
      const result = value.map((item) => walk(item, seen, macContext));
      seen.delete(value);
      return result;
    }

    const source = value as Record<string, unknown>;
    const entityId = typeof source.entity_id === 'string' ? source.entity_id : typeof source.entityId === 'string' ? source.entityId : '';
    const dropStateFields = entityId !== '' && SENSITIVE_STATE_ENTITY.test(entityId);
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source)) {
      if (DROP_KEY.test(key)) continue;
      if (dropStateFields && (key === 'state' || key === 'attributes')) continue;
      const safeKey = macContext ? redactText(key.replace(MAC_ANY_12HEX, macPlaceholder)) : redactText(key);
      if (SECRET_KEY.test(key) && child !== null && child !== undefined && typeof child !== 'boolean') {
        result[safeKey] = REDACTED;
        continue;
      }
      result[safeKey] = walk(child, seen, macContext || MAC_KEY.test(key) || key === MAC_CONTAINER_KEY);
    }
    seen.delete(value);
    return result;
  };

  return {
    redact: <T>(value: T): T => walk(value, new WeakSet(), false) as T,
    redactString,
    get stats() {
      return { macs: macs.size, ips: ips.size };
    },
  };
};

export const redactDeep = <T>(value: T, options: RedactOptions = {}): T => createRedactor(options).redact(value);
