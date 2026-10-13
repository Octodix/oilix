-- Ressources humaines: employees, contracts, schedules, attendance terminals, raw punches,
-- processed attendance, leave, overtime, advances/loans, payroll, salary payments, HR expenses.
-- Additive only: new enums, new permission values and new hr_* tables. No existing data is touched.

-- CreateEnum
CREATE TYPE "HrEmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'LEFT');

-- CreateEnum
CREATE TYPE "HrSalaryMode" AS ENUM ('MONTHLY', 'DAILY', 'HOURLY');

-- CreateEnum
CREATE TYPE "HrApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrPayrollStatus" AS ENUM ('DRAFT', 'CALCULATED', 'REVIEWED', 'VALIDATED', 'PAID', 'CLOSED');

-- AlterEnum (PostgreSQL 12+)

ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_ACCESS';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_DASHBOARD_VIEW';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_EMPLOYEES_VIEW';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_EMPLOYEES_CREATE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_EMPLOYEES_EDIT';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_EMPLOYEES_ARCHIVE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_SALARIES_VIEW';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_SALARIES_EDIT';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_CONTRACTS_MANAGE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_SCHEDULES_MANAGE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_ATTENDANCE_VIEW';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_ATTENDANCE_CORRECT';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_LEAVE_MANAGE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_LEAVE_APPROVE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_OVERTIME_MANAGE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_OVERTIME_APPROVE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_ADVANCES_MANAGE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_BONUSES_MANAGE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_DEDUCTIONS_MANAGE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_PAYROLL_VIEW';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_PAYROLL_CALCULATE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_PAYROLL_VALIDATE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_SALARY_PAY';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_EXPENSES_VIEW';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_EXPENSES_MANAGE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_REPORTS_VIEW';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_DEVICES_VIEW';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_DEVICES_MANAGE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_DEVICES_SYNC';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'HR_SETTINGS_MANAGE';

-- CreateTable
CREATE TABLE "hr_departments" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "name_fr" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employees" (
    "id" TEXT NOT NULL,
    "matricule" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "photo" TEXT,
    "birth_date" DATE,
    "phone" TEXT,
    "address" TEXT,
    "national_id_number" TEXT,
    "national_id_issued_at" DATE,
    "national_id_issued_by" TEXT,
    "social_security_number" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "emergency_contact_relation" TEXT,
    "job_title" TEXT,
    "department_id" TEXT,
    "work_site" TEXT,
    "hire_date" DATE NOT NULL,
    "status" "HrEmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "left_at" DATE,
    "left_reason" TEXT,
    "payment_method" TEXT NOT NULL DEFAULT 'CASH',
    "bank_account" TEXT,
    "user_id" TEXT,
    "notes" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_contracts" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "contract_type" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "trial_end_date" DATE,
    "salary_mode" "HrSalaryMode" NOT NULL DEFAULT 'MONTHLY',
    "base_salary" DECIMAL(14,2) NOT NULL,
    "weekly_hours" DECIMAL(5,2) NOT NULL DEFAULT 40,
    "job_title" TEXT,
    "department_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "terminated_at" DATE,
    "termination_reason" TEXT,
    "document_ref" TEXT,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_work_schedules" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_schedule_segments" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "hr_schedule_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_schedule_assignments" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "department_id" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "is_override" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_schedule_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_holidays" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_attendance_devices" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "serial_number" TEXT,
    "ip_address" TEXT,
    "port" INTEGER,
    "provider" TEXT NOT NULL,
    "comm_key" TEXT,
    "location" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "timezone_offset_minutes" INTEGER NOT NULL DEFAULT 60,
    "file_column_map" JSONB,
    "sync_interval_minutes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "last_connection_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_successful_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_log_stamp" TEXT,
    "last_event_at" TIMESTAMP(3),
    "device_info" JSONB,
    "last_diagnostic" JSONB,
    "last_diagnostic_at" TIMESTAMP(3),
    "first_event_imported_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_attendance_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_attendance_device_users" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "device_user_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "device_user_name" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_attendance_device_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_attendance_sync_logs" (
    "id" TEXT NOT NULL,
    "device_id" TEXT,
    "provider" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "fetched_count" INTEGER NOT NULL DEFAULT 0,
    "inserted_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "unmapped_count" INTEGER NOT NULL DEFAULT 0,
    "invalid_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "file_name" TEXT,
    "file_hash" TEXT,
    "details" JSONB,
    "user_id" TEXT,
    "user_name" TEXT,

    CONSTRAINT "hr_attendance_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_attendance_events" (
    "id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "device_id" TEXT,
    "source" TEXT NOT NULL,
    "device_user_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "punched_at" TIMESTAMP(3) NOT NULL,
    "local_date" DATE NOT NULL,
    "device_local_time" TEXT NOT NULL,
    "punch_state" INTEGER,
    "verify_code" INTEGER,
    "verify_method" TEXT NOT NULL,
    "work_code" TEXT,
    "raw_line" TEXT,
    "batch_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_attendance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_attendance_days" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_working_day" BOOLEAN NOT NULL DEFAULT false,
    "schedule_id" TEXT,
    "schedule_name" TEXT,
    "scheduled_start" TIMESTAMP(3),
    "scheduled_end" TIMESTAMP(3),
    "expected_minutes" INTEGER NOT NULL DEFAULT 0,
    "first_in" TIMESTAMP(3),
    "last_out" TIMESTAMP(3),
    "punch_count" INTEGER NOT NULL DEFAULT 0,
    "in_event_id" TEXT,
    "out_event_id" TEXT,
    "in_verify_method" TEXT,
    "in_device_id" TEXT,
    "worked_minutes" INTEGER NOT NULL DEFAULT 0,
    "late_minutes" INTEGER NOT NULL DEFAULT 0,
    "chargeable_late_minutes" INTEGER NOT NULL DEFAULT 0,
    "is_late" BOOLEAN NOT NULL DEFAULT false,
    "early_leave_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_rule" TEXT,
    "leave_request_id" TEXT,
    "sick_leave_id" TEXT,
    "absence_id" TEXT,
    "holiday_id" TEXT,
    "late_justified" BOOLEAN NOT NULL DEFAULT false,
    "late_justification" TEXT,
    "late_decided_by_id" TEXT,
    "late_decided_by_name" TEXT,
    "late_decided_at" TIMESTAMP(3),
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "is_corrected" BOOLEAN NOT NULL DEFAULT false,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_attendance_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_attendance_corrections" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "check_in" TIMESTAMP(3),
    "check_out" TIMESTAMP(3),
    "status" TEXT,
    "reason" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" TEXT,
    "revoked_by_name" TEXT,
    "revoke_reason" TEXT,

    CONSTRAINT "hr_attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_fr" TEXT,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "deducts_from_balance" BOOLEAN NOT NULL DEFAULT false,
    "default_days_per_year" DECIMAL(5,1),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_entitlements" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_leave_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_requests" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "reason" TEXT,
    "attachment" TEXT,
    "attachment_name" TEXT,
    "status" "HrApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT,
    "requested_by_name" TEXT,
    "decided_by_id" TEXT,
    "decided_by_name" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_sick_leaves" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "certificate_ref" TEXT,
    "doctor_name" TEXT,
    "attachment" TEXT,
    "attachment_name" TEXT,
    "notes" TEXT,
    "status" "HrApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "payroll_treatment" TEXT NOT NULL DEFAULT 'UNPAID',
    "paid_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "decided_by_id" TEXT,
    "decided_by_name" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_sick_leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_absence_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_fr" TEXT,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "is_justified" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_absence_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_absences" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "absence_type_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "reason" TEXT,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "attachment" TEXT,
    "attachment_name" TEXT,
    "status" "HrApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "decided_by_id" TEXT,
    "decided_by_name" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_absences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_overtimes" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "calculated_minutes" INTEGER NOT NULL DEFAULT 0,
    "requested_minutes" INTEGER NOT NULL,
    "approved_minutes" INTEGER,
    "multiplier" DECIMAL(5,2) NOT NULL,
    "rule_code" TEXT NOT NULL DEFAULT 'WORKDAY',
    "reason" TEXT,
    "status" "HrApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_id" TEXT,
    "decided_by_name" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "payslip_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_overtimes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_advances" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "payment_method" TEXT NOT NULL,
    "cash_register_id" TEXT,
    "cash_session_id" TEXT,
    "cash_register_name" TEXT,
    "reference" TEXT,
    "deduct_year" INTEGER NOT NULL,
    "deduct_month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "deducted_payslip_id" TEXT,
    "notes" TEXT,
    "idempotency_key" TEXT,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_id" TEXT,
    "cancelled_by_name" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_loans" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "installment_amount" DECIMAL(14,2) NOT NULL,
    "start_year" INTEGER NOT NULL,
    "start_month" INTEGER NOT NULL,
    "disbursed_at" DATE NOT NULL,
    "payment_method" TEXT NOT NULL,
    "cash_register_id" TEXT,
    "cash_session_id" TEXT,
    "cash_register_name" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "idempotency_key" TEXT,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_loan_repayments" (
    "id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "payslip_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_loan_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_bonuses" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'BONUS',
    "bonus_type" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "HrApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "decided_by_id" TEXT,
    "decided_by_name" TEXT,
    "decided_at" TIMESTAMP(3),
    "payslip_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_bonuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_deductions" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "deduction_type" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "HrApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "decided_by_id" TEXT,
    "decided_by_name" TEXT,
    "decided_at" TIMESTAMP(3),
    "payslip_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_payroll_periods" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "HrPayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "settings_snapshot" JSONB,
    "employee_count" INTEGER NOT NULL DEFAULT 0,
    "total_gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "notes" TEXT,
    "calculated_at" TIMESTAMP(3),
    "calculated_by_id" TEXT,
    "calculated_by_name" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "reviewed_by_name" TEXT,
    "validated_at" TIMESTAMP(3),
    "validated_by_id" TEXT,
    "validated_by_name" TEXT,
    "paid_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "closed_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_payroll_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_payslips" (
    "id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CALCULATED',
    "employee_snapshot" JSONB NOT NULL,
    "contract_id" TEXT,
    "contract_snapshot" JSONB,
    "attendance_summary" JSONB NOT NULL,
    "salary_mode" "HrSalaryMode" NOT NULL,
    "base_salary" DECIMAL(14,2) NOT NULL,
    "daily_rate" DECIMAL(14,4) NOT NULL,
    "hourly_rate" DECIMAL(14,4) NOT NULL,
    "gross_earnings" DECIMAL(14,2) NOT NULL,
    "total_deductions" DECIMAL(14,2) NOT NULL,
    "net_salary" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payment_status" TEXT NOT NULL DEFAULT 'UNPAID',
    "warnings" JSONB,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_payslip_lines" (
    "id" TEXT NOT NULL,
    "payslip_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "label_fr" TEXT,
    "quantity" DECIMAL(12,2),
    "unit" TEXT,
    "rate" DECIMAL(14,4),
    "amount" DECIMAL(14,2) NOT NULL,
    "source_type" TEXT,
    "source_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "explanation" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "hr_payslip_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_salary_payments" (
    "id" TEXT NOT NULL,
    "payslip_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "payment_method" TEXT NOT NULL,
    "cash_register_id" TEXT,
    "cash_session_id" TEXT,
    "cash_register_name" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "idempotency_key" TEXT NOT NULL,
    "paid_by_id" TEXT NOT NULL,
    "paid_by_name" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_id" TEXT,
    "cancelled_by_name" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_salary_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_expenses" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "employee_id" TEXT,
    "description" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "cash_register_id" TEXT,
    "cash_session_id" TEXT,
    "cash_register_name" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "idempotency_key" TEXT,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_id" TEXT,
    "cancelled_by_name" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_departments_code_key" ON "hr_departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employees_matricule_key" ON "hr_employees"("matricule");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employees_user_id_key" ON "hr_employees"("user_id");

-- CreateIndex
CREATE INDEX "hr_employees_status_idx" ON "hr_employees"("status");

-- CreateIndex
CREATE INDEX "hr_employees_department_id_idx" ON "hr_employees"("department_id");

-- CreateIndex
CREATE INDEX "hr_employees_last_name_first_name_idx" ON "hr_employees"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "hr_employees_archived_at_idx" ON "hr_employees"("archived_at");

-- CreateIndex
CREATE INDEX "hr_contracts_employee_id_start_date_idx" ON "hr_contracts"("employee_id", "start_date");

-- CreateIndex
CREATE INDEX "hr_contracts_status_idx" ON "hr_contracts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_work_schedules_code_key" ON "hr_work_schedules"("code");

-- CreateIndex
CREATE INDEX "hr_schedule_segments_schedule_id_weekday_idx" ON "hr_schedule_segments"("schedule_id", "weekday");

-- CreateIndex
CREATE INDEX "hr_schedule_assignments_employee_id_start_date_idx" ON "hr_schedule_assignments"("employee_id", "start_date");

-- CreateIndex
CREATE INDEX "hr_schedule_assignments_department_id_start_date_idx" ON "hr_schedule_assignments"("department_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "hr_holidays_date_key" ON "hr_holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "hr_attendance_devices_serial_number_key" ON "hr_attendance_devices"("serial_number");

-- CreateIndex
CREATE INDEX "hr_attendance_device_users_employee_id_idx" ON "hr_attendance_device_users"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_attendance_device_users_device_id_device_user_id_key" ON "hr_attendance_device_users"("device_id", "device_user_id");

-- CreateIndex
CREATE INDEX "hr_attendance_sync_logs_device_id_started_at_idx" ON "hr_attendance_sync_logs"("device_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "hr_attendance_events_dedupe_key_key" ON "hr_attendance_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "hr_attendance_events_employee_id_punched_at_idx" ON "hr_attendance_events"("employee_id", "punched_at");

-- CreateIndex
CREATE INDEX "hr_attendance_events_device_id_punched_at_idx" ON "hr_attendance_events"("device_id", "punched_at");

-- CreateIndex
CREATE INDEX "hr_attendance_events_device_user_id_idx" ON "hr_attendance_events"("device_user_id");

-- CreateIndex
CREATE INDEX "hr_attendance_events_local_date_idx" ON "hr_attendance_events"("local_date");

-- CreateIndex
CREATE INDEX "hr_attendance_days_date_idx" ON "hr_attendance_days"("date");

-- CreateIndex
CREATE INDEX "hr_attendance_days_status_idx" ON "hr_attendance_days"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_attendance_days_employee_id_date_key" ON "hr_attendance_days"("employee_id", "date");

-- CreateIndex
CREATE INDEX "hr_attendance_corrections_employee_id_date_idx" ON "hr_attendance_corrections"("employee_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_types_code_key" ON "hr_leave_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_entitlements_employee_id_leave_type_id_year_key" ON "hr_leave_entitlements"("employee_id", "leave_type_id", "year");

-- CreateIndex
CREATE INDEX "hr_leave_requests_employee_id_start_date_idx" ON "hr_leave_requests"("employee_id", "start_date");

-- CreateIndex
CREATE INDEX "hr_leave_requests_status_idx" ON "hr_leave_requests"("status");

-- CreateIndex
CREATE INDEX "hr_sick_leaves_employee_id_start_date_idx" ON "hr_sick_leaves"("employee_id", "start_date");

-- CreateIndex
CREATE INDEX "hr_sick_leaves_status_idx" ON "hr_sick_leaves"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_absence_types_code_key" ON "hr_absence_types"("code");

-- CreateIndex
CREATE INDEX "hr_absences_employee_id_start_date_idx" ON "hr_absences"("employee_id", "start_date");

-- CreateIndex
CREATE INDEX "hr_absences_status_idx" ON "hr_absences"("status");

-- CreateIndex
CREATE INDEX "hr_overtimes_employee_id_date_idx" ON "hr_overtimes"("employee_id", "date");

-- CreateIndex
CREATE INDEX "hr_overtimes_status_idx" ON "hr_overtimes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_advances_idempotency_key_key" ON "hr_advances"("idempotency_key");

-- CreateIndex
CREATE INDEX "hr_advances_employee_id_date_idx" ON "hr_advances"("employee_id", "date");

-- CreateIndex
CREATE INDEX "hr_advances_status_idx" ON "hr_advances"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_loans_idempotency_key_key" ON "hr_loans"("idempotency_key");

-- CreateIndex
CREATE INDEX "hr_loans_employee_id_idx" ON "hr_loans"("employee_id");

-- CreateIndex
CREATE INDEX "hr_loans_status_idx" ON "hr_loans"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_loan_repayments_loan_id_payslip_id_key" ON "hr_loan_repayments"("loan_id", "payslip_id");

-- CreateIndex
CREATE INDEX "hr_bonuses_employee_id_year_month_idx" ON "hr_bonuses"("employee_id", "year", "month");

-- CreateIndex
CREATE INDEX "hr_bonuses_status_idx" ON "hr_bonuses"("status");

-- CreateIndex
CREATE INDEX "hr_deductions_employee_id_year_month_idx" ON "hr_deductions"("employee_id", "year", "month");

-- CreateIndex
CREATE INDEX "hr_deductions_status_idx" ON "hr_deductions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_payroll_periods_year_month_key" ON "hr_payroll_periods"("year", "month");

-- CreateIndex
CREATE INDEX "hr_payslips_employee_id_idx" ON "hr_payslips"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_payslips_period_id_employee_id_key" ON "hr_payslips"("period_id", "employee_id");

-- CreateIndex
CREATE INDEX "hr_payslip_lines_payslip_id_idx" ON "hr_payslip_lines"("payslip_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_salary_payments_idempotency_key_key" ON "hr_salary_payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "hr_salary_payments_payslip_id_idx" ON "hr_salary_payments"("payslip_id");

-- CreateIndex
CREATE INDEX "hr_salary_payments_period_id_idx" ON "hr_salary_payments"("period_id");

-- CreateIndex
CREATE INDEX "hr_salary_payments_employee_id_paid_at_idx" ON "hr_salary_payments"("employee_id", "paid_at");

-- CreateIndex
CREATE INDEX "hr_salary_payments_cash_session_id_idx" ON "hr_salary_payments"("cash_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_expenses_idempotency_key_key" ON "hr_expenses"("idempotency_key");

-- CreateIndex
CREATE INDEX "hr_expenses_date_idx" ON "hr_expenses"("date");

-- CreateIndex
CREATE INDEX "hr_expenses_category_idx" ON "hr_expenses"("category");

-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "hr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_contracts" ADD CONSTRAINT "hr_contracts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_contracts" ADD CONSTRAINT "hr_contracts_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "hr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_schedule_segments" ADD CONSTRAINT "hr_schedule_segments_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "hr_work_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_schedule_assignments" ADD CONSTRAINT "hr_schedule_assignments_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "hr_work_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_schedule_assignments" ADD CONSTRAINT "hr_schedule_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_schedule_assignments" ADD CONSTRAINT "hr_schedule_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "hr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_device_users" ADD CONSTRAINT "hr_attendance_device_users_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "hr_attendance_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_device_users" ADD CONSTRAINT "hr_attendance_device_users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_sync_logs" ADD CONSTRAINT "hr_attendance_sync_logs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "hr_attendance_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_events" ADD CONSTRAINT "hr_attendance_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "hr_attendance_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_events" ADD CONSTRAINT "hr_attendance_events_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_events" ADD CONSTRAINT "hr_attendance_events_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "hr_attendance_sync_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_days" ADD CONSTRAINT "hr_attendance_days_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_corrections" ADD CONSTRAINT "hr_attendance_corrections_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_entitlements" ADD CONSTRAINT "hr_leave_entitlements_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_entitlements" ADD CONSTRAINT "hr_leave_entitlements_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "hr_leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "hr_leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_sick_leaves" ADD CONSTRAINT "hr_sick_leaves_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_absences" ADD CONSTRAINT "hr_absences_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_absences" ADD CONSTRAINT "hr_absences_absence_type_id_fkey" FOREIGN KEY ("absence_type_id") REFERENCES "hr_absence_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_overtimes" ADD CONSTRAINT "hr_overtimes_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_overtimes" ADD CONSTRAINT "hr_overtimes_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "hr_payslips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_advances" ADD CONSTRAINT "hr_advances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_advances" ADD CONSTRAINT "hr_advances_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_advances" ADD CONSTRAINT "hr_advances_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_register_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_advances" ADD CONSTRAINT "hr_advances_deducted_payslip_id_fkey" FOREIGN KEY ("deducted_payslip_id") REFERENCES "hr_payslips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_loans" ADD CONSTRAINT "hr_loans_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_loans" ADD CONSTRAINT "hr_loans_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_loans" ADD CONSTRAINT "hr_loans_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_register_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_loan_repayments" ADD CONSTRAINT "hr_loan_repayments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "hr_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_loan_repayments" ADD CONSTRAINT "hr_loan_repayments_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "hr_payslips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_bonuses" ADD CONSTRAINT "hr_bonuses_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_bonuses" ADD CONSTRAINT "hr_bonuses_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "hr_payslips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_deductions" ADD CONSTRAINT "hr_deductions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_deductions" ADD CONSTRAINT "hr_deductions_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "hr_payslips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "hr_payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payslip_lines" ADD CONSTRAINT "hr_payslip_lines_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "hr_payslips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_salary_payments" ADD CONSTRAINT "hr_salary_payments_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "hr_payslips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_salary_payments" ADD CONSTRAINT "hr_salary_payments_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "hr_payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_salary_payments" ADD CONSTRAINT "hr_salary_payments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_salary_payments" ADD CONSTRAINT "hr_salary_payments_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_salary_payments" ADD CONSTRAINT "hr_salary_payments_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_register_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_expenses" ADD CONSTRAINT "hr_expenses_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_expenses" ADD CONSTRAINT "hr_expenses_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_expenses" ADD CONSTRAINT "hr_expenses_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_register_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One calculated-overtime row per employee/day (manual entries may be several).
CREATE UNIQUE INDEX "hr_overtimes_calculated_one_per_day_idx"
  ON "hr_overtimes"("employee_id", "date")
  WHERE "source" = 'CALCULATED';
