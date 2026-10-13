import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { HrApprovalStatus, HrEmployeeStatus, HrSalaryMode } from '@prisma/client';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{1,2}:\d{2}$/;
const DATE_MSG = { message: 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD' };
const bool = () => Transform(({ value }) => value === 'true' || value === '1' || value === true);
const PAYMENT_METHODS = ['CASH_REGISTER', 'CASH', 'BANK_TRANSFER', 'CCP', 'CHEQUE'];

// ── Shared ──────────────────────────────────────────────────────────────────

export class RangeQueryDto {
  @Matches(DATE, DATE_MSG) from!: string;
  @Matches(DATE, DATE_MSG) to!: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @bool() @IsBoolean() refresh?: boolean;
}

export class OptionalRangeQueryDto {
  @IsOptional() @Matches(DATE, DATE_MSG) from?: string;
  @IsOptional() @Matches(DATE, DATE_MSG) to?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsIn(Object.values(HrApprovalStatus)) status?: HrApprovalStatus;
}

export class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class DecisionDto {
  @IsIn(['APPROVE', 'REJECT', 'CANCEL']) decision!: 'APPROVE' | 'REJECT' | 'CANCEL';
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

export class YearMonthQueryDto {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
  @IsOptional() @IsUUID() departmentId?: string;
}

export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

// ── Settings ────────────────────────────────────────────────────────────────

export class HrSettingsDto {
  @IsOptional() @IsInt() @Min(-720) @Max(840) timezoneOffsetMinutes?: number;
  @IsOptional() @IsUUID() defaultScheduleId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) workSites?: string[];
  @IsOptional() @IsObject() attendance?: Record<string, unknown>;
  @IsOptional() @IsObject() payroll?: Record<string, unknown>;
  @IsOptional() @IsObject() sickLeave?: Record<string, unknown>;
  @IsOptional() @IsObject() devices?: Record<string, unknown>;
}

// ── Departments / employees / contracts ─────────────────────────────────────

export class DepartmentDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(100) nameFr?: string | null;
  @IsOptional() @IsString() @MaxLength(20) code?: string | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class UpdateDepartmentDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(100) nameFr?: string | null;
  @IsOptional() @IsString() @MaxLength(20) code?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class EmployeeQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsIn(Object.values(HrEmployeeStatus)) status?: HrEmployeeStatus;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @bool() @IsBoolean() includeArchived?: boolean;
}

class EmployeeFields {
  @IsOptional() @IsString() @MaxLength(30) matricule?: string | null;
  @IsOptional() @IsString() photo?: string | null;
  @IsOptional() @Matches(DATE, DATE_MSG) birthDate?: string | null;
  @IsOptional() @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(300) address?: string | null;
  @IsOptional() @IsString() @MaxLength(40) nationalIdNumber?: string | null;
  @IsOptional() @Matches(DATE, DATE_MSG) nationalIdIssuedAt?: string | null;
  @IsOptional() @IsString() @MaxLength(100) nationalIdIssuedBy?: string | null;
  @IsOptional() @IsString() @MaxLength(40) socialSecurityNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(100) emergencyContactName?: string | null;
  @IsOptional() @IsString() @MaxLength(30) emergencyContactPhone?: string | null;
  @IsOptional() @IsString() @MaxLength(50) emergencyContactRelation?: string | null;
  @IsOptional() @IsString() @MaxLength(100) jobTitle?: string | null;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) workSite?: string | null;
  @IsOptional() @IsIn(['CASH', 'BANK_TRANSFER', 'CCP', 'CHEQUE']) paymentMethod?: string;
  @IsOptional() @IsString() @MaxLength(60) bankAccount?: string | null;
  @IsOptional() @IsUUID() userId?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class CreateEmployeeDto extends EmployeeFields {
  @IsString() @MinLength(1) @MaxLength(80) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(80) lastName!: string;
  @Matches(DATE, DATE_MSG) hireDate!: string;
}

export class UpdateEmployeeDto extends EmployeeFields {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) lastName?: string;
  @IsOptional() @Matches(DATE, DATE_MSG) hireDate?: string;
  @IsOptional() @IsIn(Object.values(HrEmployeeStatus)) status?: HrEmployeeStatus;
  @IsOptional() @Matches(DATE, DATE_MSG) leftAt?: string | null;
  @IsOptional() @IsString() @MaxLength(500) leftReason?: string | null;
}

export class ArchiveDto {
  @IsBoolean() archived!: boolean;
}

export class CreateContractDto {
  @IsUUID() employeeId!: string;
  @IsIn(['CDI', 'CDD', 'SEASONAL', 'PART_TIME', 'TRIAL', 'INTERNSHIP', 'OTHER']) contractType!: string;
  @Matches(DATE, DATE_MSG) startDate!: string;
  @IsOptional() @Matches(DATE, DATE_MSG) endDate?: string | null;
  @IsOptional() @Matches(DATE, DATE_MSG) trialEndDate?: string | null;
  @IsOptional() @IsIn(Object.values(HrSalaryMode)) salaryMode?: HrSalaryMode;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) baseSalary!: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(84) weeklyHours?: number;
  @IsOptional() @IsString() @MaxLength(100) jobTitle?: string | null;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) documentRef?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
}

export class UpdateContractDto {
  @IsOptional() @IsIn(['CDI', 'CDD', 'SEASONAL', 'PART_TIME', 'TRIAL', 'INTERNSHIP', 'OTHER']) contractType?: string;
  @IsOptional() @Matches(DATE, DATE_MSG) startDate?: string;
  @IsOptional() @Matches(DATE, DATE_MSG) endDate?: string | null;
  @IsOptional() @Matches(DATE, DATE_MSG) trialEndDate?: string | null;
  @IsOptional() @IsIn(Object.values(HrSalaryMode)) salaryMode?: HrSalaryMode;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) baseSalary?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(84) weeklyHours?: number;
  @IsOptional() @IsString() @MaxLength(100) jobTitle?: string | null;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) documentRef?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
}

export class TerminateContractDto {
  @Matches(DATE, DATE_MSG) endDate!: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

// ── Schedules ───────────────────────────────────────────────────────────────

export class SegmentDto {
  @IsInt() @Min(0) @Max(6) weekday!: number;
  @Matches(HHMM) start!: string;
  @Matches(HHMM) end!: string;
}

export class ScheduleDto {
  @IsString() @MinLength(1) @MaxLength(20) code!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(480) breakMinutes?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsArray() @ArrayMaxSize(42) @ValidateNested({ each: true }) @Type(() => SegmentDto) segments!: SegmentDto[];
}

export class UpdateScheduleDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(480) breakMinutes?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(42) @ValidateNested({ each: true }) @Type(() => SegmentDto) segments?: SegmentDto[];
}

export class ContractQueryDto {
  @IsOptional() @IsIn(['ACTIVE', 'ENDED', 'TERMINATED']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) endingWithinDays?: number;
}

export class AssignmentQueryDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
}

export class AssignmentDto {
  @IsUUID() scheduleId!: string;
  @IsOptional() @IsUUID() employeeId?: string | null;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @Matches(DATE, DATE_MSG) startDate!: string;
  @IsOptional() @Matches(DATE, DATE_MSG) endDate?: string | null;
  @IsOptional() @IsBoolean() isOverride?: boolean;
  @IsOptional() @IsString() @MaxLength(300) reason?: string | null;
}

export class HolidayDto {
  @Matches(DATE, DATE_MSG) date!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsBoolean() isPaid?: boolean;
}

export class HolidayQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
}

// ── Attendance ──────────────────────────────────────────────────────────────

export class DaysQueryDto extends RangeQueryDto {
  @IsOptional() @IsString() @MaxLength(30) status?: string;
  @IsOptional() @bool() @IsBoolean() needsReview?: boolean;
  @IsOptional() @bool() @IsBoolean() lateOnly?: boolean;
}

export class EventsQueryDto extends PageQueryDto {
  @Matches(DATE, DATE_MSG) from!: string;
  @Matches(DATE, DATE_MSG) to!: string;
  @IsOptional() @IsUUID() deviceId?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @bool() @IsBoolean() unmapped?: boolean;
  @IsOptional() @IsString() @MaxLength(32) deviceUserId?: string;
}

export class ReprocessDto {
  @Matches(DATE, DATE_MSG) from!: string;
  @Matches(DATE, DATE_MSG) to!: string;
  @IsOptional() @IsUUID() employeeId?: string;
}

export class CorrectionDto {
  @IsUUID() employeeId!: string;
  @Matches(DATE, DATE_MSG) date!: string;
  @IsOptional() @Matches(HHMM) checkIn?: string | null;
  @IsOptional() @Matches(HHMM) checkOut?: string | null;
  @IsOptional() @IsIn(['PRESENT', 'ABSENT', 'REST_DAY']) status?: string | null;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class CorrectionQueryDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @Matches(DATE, DATE_MSG) from?: string;
  @IsOptional() @Matches(DATE, DATE_MSG) to?: string;
}

export class JustifyLateDto {
  @IsBoolean() justified!: boolean;
  @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
}

export class EmployeeMonthQueryDto {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
}

// ── Devices ─────────────────────────────────────────────────────────────────

class DeviceFields {
  @IsOptional() @IsString() @MaxLength(80) model?: string | null;
  @IsOptional() @IsString() @MaxLength(40) serialNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(15) ipAddress?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number | null;
  @IsOptional() @IsString() @MaxLength(9) commKey?: string | null;
  @IsOptional() @IsString() @MaxLength(120) location?: string | null;
  @IsOptional() @IsBoolean() isEnabled?: boolean;
  @IsOptional() @IsInt() @Min(-720) @Max(840) timezoneOffsetMinutes?: number;
  @IsOptional() @IsObject() fileColumnMap?: Record<string, unknown> | null;
  @IsOptional() @IsInt() @Min(0) @Max(1440) syncIntervalMinutes?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
}

export class CreateDeviceDto extends DeviceFields {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsIn(['ZKTECO_ADMS', 'ZKTECO_TCP', 'ZKTECO_FILE']) provider!: string;
}

export class UpdateDeviceDto extends DeviceFields {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsIn(['ZKTECO_ADMS', 'ZKTECO_TCP', 'ZKTECO_FILE']) provider?: string;
}

export class DiagnoseDto {
  @IsString() @MaxLength(15) host!: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsString() @MaxLength(9) commKey?: string | null;
}

export class ImportFileDto {
  @IsString() @MaxLength(6_000_000) content!: string;
  @IsOptional() @IsString() @MaxLength(200) fileName?: string | null;
  @IsOptional() @IsObject() columnMap?: Record<string, unknown> | null;
  @IsOptional() @IsBoolean() dryRun?: boolean;
  @IsOptional() @IsBoolean() saveColumnMap?: boolean;
}

export class SyncLogQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID() deviceId?: string;
}

export class MappingDto {
  @IsString() @Matches(/^[A-Za-z0-9_.-]{1,32}$/) deviceUserId!: string;
  @IsUUID() employeeId!: string;
  @IsOptional() @IsString() @MaxLength(80) deviceUserName?: string | null;
}

// ── Leave / sick / absence ──────────────────────────────────────────────────

export class LeaveTypeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(30) code?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(100) nameFr?: string | null;
  @IsOptional() @IsBoolean() isPaid?: boolean;
  @IsOptional() @IsBoolean() deductsFromBalance?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(366) defaultDaysPerYear?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
}

export class AbsenceTypeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(30) code?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(100) nameFr?: string | null;
  @IsOptional() @IsBoolean() isPaid?: boolean;
  @IsOptional() @IsBoolean() isJustified?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
}

export class EntitlementDto {
  @IsUUID() employeeId!: string;
  @IsUUID() leaveTypeId!: string;
  @IsInt() @Min(2000) @Max(2100) year!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(366) days!: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string | null;
}

export class BalanceQueryDto {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year!: number;
  @IsOptional() @IsUUID() employeeId?: string;
}

class AttachmentFields {
  @IsOptional() @IsString() @MaxLength(3_000_000) attachment?: string | null;
  @IsOptional() @IsString() @MaxLength(200) attachmentName?: string | null;
  @IsOptional() @IsBoolean() approveNow?: boolean;
}

export class LeaveRequestDto extends AttachmentFields {
  @IsUUID() employeeId!: string;
  @IsUUID() leaveTypeId!: string;
  @Matches(DATE, DATE_MSG) startDate!: string;
  @Matches(DATE, DATE_MSG) endDate!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
}

export class SickLeaveDto extends AttachmentFields {
  @IsUUID() employeeId!: string;
  @Matches(DATE, DATE_MSG) startDate!: string;
  @Matches(DATE, DATE_MSG) endDate!: string;
  @IsOptional() @IsString() @MaxLength(100) certificateRef?: string | null;
  @IsOptional() @IsString() @MaxLength(100) doctorName?: string | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
  @IsOptional() @IsIn(['UNPAID', 'PAID', 'PARTIAL']) payrollTreatment?: 'UNPAID' | 'PAID' | 'PARTIAL';
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) paidPercent?: number;
}

export class AbsenceDto extends AttachmentFields {
  @IsUUID() employeeId!: string;
  @IsUUID() absenceTypeId!: string;
  @Matches(DATE, DATE_MSG) startDate!: string;
  @Matches(DATE, DATE_MSG) endDate!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
  @IsOptional() @IsBoolean() isPaid?: boolean;
}

// ── Overtime / bonuses / deductions ─────────────────────────────────────────

export class OvertimeDto {
  @IsUUID() employeeId!: string;
  @Matches(DATE, DATE_MSG) date!: string;
  @IsInt() @Min(1) @Max(1440) minutes!: number;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  @IsOptional() @IsIn(['WORKDAY', 'REST_DAY', 'HOLIDAY']) ruleCode?: string;
}

export class OvertimeDecisionDto extends DecisionDto {
  @IsOptional() @IsInt() @Min(1) @Max(1440) approvedMinutes?: number;
}

export class ItemQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsIn(Object.values(HrApprovalStatus)) status?: HrApprovalStatus;
}

export class BonusDto {
  @IsUUID() employeeId!: string;
  @IsOptional() @IsIn(['BONUS', 'ALLOWANCE']) category?: 'BONUS' | 'ALLOWANCE';
  @IsString() @MinLength(2) @MaxLength(100) bonusType!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) amount!: number;
  @IsInt() @Min(2000) @Max(2100) year!: number;
  @IsInt() @Min(1) @Max(12) month!: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
  @IsOptional() @IsBoolean() approveNow?: boolean;
}

export class DeductionDto {
  @IsUUID() employeeId!: string;
  @IsString() @MinLength(2) @MaxLength(100) deductionType!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) amount!: number;
  @IsInt() @Min(2000) @Max(2100) year!: number;
  @IsInt() @Min(1) @Max(12) month!: number;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  @IsOptional() @IsBoolean() approveNow?: boolean;
}

// ── Money out ───────────────────────────────────────────────────────────────

class MoneyOutFields {
  @IsIn(PAYMENT_METHODS) paymentMethod!: string;
  @IsOptional() @IsUUID() cashRegisterId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) reference?: string | null;
  @IsString() @MinLength(8) @MaxLength(120) idempotencyKey!: string;
}

export class AdvanceDto extends MoneyOutFields {
  @IsUUID() employeeId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) amount!: number;
  @Matches(DATE, DATE_MSG) date!: string;
  @IsOptional() @IsInt() @Min(2000) @Max(2100) deductYear?: number;
  @IsOptional() @IsInt() @Min(1) @Max(12) deductMonth?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class AdvanceQueryDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsIn(['OPEN', 'DEDUCTED', 'CANCELLED']) status?: string;
  @IsOptional() @Matches(DATE, DATE_MSG) from?: string;
  @IsOptional() @Matches(DATE, DATE_MSG) to?: string;
}

export class LoanDto extends MoneyOutFields {
  @IsUUID() employeeId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) principal!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) installmentAmount!: number;
  @IsInt() @Min(2000) @Max(2100) startYear!: number;
  @IsInt() @Min(1) @Max(12) startMonth!: number;
  @Matches(DATE, DATE_MSG) disbursedAt!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class LoanQueryDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'COMPLETED', 'CANCELLED']) status?: string;
}

export class RepaymentDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
  @Matches(DATE, DATE_MSG) date!: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string | null;
}

export class ExpenseDto extends MoneyOutFields {
  @IsString() @MaxLength(40) category!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) amount!: number;
  @Matches(DATE, DATE_MSG) date!: string;
  @IsOptional() @IsUUID() employeeId?: string | null;
  @IsString() @MinLength(3) @MaxLength(500) description!: string;
}

export class ExpenseQueryDto {
  @IsOptional() @Matches(DATE, DATE_MSG) from?: string;
  @IsOptional() @Matches(DATE, DATE_MSG) to?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
}

// ── Payroll ─────────────────────────────────────────────────────────────────

export class CreatePeriodDto {
  @IsInt() @Min(2000) @Max(2100) year!: number;
  @IsInt() @Min(1) @Max(12) month!: number;
}

export class ValidatePeriodDto {
  @IsOptional() @IsBoolean() force?: boolean;
  @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
}

export class PaymentDto extends MoneyOutFields {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) amount!: number;
  @IsOptional() @Matches(DATE, DATE_MSG) paidAt?: string | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class PayAllDto extends MoneyOutFields {
  @IsOptional() @Matches(DATE, DATE_MSG) paidAt?: string | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class PaymentQueryDto {
  @IsOptional() @IsUUID() periodId?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @Matches(DATE, DATE_MSG) from?: string;
  @IsOptional() @Matches(DATE, DATE_MSG) to?: string;
  @IsOptional() @IsIn(['POSTED', 'CANCELLED']) status?: string;
}
