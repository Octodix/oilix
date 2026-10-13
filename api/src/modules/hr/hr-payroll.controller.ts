import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermissions, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  AdvanceDto,
  AdvanceQueryDto,
  BonusDto,
  CreatePeriodDto,
  DecisionDto,
  DeductionDto,
  ExpenseDto,
  ExpenseQueryDto,
  ItemQueryDto,
  LoanDto,
  LoanQueryDto,
  OptionalRangeQueryDto,
  OvertimeDecisionDto,
  OvertimeDto,
  PayAllDto,
  PaymentDto,
  PaymentQueryDto,
  ReasonDto,
  RepaymentDto,
  ValidatePeriodDto,
} from './dto/hr.dto';
import { actorOf, can } from './hr-common';
import { HrPayItemsService } from './hr-pay-items.service';
import { HrPayrollService } from './hr-payroll.service';

const P = Permission;

@ApiTags('hr')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr')
export class HrPayrollController {
  constructor(
    private audit: AuditService,
    private items: HrPayItemsService,
    private payroll: HrPayrollService,
  ) {}

  @Get('cash-registers')
  @RequireAnyPermissions(P.HR_ADVANCES_MANAGE, P.HR_SALARY_PAY, P.HR_EXPENSES_MANAGE)
  cashRegisters() {
    return this.items.openCashRegisters();
  }

  // ── Overtime ─────────────────────────────────────────────────────────────

  @Get('overtime')
  @RequireAnyPermissions(P.HR_OVERTIME_MANAGE, P.HR_ATTENDANCE_VIEW)
  listOvertime(@Query() q: OptionalRangeQueryDto) {
    return this.items.listOvertime(q);
  }

  @Post('overtime')
  @RequirePermissions(P.HR_OVERTIME_MANAGE)
  async createOvertime(@Body() dto: OvertimeDto, @CurrentUser() user: JwtPayload) {
    return this.items.createOvertime(dto, await actorOf(this.audit, user));
  }

  @Post('overtime/:id/decision')
  @RequirePermissions(P.HR_OVERTIME_MANAGE)
  async decideOvertime(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OvertimeDecisionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (dto.decision !== 'CANCEL' && !can(user, P.HR_OVERTIME_APPROVE)) {
      throw new ForbiddenException('ليست لديك صلاحية اعتماد الساعات الإضافية');
    }
    return this.items.decideOvertime(id, dto.decision, dto, await actorOf(this.audit, user));
  }

  // ── Bonuses / deductions ─────────────────────────────────────────────────

  @Get('bonuses')
  @RequirePermissions(P.HR_BONUSES_MANAGE)
  listBonuses(@Query() q: ItemQueryDto) {
    return this.items.listBonuses(q);
  }

  @Post('bonuses')
  @RequirePermissions(P.HR_BONUSES_MANAGE)
  async createBonus(@Body() dto: BonusDto, @CurrentUser() user: JwtPayload) {
    return this.items.createBonus(dto, await actorOf(this.audit, user));
  }

  @Post('bonuses/:id/decision')
  @RequirePermissions(P.HR_BONUSES_MANAGE)
  async decideBonus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() user: JwtPayload) {
    return this.items.decideItem('bonus', id, dto.decision, dto.note ?? null, await actorOf(this.audit, user));
  }

  @Get('deductions')
  @RequirePermissions(P.HR_DEDUCTIONS_MANAGE)
  listDeductions(@Query() q: ItemQueryDto) {
    return this.items.listDeductions(q);
  }

  @Post('deductions')
  @RequirePermissions(P.HR_DEDUCTIONS_MANAGE)
  async createDeduction(@Body() dto: DeductionDto, @CurrentUser() user: JwtPayload) {
    return this.items.createDeduction(dto, await actorOf(this.audit, user));
  }

  @Post('deductions/:id/decision')
  @RequirePermissions(P.HR_DEDUCTIONS_MANAGE)
  async decideDeduction(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() user: JwtPayload) {
    return this.items.decideItem('deduction', id, dto.decision, dto.note ?? null, await actorOf(this.audit, user));
  }

  // ── Advances / loans ─────────────────────────────────────────────────────

  @Get('advances')
  @RequirePermissions(P.HR_ADVANCES_MANAGE)
  listAdvances(@Query() q: AdvanceQueryDto) {
    return this.items.listAdvances(q);
  }

  @Post('advances')
  @RequirePermissions(P.HR_ADVANCES_MANAGE)
  async createAdvance(@Body() dto: AdvanceDto, @CurrentUser() user: JwtPayload) {
    return this.items.createAdvance(dto, await actorOf(this.audit, user));
  }

  @Post('advances/:id/cancel')
  @RequirePermissions(P.HR_ADVANCES_MANAGE)
  async cancelAdvance(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() user: JwtPayload) {
    return this.items.cancelAdvance(id, dto.reason, await actorOf(this.audit, user));
  }

  @Get('loans')
  @RequirePermissions(P.HR_ADVANCES_MANAGE)
  listLoans(@Query() q: LoanQueryDto) {
    return this.items.listLoans(q);
  }

  @Post('loans')
  @RequirePermissions(P.HR_ADVANCES_MANAGE)
  async createLoan(@Body() dto: LoanDto, @CurrentUser() user: JwtPayload) {
    return this.items.createLoan(dto, await actorOf(this.audit, user));
  }

  @Post('loans/:id/cancel')
  @RequirePermissions(P.HR_ADVANCES_MANAGE)
  async cancelLoan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() user: JwtPayload) {
    return this.items.cancelLoan(id, dto.reason, await actorOf(this.audit, user));
  }

  @Post('loans/:id/repayments')
  @RequirePermissions(P.HR_ADVANCES_MANAGE)
  async repayLoan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RepaymentDto, @CurrentUser() user: JwtPayload) {
    return this.items.manualRepayment(id, dto, await actorOf(this.audit, user));
  }

  // ── HR expenses ──────────────────────────────────────────────────────────

  @Get('expenses')
  @RequirePermissions(P.HR_EXPENSES_VIEW)
  listExpenses(@Query() q: ExpenseQueryDto) {
    return this.items.listExpenses(q);
  }

  @Post('expenses')
  @RequirePermissions(P.HR_EXPENSES_MANAGE)
  async createExpense(@Body() dto: ExpenseDto, @CurrentUser() user: JwtPayload) {
    return this.items.createExpense(dto, await actorOf(this.audit, user));
  }

  @Post('expenses/:id/cancel')
  @RequirePermissions(P.HR_EXPENSES_MANAGE)
  async cancelExpense(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() user: JwtPayload) {
    return this.items.cancelExpense(id, dto.reason, await actorOf(this.audit, user));
  }

  // ── Payroll periods ──────────────────────────────────────────────────────

  @Get('payroll/periods')
  @RequirePermissions(P.HR_PAYROLL_VIEW)
  listPeriods() {
    return this.payroll.listPeriods();
  }

  @Post('payroll/periods')
  @RequirePermissions(P.HR_PAYROLL_CALCULATE)
  async createPeriod(@Body() dto: CreatePeriodDto, @CurrentUser() user: JwtPayload) {
    return this.payroll.createPeriod(dto.year, dto.month, await actorOf(this.audit, user));
  }

  @Get('payroll/periods/:id')
  @RequirePermissions(P.HR_PAYROLL_VIEW)
  getPeriod(@Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.getPeriod(id);
  }

  @Post('payroll/periods/:id/calculate')
  @RequirePermissions(P.HR_PAYROLL_CALCULATE)
  async calculate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.payroll.calculate(id, await actorOf(this.audit, user));
  }

  @Post('payroll/periods/:id/review')
  @RequirePermissions(P.HR_PAYROLL_CALCULATE)
  async review(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.payroll.review(id, await actorOf(this.audit, user));
  }

  @Post('payroll/periods/:id/validate')
  @RequirePermissions(P.HR_PAYROLL_VALIDATE)
  async validate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ValidatePeriodDto, @CurrentUser() user: JwtPayload) {
    return this.payroll.validate(id, dto, await actorOf(this.audit, user));
  }

  @Post('payroll/periods/:id/reopen')
  @RequirePermissions(P.HR_PAYROLL_VALIDATE)
  async reopen(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() user: JwtPayload) {
    return this.payroll.reopen(id, dto.reason, await actorOf(this.audit, user));
  }

  @Post('payroll/periods/:id/close')
  @RequirePermissions(P.HR_PAYROLL_VALIDATE)
  async close(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.payroll.close(id, await actorOf(this.audit, user));
  }

  @Post('payroll/periods/:id/pay-all')
  @RequirePermissions(P.HR_SALARY_PAY)
  async payAll(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayAllDto, @CurrentUser() user: JwtPayload) {
    return this.payroll.payAll(id, dto, await actorOf(this.audit, user));
  }

  @Get('payroll/payslips/:id')
  @RequirePermissions(P.HR_PAYROLL_VIEW)
  payslip(@Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.getPayslip(id);
  }

  @Post('payroll/payslips/:id/payments')
  @RequirePermissions(P.HR_SALARY_PAY)
  async pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentDto, @CurrentUser() user: JwtPayload) {
    return this.payroll.pay(id, dto, await actorOf(this.audit, user));
  }

  @Get('payroll/payments')
  @RequirePermissions(P.HR_PAYROLL_VIEW)
  payments(@Query() q: PaymentQueryDto) {
    return this.payroll.listPayments(q);
  }

  @Post('payroll/payments/:id/cancel')
  @RequirePermissions(P.HR_SALARY_PAY)
  async cancelPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() user: JwtPayload) {
    return this.payroll.cancelPayment(id, dto.reason, await actorOf(this.audit, user));
  }
}
