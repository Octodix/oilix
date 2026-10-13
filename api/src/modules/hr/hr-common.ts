import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission } from '../../common/permissions/permission-catalog';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { isDateKey } from './engine/hr-time';

export type Actor = { id: string; name: string };

export function num(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return Number(v);
}

export function numOrNull(v: Prisma.Decimal | number | string | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export function can(user: Pick<JwtPayload, 'permissions' | 'role'>, permission: string): boolean {
  return hasPermission(user.permissions, permission, user.role);
}

export async function actorOf(
  audit: { getActorDisplayName(userId?: string): Promise<string> },
  user: Pick<JwtPayload, 'sub'>,
): Promise<Actor> {
  return { id: user.sub, name: await audit.getActorDisplayName(user.sub) };
}

export function canSeeSalaries(user: Pick<JwtPayload, 'permissions' | 'role'>): boolean {
  return can(user, 'HR_SALARIES_VIEW') || can(user, 'HR_PAYROLL_VIEW');
}

export function requireDateKey(v: unknown, label = 'التاريخ'): string {
  if (!isDateKey(v)) throw new BadRequestException(`${label} غير صالح (YYYY-MM-DD)`);
  return v;
}

export function requireRange(from: unknown, to: unknown): { from: string; to: string } {
  const f = requireDateKey(from, 'تاريخ البداية');
  const t = requireDateKey(to, 'تاريخ النهاية');
  if (t < f) throw new BadRequestException('تاريخ النهاية قبل تاريخ البداية');
  return { from: f, to: t };
}

export function requireYearMonth(year: unknown, month: unknown): { year: number; month: number } {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new BadRequestException('الشهر غير صالح');
  }
  return { year: y, month: m };
}

export function periodIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function fullName(e: { firstName: string; lastName: string }): string {
  return `${e.lastName} ${e.firstName}`.trim();
}

export const PAYMENT_METHODS = ['CASH_REGISTER', 'CASH', 'BANK_TRANSFER', 'CCP', 'CHEQUE'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function requireMoney(v: unknown, label = 'المبلغ'): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new BadRequestException(`${label} يجب أن يكون أكبر من صفر`);
  if (Math.round(n * 100) !== n * 100 && Math.abs(Math.round(n * 100) - n * 100) > 1e-6) {
    throw new BadRequestException(`${label}: رقمان بعد الفاصلة كحد أقصى`);
  }
  return Math.round(n * 100) / 100;
}

/** Prisma unique violation → readable error. */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
