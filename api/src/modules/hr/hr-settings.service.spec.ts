import { BadRequestException } from '@nestjs/common';
import { DEFAULT_HR_SETTINGS, HrSettingsService, normaliseHrSettings, rejectedSettingPaths } from './hr-settings.service';

function makeService(stored: unknown) {
  const state = { value: stored };
  const prisma = {
    setting: {
      findUnique: jest.fn(async () => (state.value === undefined ? null : { value: state.value })),
      upsert: jest.fn(async ({ update }: { update: { value: unknown } }) => {
        state.value = update.value;
      }),
    },
    hrWorkSchedule: { findUnique: jest.fn(async () => ({ id: 'sched-1' })) },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const service = new HrSettingsService(prisma as never, audit as never);
  return { service, state, prisma, audit };
}

describe('HR settings update', () => {
  const stored = { ...DEFAULT_HR_SETTINGS, defaultScheduleId: 'sched-1', workSites: ['Huilerie'] };

  it('fields absent from the request (undefined on the DTO) keep their stored value', async () => {
    const { service, state } = makeService(stored);
    const patch = {
      timezoneOffsetMinutes: undefined,
      defaultScheduleId: undefined,
      workSites: undefined,
      attendance: { ...DEFAULT_HR_SETTINGS.attendance, lateGraceMinutes: 15 },
      payroll: undefined,
    };
    const next = await service.update(patch, 'user-1');
    expect(next.defaultScheduleId).toBe('sched-1');
    expect(next.workSites).toEqual(['Huilerie']);
    expect(next.attendance.lateGraceMinutes).toBe(15);
    expect((state.value as typeof stored).defaultScheduleId).toBe('sched-1');
  });

  it('rejects an out-of-range or mistyped value instead of silently saving the default', async () => {
    const { service, prisma, audit } = makeService({ ...stored, attendance: { ...stored.attendance, lateGraceMinutes: 25 } });
    await expect(service.update({ attendance: { lateGraceMinutes: 'abc' } }, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update({ attendance: { lateGraceMinutes: 999 } }, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update({ payroll: { overtimeMultipliers: { WORKDAY: 9 } } }, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update({ payroll: { lateDeductionMode: 'SOMETIMES' } }, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects unknown keys inside a section', async () => {
    const { service } = makeService(stored);
    await expect(service.update({ attendance: { lateGraceMinute: 5 } }, 'user-1')).rejects.toThrow(/attendance\.lateGraceMinute/);
  });

  it('a full round-trip of the current values is accepted and changes nothing', async () => {
    const { service, state } = makeService(stored);
    const current = await service.get();
    const next = await service.update(
      { attendance: current.attendance, payroll: current.payroll, sickLeave: current.sickLeave, devices: current.devices },
      'user-1',
    );
    expect(next).toEqual(normaliseHrSettings(stored));
    expect(state.value).toEqual(normaliseHrSettings(stored));
  });

  it('numeric divisors and keyword divisors both round-trip', () => {
    const next = normaliseHrSettings({ payroll: { dailyRateDivisor: 26, hourlyRateDivisor: 'CONTRACT' } });
    expect(rejectedSettingPaths({ payroll: { dailyRateDivisor: 26, hourlyRateDivisor: 'CONTRACT' } }, next)).toEqual([]);
    expect(rejectedSettingPaths({ payroll: { dailyRateDivisor: 0 } }, normaliseHrSettings({ payroll: { dailyRateDivisor: 0 } }))).toEqual([
      'payroll.dailyRateDivisor',
    ]);
  });
});
