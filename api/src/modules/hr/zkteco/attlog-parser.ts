import { createHash } from 'crypto';
import { formatDeviceLocalTime, parseDeviceLocalTime } from '../engine/hr-time';
import { verifyMethodOf } from './zk-verify';

/**
 * Column layout of an attendance export. Only PIN and date/time are certain for every
 * ZKTeco firmware; the other columns must be confirmed on the real terminal's export.
 */
export type FileColumnMap = {
  pin: number;
  time: number;
  status?: number | null;
  verify?: number | null;
  workCode?: number | null;
  delimiter?: 'auto' | 'tab' | 'comma' | 'semicolon' | 'whitespace';
  /** Only used when the year comes last (31/10/2026 vs 10/31/2026). */
  dateOrder?: 'DMY' | 'MDY';
};

/** ADMS ATTLOG line: PIN \t time \t status \t verify \t workcode \t reserved… (same order in USB attlog.dat). */
export const ZK_ATTLOG_COLUMNS: FileColumnMap = {
  pin: 0,
  time: 1,
  status: 2,
  verify: 3,
  workCode: 4,
  delimiter: 'auto',
  dateOrder: 'DMY',
};

export type ParsedPunch = {
  lineNo: number;
  deviceUserId: string;
  /** Canonical device wall-clock time 'YYYY-MM-DD HH:MM:SS' */
  localTime: string;
  punchedAt: Date;
  punchState: number | null;
  verifyCode: number | null;
  verifyMethod: string;
  workCode: string | null;
  rawLine: string;
};

export type ParseIssue = { lineNo: number; line: string; reason: string };

export type ParseResult = {
  records: ParsedPunch[];
  invalid: ParseIssue[];
  skippedHeader: boolean;
  totalLines: number;
};

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_LINES = 200_000;

const PIN_RE = /^[A-Za-z0-9_.-]{1,32}$/;
const DATE_RE = /^(\d{4}|\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{1,2})$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

function split(line: string, delimiter: FileColumnMap['delimiter']): string[] {
  let d = delimiter ?? 'auto';
  if (d === 'auto') {
    if (line.includes('\t')) d = 'tab';
    else if (line.includes(';')) d = 'semicolon';
    else if (line.includes(',')) d = 'comma';
    else d = 'whitespace';
  }
  if (d === 'tab') return line.split('\t').map((c) => c.trim());
  if (d === 'semicolon') return line.split(';').map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
  if (d === 'comma') return line.split(',').map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
  // Whitespace: a "date time" pair must stay one column.
  const tokens = line.trim().split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (DATE_RE.test(tokens[i]) && TIME_RE.test(tokens[i + 1] ?? '')) {
      out.push(`${tokens[i]} ${tokens[i + 1]}`);
      i++;
    } else {
      out.push(tokens[i]);
    }
  }
  return out;
}

/** Normalises the common terminal/Excel date formats to 'YYYY-MM-DD HH:MM:SS'. */
export function normaliseDeviceTime(raw: string, dateOrder: 'DMY' | 'MDY' = 'DMY'): string | null {
  const m = /^(\S+)[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const dm = DATE_RE.exec(m[1]);
  if (!dm) return null;
  let y: string;
  let mo: string;
  let d: string;
  if (dm[1].length === 4) {
    [y, mo, d] = [dm[1], dm[2], dm[3]];
  } else if (dm[3].length === 4) {
    [y, mo, d] = dateOrder === 'MDY' ? [dm[3], dm[1], dm[2]] : [dm[3], dm[2], dm[1]];
  } else {
    return null;
  }
  const pad = (s: string) => s.padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)} ${pad(m[2])}:${m[3]}:${m[4] ?? '00'}`;
}

function intOrNull(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  return /^-?\d+$/.test(v) ? Number(v) : null;
}

export function parseAttendanceText(text: string, map: FileColumnMap, offsetMinutes: number): ParseResult {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const result: ParseResult = { records: [], invalid: [], skippedHeader: false, totalLines: 0 };
  let firstContent = true;
  for (let i = 0; i < lines.length && i < MAX_IMPORT_LINES; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    result.totalLines++;
    const lineNo = i + 1;
    const cols = split(line, map.delimiter);
    const pin = cols[map.pin]?.trim() ?? '';
    const timeRaw = cols[map.time] ?? '';
    const local = normaliseDeviceTime(timeRaw, map.dateOrder);
    const punchedAt = local ? parseDeviceLocalTime(local, offsetMinutes) : null;

    if (!PIN_RE.test(pin) || !punchedAt) {
      if (firstContent && !punchedAt) {
        result.skippedHeader = true;
        firstContent = false;
        continue;
      }
      result.invalid.push({
        lineNo,
        line: line.slice(0, 200),
        reason: !PIN_RE.test(pin) ? 'INVALID_USER_ID' : 'INVALID_DATETIME',
      });
      firstContent = false;
      continue;
    }
    firstContent = false;
    const verifyCode = map.verify != null ? intOrNull(cols[map.verify]) : null;
    const workCode = map.workCode != null ? cols[map.workCode]?.trim() || null : null;
    result.records.push({
      lineNo,
      deviceUserId: pin,
      localTime: formatDeviceLocalTime(punchedAt, offsetMinutes),
      punchedAt,
      punchState: map.status != null ? intOrNull(cols[map.status]) : null,
      verifyCode,
      verifyMethod: verifyMethodOf(verifyCode),
      workCode,
      rawLine: line.slice(0, 500),
    });
  }
  return result;
}

/** Same terminal + same user + same wall-clock second ⇒ same punch, whatever the channel. */
export function punchDedupeKey(deviceId: string, deviceUserId: string, localTime: string): string {
  return createHash('sha256').update(`${deviceId}|${deviceUserId}|${localTime}`).digest('hex');
}

export function fileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function coerceColumnMap(v: unknown): FileColumnMap {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const idx = (k: string, fallback: number | null): number | null => {
    const n = src[k];
    if (n === null) return null;
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 50 ? n : fallback;
  };
  const delimiter = ['auto', 'tab', 'comma', 'semicolon', 'whitespace'].includes(String(src.delimiter))
    ? (src.delimiter as FileColumnMap['delimiter'])
    : 'auto';
  return {
    pin: idx('pin', 0) ?? 0,
    time: idx('time', 1) ?? 1,
    status: idx('status', ZK_ATTLOG_COLUMNS.status!),
    verify: idx('verify', ZK_ATTLOG_COLUMNS.verify!),
    workCode: idx('workCode', ZK_ATTLOG_COLUMNS.workCode!),
    delimiter,
    dateOrder: src.dateOrder === 'MDY' ? 'MDY' : 'DMY',
  };
}
