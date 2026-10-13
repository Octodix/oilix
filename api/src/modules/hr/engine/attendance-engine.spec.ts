import {
  assignPunchesToDays,
  computeAttendanceDay,
  DEFAULT_ATTENDANCE_POLICY,
  liveBucket,
  type AttendancePolicy,
  type DayInput,
  type DaySchedule,
  type EnginePunch,
} from './attendance-engine';
import { localTimeUtc, parseHhMm } from './hr-time';

const OFFSET = 60;
const DAY = '2026-10-05'; // Monday
const NEXT_WEEK = new Date('2026-10-12T12:00:00Z');

const STANDARD: DaySchedule = {
  scheduleId: 'std',
  scheduleName: '08:00-16:00',
  segments: [{ startMinute: 8 * 60, endMinute: 16 * 60 }],
  breakMinutes: 0,
};

const NIGHT: DaySchedule = {
  scheduleId: 'night',
  scheduleName: '22:00-06:00',
  segments: [{ startMinute: 22 * 60, endMinute: 6 * 60 }],
  breakMinutes: 0,
};

const SPLIT: DaySchedule = {
  scheduleId: 'split',
  scheduleName: '08:00-12:00 / 13:00-17:00',
  segments: [
    { startMinute: 8 * 60, endMinute: 12 * 60 },
    { startMinute: 13 * 60, endMinute: 17 * 60 },
  ],
  breakMinutes: 0,
};

function at(time: string, date = DAY): Date {
  const [d, t] = time.includes(' ') ? time.split(' ') : [date, time];
  return localTimeUtc(d, parseHhMm(t)!, OFFSET);
}

let seq = 0;
function punch(time: string, extra: Partial<EnginePunch> = {}): EnginePunch {
  return { id: `p${++seq}`, at: at(time), verifyMethod: 'FINGERPRINT', deviceId: 'dev1', ...extra };
}

function day(partial: Partial<DayInput> = {}, policy: Partial<AttendancePolicy> = {}) {
  return computeAttendanceDay(
    {
      date: DAY,
      offsetMinutes: OFFSET,
      employed: true,
      schedule: STANDARD,
      coverage: {},
      correction: null,
      punches: [],
      now: NEXT_WEEK,
      ...partial,
    },
    { ...DEFAULT_ATTENDANCE_POLICY, ...policy },
  );
}

describe('attendance engine', () => {
  it('07:55 / 16:05 ⇒ present, not late, no overtime below threshold', () => {
    const r = day({ punches: [punch('07:55'), punch('16:05')] });
    expect(r.status).toBe('PRESENT');
    expect(r.isLate).toBe(false);
    expect(r.lateMinutes).toBe(0);
    expect(r.workedMinutes).toBe(490);
    expect(r.expectedMinutes).toBe(480);
    expect(r.overtimeMinutes).toBe(0);
    expect(r.needsReview).toBe(false);
  });

  it('08:20 / 16:00 ⇒ late, minutes according to the policy', () => {
    const full = day({ punches: [punch('08:20'), punch('16:00')] }, { lateChargeMode: 'FULL' });
    expect(full.status).toBe('LATE');
    expect(full.lateMinutes).toBe(20);
    expect(full.chargeableLateMinutes).toBe(20);

    const afterGrace = day({ punches: [punch('08:20'), punch('16:00')] }, { lateChargeMode: 'AFTER_GRACE' });
    expect(afterGrace.status).toBe('LATE');
    expect(afterGrace.lateMinutes).toBe(20);
    expect(afterGrace.chargeableLateMinutes).toBe(10);
  });

  it('within grace (08:08) is not a late arrival', () => {
    const r = day({ punches: [punch('08:08'), punch('16:00')] });
    expect(r.status).toBe('PRESENT');
    expect(r.isLate).toBe(false);
    expect(r.chargeableLateMinutes).toBe(0);
  });

  it('08:00 / 18:00 ⇒ potential overtime calculated (approval is a separate step)', () => {
    const r = day({ punches: [punch('08:00'), punch('18:00')] });
    expect(r.status).toBe('PRESENT');
    expect(r.overtimeMinutes).toBe(120);
    expect(r.overtimeRule).toBe('WORKDAY');
    expect(r.flags).toContain('OVERTIME');
  });

  it('08:17 / 16:42 ⇒ late 17 min and 42 min potential overtime', () => {
    const r = day({ punches: [punch('08:17'), punch('16:42')] });
    expect(r.status).toBe('LATE');
    expect(r.lateMinutes).toBe(17);
    expect(r.overtimeMinutes).toBe(42);
  });

  it('no punches on a past working day ⇒ absent', () => {
    const r = day();
    expect(r.status).toBe('ABSENT');
    expect(r.workedMinutes).toBe(0);
  });

  it('no punches before shift start today ⇒ not arrived, not absent', () => {
    const r = day({ now: at('07:30') });
    expect(r.status).toBe('NOT_ARRIVED');
    const future = day({ now: at('20:00', '2026-10-04') });
    expect(future.status).toBe('UPCOMING');
  });

  it('approved leave ⇒ leave, not absence', () => {
    const r = day({ coverage: { leave: { id: 'lv1', typeCode: 'ANNUAL', isPaid: true } } });
    expect(r.status).toBe('LEAVE');
    expect(r.leaveRequestId).toBe('lv1');
  });

  it('sick leave ⇒ sick leave, distinct from ordinary absence', () => {
    const r = day({ coverage: { sickLeave: { id: 'sk1' } } });
    expect(r.status).toBe('SICK_LEAVE');
    expect(r.sickLeaveId).toBe('sk1');
  });

  it('punches during approved leave are flagged for review', () => {
    const r = day({
      coverage: { leave: { id: 'lv1', typeCode: 'ANNUAL', isPaid: true } },
      punches: [punch('08:00'), punch('16:00')],
    });
    expect(r.status).toBe('LEAVE');
    expect(r.flags).toContain('WORKED_DURING_LEAVE');
    expect(r.needsReview).toBe(true);
  });

  it('single entry punch on a past day ⇒ missing punch flagged, no invented exit', () => {
    const r = day({ punches: [punch('07:58')] });
    expect(r.status).toBe('MISSING_PUNCH');
    expect(r.flags).toContain('MISSING_OUT');
    expect(r.lastOut).toBeNull();
    expect(r.workedMinutes).toBe(0);
    expect(r.needsReview).toBe(true);
  });

  it('single entry punch during the shift today ⇒ in progress', () => {
    const r = day({ punches: [punch('07:58')], now: at('11:00') });
    expect(r.status).toBe('IN_PROGRESS');
    expect(liveBucket(r)).toBe('PRESENT');
  });

  it('a single punch tagged as check-out is a missing entry', () => {
    const r = day({ punches: [punch('16:02', { punchState: 1 })] });
    expect(r.status).toBe('MISSING_PUNCH');
    expect(r.flags).toContain('MISSING_IN');
    expect(r.firstIn).toBeNull();
  });

  it('double-tap within the gap is ignored', () => {
    const r = day({ punches: [punch('07:55'), punch('07:56'), punch('16:05')] });
    expect(r.punchCount).toBe(2);
    expect(r.flags).toContain('DUPLICATE_PUNCHES_IGNORED');
    expect(r.status).toBe('PRESENT');
  });

  it('rest day with work ⇒ rest-day overtime', () => {
    const rest: DaySchedule = { ...STANDARD, segments: [] };
    const r = day({ schedule: rest, punches: [punch('09:00'), punch('13:00')] });
    expect(r.status).toBe('REST_DAY');
    expect(r.overtimeMinutes).toBe(240);
    expect(r.overtimeRule).toBe('REST_DAY');
  });

  it('holiday on a working day ⇒ holiday, no absence', () => {
    const r = day({ coverage: { holiday: { id: 'h1', name: '1er Novembre', isPaid: true } } });
    expect(r.status).toBe('HOLIDAY');
    expect(r.holidayId).toBe('h1');
  });

  it('split schedule ⇒ lunch gap is not worked time', () => {
    const r = day({ schedule: SPLIT, punches: [punch('08:00'), punch('17:00')] });
    expect(r.expectedMinutes).toBe(480);
    expect(r.workedMinutes).toBe(480);
    expect(r.status).toBe('PRESENT');
  });

  it('overnight shift: morning exit belongs to the previous day', () => {
    const p1 = { id: 'n1', at: at('21:58', '2026-10-05') };
    const p2 = { id: 'n2', at: at('06:03', '2026-10-06') };
    const byDay = assignPunchesToDays([p1, p2], () => NIGHT, OFFSET);
    expect(byDay.get('2026-10-05')?.map((p) => p.id)).toEqual(['n1', 'n2']);
    expect(byDay.has('2026-10-06')).toBe(false);

    const r = day({
      schedule: NIGHT,
      punches: [
        { ...p1, verifyMethod: 'CARD', deviceId: 'dev1' },
        { ...p2, verifyMethod: 'CARD', deviceId: 'dev1' },
      ],
    });
    expect(r.status).toBe('PRESENT');
    expect(r.workedMinutes).toBe(485);
    expect(r.expectedMinutes).toBe(480);
  });

  it('day shift: next-morning punch stays on its own calendar day', () => {
    const p = { id: 'm1', at: at('07:59', '2026-10-06') };
    const byDay = assignPunchesToDays([p], () => STANDARD, OFFSET);
    expect(byDay.get('2026-10-06')?.map((x) => x.id)).toEqual(['m1']);
  });

  it('correction fills a missing exit without touching the raw punch', () => {
    const raw = punch('07:58');
    const r = day({ punches: [raw], correction: { checkOut: at('16:00') } });
    expect(r.status).toBe('PRESENT');
    expect(r.isCorrected).toBe(true);
    expect(r.flags).toContain('CORRECTED');
    expect(r.inEventId).toBe(raw.id);
    expect(r.outEventId).toBeNull();
    expect(r.workedMinutes).toBe(482);
    expect(raw.at).toEqual(at('07:58'));
  });

  it('correction may force absent and clears lateness/overtime', () => {
    const r = day({ punches: [punch('08:30'), punch('18:00')], correction: { status: 'ABSENT' } });
    expect(r.status).toBe('ABSENT');
    expect(r.isLate).toBe(false);
    expect(r.overtimeMinutes).toBe(0);
  });

  it('not employed ⇒ NOT_EMPLOYED but keeps the schedule shape', () => {
    const r = day({ employed: false });
    expect(r.status).toBe('NOT_EMPLOYED');
    expect(r.isWorkingDay).toBe(true);
    expect(r.expectedMinutes).toBe(480);
  });

  it('live bucket: two punches today ⇒ left', () => {
    const r = day({ punches: [punch('07:55'), punch('12:00')], now: at('12:30') });
    expect(liveBucket(r)).toBe('LEFT');
  });
});
