import {
  addDays,
  localDateKey,
  localMidnightUtc,
  localTimeUtc,
  minutesBetween,
} from './hr-time';

/**
 * Attendance engine — pure. Raw punches + schedule + approved leave/absence + corrections
 * → one processed attendance day. Never invents a missing punch.
 */

export const ATTENDANCE_STATUSES = [
  'PRESENT',
  'LATE',
  'ABSENT',
  'MISSING_PUNCH',
  'IN_PROGRESS',
  'NOT_ARRIVED',
  'UPCOMING',
  'LEAVE',
  'SICK_LEAVE',
  'AUTHORIZED_ABSENCE',
  'REST_DAY',
  'HOLIDAY',
  'NOT_EMPLOYED',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Statuses an HR correction may force. */
export const CORRECTABLE_STATUSES: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'REST_DAY'];

export type ScheduleSegment = { startMinute: number; endMinute: number };

export type DaySchedule = {
  scheduleId: string;
  scheduleName: string;
  /** Segments of this weekday sorted by start. Empty ⇒ rest day. */
  segments: ScheduleSegment[];
  breakMinutes: number;
};

export type EnginePunch = {
  id: string;
  at: Date;
  verifyMethod: string;
  deviceId: string | null;
  punchState?: number | null;
};

export type AttendancePolicy = {
  lateGraceMinutes: number;
  /** FULL: 08:18 with 10 min grace ⇒ 18 min. AFTER_GRACE ⇒ 8 min. */
  lateChargeMode: 'FULL' | 'AFTER_GRACE';
  earlyLeaveGraceMinutes: number;
  /** Extra time below this is not reported as potential overtime. */
  overtimeThresholdMinutes: number;
  countEarlyArrivalOvertime: boolean;
  /** Punches closer than this to the previous kept punch are treated as double-taps. */
  minPunchGapMinutes: number;
};

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  lateGraceMinutes: 10,
  lateChargeMode: 'FULL',
  earlyLeaveGraceMinutes: 0,
  overtimeThresholdMinutes: 30,
  countEarlyArrivalOvertime: false,
  minPunchGapMinutes: 2,
};

export type DayCoverage = {
  holiday?: { id: string; name: string; isPaid: boolean } | null;
  leave?: { id: string; typeCode: string; isPaid: boolean } | null;
  sickLeave?: { id: string } | null;
  absence?: { id: string; typeCode: string; isPaid: boolean } | null;
};

export type DayCorrection = {
  checkIn?: Date | null;
  checkOut?: Date | null;
  status?: string | null;
};

export type DayInput = {
  date: string;
  offsetMinutes: number;
  employed: boolean;
  schedule: DaySchedule | null;
  coverage: DayCoverage;
  correction: DayCorrection | null;
  punches: EnginePunch[];
  now: Date;
};

export type DayResult = {
  date: string;
  status: AttendanceStatus;
  flags: string[];
  isWorkingDay: boolean;
  scheduleId: string | null;
  scheduleName: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  expectedMinutes: number;
  firstIn: Date | null;
  lastOut: Date | null;
  punchCount: number;
  inEventId: string | null;
  outEventId: string | null;
  inVerifyMethod: string | null;
  inDeviceId: string | null;
  workedMinutes: number;
  lateMinutes: number;
  chargeableLateMinutes: number;
  isLate: boolean;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  overtimeRule: 'WORKDAY' | 'REST_DAY' | 'HOLIDAY' | null;
  leaveRequestId: string | null;
  sickLeaveId: string | null;
  absenceId: string | null;
  holidayId: string | null;
  needsReview: boolean;
  isCorrected: boolean;
};

/** How far before the shift start / after its end a punch still belongs to that shift. */
export const PUNCH_WINDOW_BEFORE_MIN = 240;
export const PUNCH_WINDOW_AFTER_MIN = 480;
/** Breaks (schedule.breakMinutes) are only deducted when the worked span exceeds this. */
const BREAK_APPLIES_AFTER_MIN = 240;

type Block = { start: Date; end: Date };

/** Absolute blocks of a schedule day. Only the last segment may cross midnight. */
export function scheduleBlocks(date: string, schedule: DaySchedule | null, offsetMinutes: number): Block[] {
  if (!schedule?.segments.length) return [];
  return [...schedule.segments]
    .sort((a, b) => a.startMinute - b.startMinute)
    .map((s) => {
      const end = s.endMinute <= s.startMinute ? s.endMinute + 1440 : s.endMinute;
      return {
        start: localTimeUtc(date, s.startMinute, offsetMinutes),
        end: localTimeUtc(date, end, offsetMinutes),
      };
    });
}

export function expectedMinutesOf(blocks: Block[], breakMinutes: number): number {
  const total = blocks.reduce((sum, b) => sum + minutesBetween(b.start, b.end), 0);
  return Math.max(0, total - (blocks.length ? breakMinutes : 0));
}

/** Time window in which punches are attributed to `date`. */
export function punchWindow(date: string, schedule: DaySchedule | null, offsetMinutes: number): Block {
  const blocks = scheduleBlocks(date, schedule, offsetMinutes);
  if (!blocks.length) {
    const start = localMidnightUtc(date, offsetMinutes);
    return { start, end: new Date(start.getTime() + 1440 * 60_000) };
  }
  return {
    start: new Date(blocks[0].start.getTime() - PUNCH_WINDOW_BEFORE_MIN * 60_000),
    end: new Date(blocks[blocks.length - 1].end.getTime() + PUNCH_WINDOW_AFTER_MIN * 60_000),
  };
}

/**
 * Attribute punches to attendance dates. A morning punch after a night shift belongs to the
 * previous day's shift; everything else to its calendar day.
 */
export function assignPunchesToDays<P extends { at: Date }>(
  punches: P[],
  scheduleFor: (date: string) => DaySchedule | null,
  offsetMinutes: number,
): Map<string, P[]> {
  const out = new Map<string, P[]>();
  const windows = new Map<string, Block>();
  const windowOf = (d: string) => {
    let w = windows.get(d);
    if (!w) {
      w = punchWindow(d, scheduleFor(d), offsetMinutes);
      windows.set(d, w);
    }
    return w;
  };
  for (const p of [...punches].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const calendar = localDateKey(p.at, offsetMinutes);
    const previous = addDays(calendar, -1);
    let target = calendar;
    const prevSchedule = scheduleFor(previous);
    if (prevSchedule?.segments.length) {
      const w = windowOf(previous);
      if (p.at >= w.start && p.at < w.end) target = previous;
    }
    const list = out.get(target) ?? [];
    list.push(p);
    out.set(target, list);
  }
  return out;
}

function debounce(punches: EnginePunch[], gapMinutes: number): { kept: EnginePunch[]; dropped: number } {
  const sorted = [...punches].sort((a, b) => a.at.getTime() - b.at.getTime());
  const kept: EnginePunch[] = [];
  for (const p of sorted) {
    const last = kept[kept.length - 1];
    if (last && minutesBetween(last.at, p.at) < gapMinutes) continue;
    kept.push(p);
  }
  return { kept, dropped: sorted.length - kept.length };
}

/** Worked time = span between entry and exit, minus unscheduled gaps between blocks and the unpaid break. */
function workedBetween(inAt: Date, outAt: Date, blocks: Block[], breakMinutes: number): number {
  const span = Math.max(0, minutesBetween(inAt, outAt));
  let gaps = 0;
  for (let i = 1; i < blocks.length; i++) {
    const gapStart = Math.max(blocks[i - 1].end.getTime(), inAt.getTime());
    const gapEnd = Math.min(blocks[i].start.getTime(), outAt.getTime());
    if (gapEnd > gapStart) gaps += Math.round((gapEnd - gapStart) / 60_000);
  }
  const brk = span > BREAK_APPLIES_AFTER_MIN ? breakMinutes : 0;
  return Math.max(0, span - gaps - brk);
}

function emptyResult(input: DayInput, status: AttendanceStatus): DayResult {
  return {
    date: input.date,
    status,
    flags: [],
    isWorkingDay: false,
    scheduleId: input.schedule?.scheduleId ?? null,
    scheduleName: input.schedule?.scheduleName ?? null,
    scheduledStart: null,
    scheduledEnd: null,
    expectedMinutes: 0,
    firstIn: null,
    lastOut: null,
    punchCount: 0,
    inEventId: null,
    outEventId: null,
    inVerifyMethod: null,
    inDeviceId: null,
    workedMinutes: 0,
    lateMinutes: 0,
    chargeableLateMinutes: 0,
    isLate: false,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    overtimeRule: null,
    leaveRequestId: null,
    sickLeaveId: null,
    absenceId: null,
    holidayId: null,
    needsReview: false,
    isCorrected: false,
  };
}

export function computeAttendanceDay(input: DayInput, policy: AttendancePolicy): DayResult {
  const blocks = scheduleBlocks(input.date, input.schedule, input.offsetMinutes);
  const working = blocks.length > 0;
  // Not-employed days keep their schedule shape so payroll can prorate a partial month.
  const r = emptyResult(input, input.employed ? 'ABSENT' : 'NOT_EMPLOYED');
  r.isWorkingDay = working;
  r.expectedMinutes = expectedMinutesOf(blocks, input.schedule?.breakMinutes ?? 0);
  if (!input.employed) return r;

  const { coverage, correction } = input;
  r.scheduledStart = blocks[0]?.start ?? null;
  r.scheduledEnd = blocks[blocks.length - 1]?.end ?? null;
  if (!input.schedule) r.flags.push('NO_SCHEDULE');

  const { kept, dropped } = debounce(input.punches, policy.minPunchGapMinutes);
  if (dropped > 0) r.flags.push('DUPLICATE_PUNCHES_IGNORED');
  r.punchCount = kept.length;

  const first = kept[0] ?? null;
  const last = kept.length >= 2 ? kept[kept.length - 1] : null;
  const singleIsExit = kept.length === 1 && first?.punchState === 1;
  let inAt: Date | null = singleIsExit ? null : (first?.at ?? null);
  let outAt: Date | null = singleIsExit ? first!.at : (last?.at ?? null);
  if (first && !singleIsExit) {
    r.inEventId = first.id;
    r.inVerifyMethod = first.verifyMethod;
    r.inDeviceId = first.deviceId;
  }
  if (last) r.outEventId = last.id;
  if (singleIsExit) r.outEventId = first!.id;

  if (correction) {
    if (correction.checkIn !== undefined && correction.checkIn !== null) {
      inAt = correction.checkIn;
      r.inEventId = null;
      r.inVerifyMethod = 'MANUAL';
    }
    if (correction.checkOut !== undefined && correction.checkOut !== null) {
      outAt = correction.checkOut;
      r.outEventId = null;
    }
    r.isCorrected = true;
    r.flags.push('CORRECTED');
  }
  r.firstIn = inAt;
  r.lastOut = outAt;
  const hasBoth = !!inAt && !!outAt && outAt > inAt;

  const ref = { holiday: coverage.holiday, leave: coverage.leave, sick: coverage.sickLeave, absence: coverage.absence };
  r.holidayId = ref.holiday?.id ?? null;
  const worked = hasBoth ? workedBetween(inAt!, outAt!, blocks, input.schedule?.breakMinutes ?? 0) : 0;

  // Coverage only matters on working days: leave never consumes a rest day.
  if (working && (ref.sick || ref.leave || ref.absence)) {
    if (ref.sick) {
      r.status = 'SICK_LEAVE';
      r.sickLeaveId = ref.sick.id;
    } else if (ref.leave) {
      r.status = 'LEAVE';
      r.leaveRequestId = ref.leave.id;
    } else {
      r.status = 'AUTHORIZED_ABSENCE';
      r.absenceId = ref.absence!.id;
    }
    if (kept.length || hasBoth) {
      r.flags.push('WORKED_DURING_LEAVE');
      r.workedMinutes = worked;
      r.needsReview = true;
    }
    return applyStatusOverride(r, correction);
  }

  if (!working || ref.holiday) {
    r.status = ref.holiday && working ? 'HOLIDAY' : 'REST_DAY';
    if (!working && ref.holiday) r.flags.push('HOLIDAY_ON_REST_DAY');
    if (hasBoth) {
      r.workedMinutes = worked;
      const rule = ref.holiday ? 'HOLIDAY' : 'REST_DAY';
      r.flags.push(rule === 'HOLIDAY' ? 'WORKED_HOLIDAY' : 'WORKED_REST_DAY');
      if (worked >= policy.overtimeThresholdMinutes) {
        r.overtimeMinutes = worked;
        r.overtimeRule = rule;
        r.flags.push('OVERTIME');
      }
    } else if (kept.length === 1) {
      r.flags.push('SINGLE_PUNCH_ON_DAY_OFF');
      r.needsReview = true;
    }
    return applyStatusOverride(r, correction);
  }

  const start = r.scheduledStart!;
  const end = r.scheduledEnd!;
  const shiftStillOpen = input.now < new Date(end.getTime() + PUNCH_WINDOW_AFTER_MIN * 60_000);

  if (inAt) {
    const rawLate = Math.max(0, minutesBetween(start, inAt));
    r.isLate = rawLate > policy.lateGraceMinutes;
    r.lateMinutes = r.isLate ? rawLate : 0;
    r.chargeableLateMinutes = r.isLate
      ? policy.lateChargeMode === 'FULL'
        ? rawLate
        : rawLate - policy.lateGraceMinutes
      : 0;
  }

  if (!inAt && !outAt) {
    if (input.now < start) {
      r.status = input.now < localMidnightUtc(input.date, input.offsetMinutes) ? 'UPCOMING' : 'NOT_ARRIVED';
    } else if (input.now < new Date(start.getTime() + policy.lateGraceMinutes * 60_000)) {
      r.status = 'NOT_ARRIVED';
    } else {
      r.status = 'ABSENT';
    }
    return applyStatusOverride(r, correction);
  }

  if (!hasBoth) {
    if (inAt && !outAt && shiftStillOpen) {
      r.status = 'IN_PROGRESS';
      return applyStatusOverride(r, correction);
    }
    r.status = 'MISSING_PUNCH';
    r.flags.push(inAt ? 'MISSING_OUT' : 'MISSING_IN');
    r.needsReview = true;
    return applyStatusOverride(r, correction);
  }

  r.workedMinutes = worked;
  const rawEarly = Math.max(0, minutesBetween(outAt!, end));
  if (rawEarly > policy.earlyLeaveGraceMinutes) {
    r.earlyLeaveMinutes = rawEarly;
    r.flags.push('EARLY_LEAVE');
  }
  const after = Math.max(0, minutesBetween(end, outAt!));
  const before = policy.countEarlyArrivalOvertime ? Math.max(0, minutesBetween(inAt!, start)) : 0;
  const extra = after + before;
  if (extra >= policy.overtimeThresholdMinutes && extra > 0) {
    r.overtimeMinutes = extra;
    r.overtimeRule = 'WORKDAY';
    r.flags.push('OVERTIME');
  }
  r.status = r.isLate ? 'LATE' : 'PRESENT';
  return applyStatusOverride(r, correction);
}

function applyStatusOverride(r: DayResult, correction: DayCorrection | null): DayResult {
  const forced = correction?.status;
  if (!forced || !(CORRECTABLE_STATUSES as string[]).includes(forced)) return r;
  r.status = forced as AttendanceStatus;
  r.flags = r.flags.filter((f) => f !== 'MISSING_OUT' && f !== 'MISSING_IN');
  r.needsReview = false;
  if (forced === 'PRESENT' && r.workedMinutes === 0) r.workedMinutes = r.expectedMinutes;
  if (forced === 'ABSENT' || forced === 'REST_DAY') {
    r.workedMinutes = 0;
    r.overtimeMinutes = 0;
    r.overtimeRule = null;
    r.isLate = false;
    r.lateMinutes = 0;
    r.chargeableLateMinutes = 0;
  }
  return r;
}

/** Groups for the "Présence aujourd'hui" screen. */
export type LiveBucket =
  | 'PRESENT'
  | 'LATE'
  | 'ABSENT'
  | 'LEAVE'
  | 'SICK_LEAVE'
  | 'NOT_ARRIVED'
  | 'LEFT'
  | 'OFF';

export function liveBucket(
  day: Pick<DayResult, 'punchCount' | 'isLate' | 'lastOut' | 'firstIn'> & { status: AttendanceStatus | string },
): LiveBucket {
  switch (day.status) {
    case 'LEAVE':
    case 'AUTHORIZED_ABSENCE':
      return 'LEAVE';
    case 'SICK_LEAVE':
      return 'SICK_LEAVE';
    case 'REST_DAY':
    case 'HOLIDAY':
    case 'NOT_EMPLOYED':
      return day.punchCount % 2 === 1 ? 'PRESENT' : 'OFF';
    case 'NOT_ARRIVED':
    case 'UPCOMING':
      return 'NOT_ARRIVED';
    case 'ABSENT':
      return 'ABSENT';
    default:
      break;
  }
  // Odd number of punches ⇒ last punch was an entry ⇒ inside.
  if (day.punchCount >= 2 && day.punchCount % 2 === 0) return 'LEFT';
  if (!day.firstIn && day.lastOut) return 'LEFT';
  return day.isLate ? 'LATE' : 'PRESENT';
}
