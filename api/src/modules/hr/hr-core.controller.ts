import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermissions, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  ArchiveDto,
  AssignmentDto,
  AssignmentQueryDto,
  ContractQueryDto,
  CreateContractDto,
  CreateEmployeeDto,
  DepartmentDto,
  EmployeeMonthQueryDto,
  EmployeeQueryDto,
  HolidayDto,
  HolidayQueryDto,
  HrSettingsDto,
  RangeQueryDto,
  ScheduleDto,
  TerminateContractDto,
  UpdateContractDto,
  UpdateDepartmentDto,
  UpdateEmployeeDto,
  UpdateScheduleDto,
} from './dto/hr.dto';
import { ATTENDANCE_STATUSES } from './engine/attendance-engine';
import { addDays } from './engine/hr-time';
import { HrAttendanceService } from './hr-attendance.service';
import { actorOf, PAYMENT_METHODS } from './hr-common';
import { HrDevicesService } from './hr-devices.service';
import { CONTRACT_TYPES, EMPLOYEE_PAYMENT_METHODS, HrEmployeesService } from './hr-employees.service';
import { EXPENSE_CATEGORIES, HrPayItemsService } from './hr-pay-items.service';
import { HrReportsService } from './hr-reports.service';
import { HrSchedulesService } from './hr-schedules.service';
import { HrSettingsService } from './hr-settings.service';

const P = Permission;

@ApiTags('hr')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr')
export class HrCoreController {
  constructor(
    private audit: AuditService,
    private settings: HrSettingsService,
    private employees: HrEmployeesService,
    private schedules: HrSchedulesService,
    private attendance: HrAttendanceService,
    private devices: HrDevicesService,
    private payItems: HrPayItemsService,
    private reports: HrReportsService,
  ) {}

  /** Schedule changes alter already-computed days; locked payroll months are skipped by process(). */
  private async recompute(fromDate: string | Date) {
    const today = await this.attendance.today();
    const from = typeof fromDate === 'string' ? fromDate : fromDate.toISOString().slice(0, 10);
    const floor = addDays(today, -400);
    await this.attendance.process({ from: from < floor ? floor : from, to: today });
  }

  // ── Meta / dashboard / settings ──────────────────────────────────────────

  @Get('meta')
  @RequirePermissions(P.HR_ACCESS)
  async meta() {
    const settings = await this.settings.get();
    return {
      today: await this.attendance.today(),
      timezoneOffsetMinutes: settings.timezoneOffsetMinutes,
      workSites: settings.workSites,
      contractTypes: CONTRACT_TYPES,
      employeePaymentMethods: EMPLOYEE_PAYMENT_METHODS,
      paymentMethods: PAYMENT_METHODS,
      expenseCategories: EXPENSE_CATEGORIES,
      attendanceStatuses: ATTENDANCE_STATUSES,
      providers: this.devices.providers(),
      overtimeMultipliers: settings.payroll.overtimeMultipliers,
      allowPartialPayments: settings.payroll.allowPartialPayments,
    };
  }

  @Get('dashboard')
  @RequirePermissions(P.HR_DASHBOARD_VIEW)
  dashboard(@CurrentUser() user: JwtPayload) {
    return this.reports.dashboard(user);
  }

  @Get('settings')
  @RequirePermissions(P.HR_ACCESS)
  getSettings() {
    return this.settings.get();
  }

  @Patch('settings')
  @RequirePermissions(P.HR_SETTINGS_MANAGE)
  updateSettings(@Body() dto: HrSettingsDto, @CurrentUser() user: JwtPayload) {
    return this.settings.update(dto as Record<string, unknown>, user.sub);
  }

  // ── Departments ──────────────────────────────────────────────────────────

  @Get('departments')
  @RequirePermissions(P.HR_ACCESS)
  listDepartments() {
    return this.employees.listDepartments();
  }

  @Post('departments')
  @RequireAnyPermissions(P.HR_SETTINGS_MANAGE, P.HR_EMPLOYEES_EDIT)
  async createDepartment(@Body() dto: DepartmentDto, @CurrentUser() user: JwtPayload) {
    return this.employees.createDepartment(dto, await actorOf(this.audit, user));
  }

  @Patch('departments/:id')
  @RequireAnyPermissions(P.HR_SETTINGS_MANAGE, P.HR_EMPLOYEES_EDIT)
  async updateDepartment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.employees.updateDepartment(id, dto, await actorOf(this.audit, user));
  }

  // ── Employees ────────────────────────────────────────────────────────────

  @Get('employees')
  @RequirePermissions(P.HR_EMPLOYEES_VIEW)
  listEmployees(@Query() q: EmployeeQueryDto, @CurrentUser() user: JwtPayload) {
    return this.employees.list(q, user);
  }

  @Get('employees/options')
  @RequirePermissions(P.HR_ACCESS)
  employeeOptions(@Query('includeLeft') includeLeft?: string) {
    return this.employees.options(includeLeft === 'true');
  }

  @Get('employees/linkable-users')
  @RequireAnyPermissions(P.HR_EMPLOYEES_CREATE, P.HR_EMPLOYEES_EDIT)
  linkableUsers() {
    return this.employees.linkableUsers();
  }

  @Get('employees/:id')
  @RequirePermissions(P.HR_EMPLOYEES_VIEW)
  getEmployee(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.employees.get(id, user);
  }

  @Post('employees')
  @RequirePermissions(P.HR_EMPLOYEES_CREATE)
  async createEmployee(@Body() dto: CreateEmployeeDto, @CurrentUser() user: JwtPayload) {
    return this.employees.create(dto, user, await actorOf(this.audit, user));
  }

  @Patch('employees/:id')
  @RequirePermissions(P.HR_EMPLOYEES_EDIT)
  async updateEmployee(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.employees.update(id, dto, user, await actorOf(this.audit, user));
  }

  @Post('employees/:id/archive')
  @RequirePermissions(P.HR_EMPLOYEES_ARCHIVE)
  async archiveEmployee(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ArchiveDto, @CurrentUser() user: JwtPayload) {
    return this.employees.archive(id, dto.archived, await actorOf(this.audit, user));
  }

  @Get('employees/:id/contracts')
  @RequirePermissions(P.HR_EMPLOYEES_VIEW)
  listContracts(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.employees.listContracts(id, user);
  }

  @Get('employees/:id/month')
  @RequirePermissions(P.HR_ATTENDANCE_VIEW)
  employeeMonth(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: EmployeeMonthQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendance.employeeMonth(id, q.year, q.month, user);
  }

  @Get('employees/:id/device-mappings')
  @RequireAnyPermissions(P.HR_DEVICES_VIEW, P.HR_EMPLOYEES_VIEW)
  employeeMappings(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.employeeMappings(id);
  }

  // ── Contracts ────────────────────────────────────────────────────────────

  @Get('contracts')
  @RequirePermissions(P.HR_EMPLOYEES_VIEW)
  async listAllContracts(@Query() q: ContractQueryDto, @CurrentUser() user: JwtPayload) {
    return this.employees.listAllContracts({ ...q, today: await this.attendance.today() }, user);
  }

  @Post('contracts')
  @RequirePermissions(P.HR_CONTRACTS_MANAGE)
  async createContract(@Body() dto: CreateContractDto, @CurrentUser() user: JwtPayload) {
    return this.employees.createContract(dto, user, await actorOf(this.audit, user));
  }

  @Patch('contracts/:id')
  @RequirePermissions(P.HR_CONTRACTS_MANAGE)
  async updateContract(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.employees.updateContract(id, dto, user, await actorOf(this.audit, user));
  }

  @Post('contracts/:id/terminate')
  @RequirePermissions(P.HR_CONTRACTS_MANAGE)
  async terminateContract(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TerminateContractDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.employees.terminateContract(id, dto, user, await actorOf(this.audit, user));
  }

  // ── Schedules / assignments / holidays ───────────────────────────────────

  @Get('schedules')
  @RequirePermissions(P.HR_ACCESS)
  listSchedules() {
    return this.schedules.list();
  }

  @Post('schedules')
  @RequirePermissions(P.HR_SCHEDULES_MANAGE)
  async createSchedule(@Body() dto: ScheduleDto, @CurrentUser() user: JwtPayload) {
    return this.schedules.create(dto, await actorOf(this.audit, user));
  }

  @Patch('schedules/:id')
  @RequirePermissions(P.HR_SCHEDULES_MANAGE)
  async updateSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const row = await this.schedules.update(id, dto, await actorOf(this.audit, user));
    await this.recompute(addDays(await this.attendance.today(), -62));
    return row;
  }

  @Get('schedule-assignments')
  @RequirePermissions(P.HR_ACCESS)
  listAssignments(@Query() q: AssignmentQueryDto) {
    return this.schedules.listAssignments(q);
  }

  @Post('schedule-assignments')
  @RequirePermissions(P.HR_SCHEDULES_MANAGE)
  async createAssignment(@Body() dto: AssignmentDto, @CurrentUser() user: JwtPayload) {
    const row = await this.schedules.createAssignment(dto, await actorOf(this.audit, user));
    await this.recompute(row.startDate);
    return row;
  }

  @Delete('schedule-assignments/:id')
  @RequirePermissions(P.HR_SCHEDULES_MANAGE)
  async deleteAssignment(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    const row = await this.schedules.deleteAssignment(id, await actorOf(this.audit, user));
    await this.recompute(row.startDate);
    return row;
  }

  @Get('holidays')
  @RequirePermissions(P.HR_ACCESS)
  listHolidays(@Query() q: HolidayQueryDto) {
    return this.schedules.listHolidays(q.year);
  }

  @Post('holidays')
  @RequirePermissions(P.HR_SCHEDULES_MANAGE)
  async createHoliday(@Body() dto: HolidayDto, @CurrentUser() user: JwtPayload) {
    const row = await this.schedules.createHoliday(dto, await actorOf(this.audit, user));
    if (dto.date <= (await this.attendance.today())) await this.recompute(dto.date);
    return row;
  }

  @Delete('holidays/:id')
  @RequirePermissions(P.HR_SCHEDULES_MANAGE)
  async deleteHoliday(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    const row = await this.schedules.deleteHoliday(id, await actorOf(this.audit, user));
    await this.recompute(row.date);
    return row;
  }

  // ── Reports ──────────────────────────────────────────────────────────────

  @Get('reports/attendance')
  @RequirePermissions(P.HR_REPORTS_VIEW)
  attendanceReport(@Query() q: RangeQueryDto) {
    return this.reports.attendanceSummary(q);
  }

  @Get('reports/expenses')
  @RequirePermissions(P.HR_EXPENSES_VIEW)
  expensesReport(@Query() q: RangeQueryDto) {
    return this.payItems.expenseSummary(q.from, q.to);
  }
}
