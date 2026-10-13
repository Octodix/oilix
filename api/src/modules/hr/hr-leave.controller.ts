import { Body, Controller, ForbiddenException, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermissions, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  AbsenceDto,
  AbsenceTypeDto,
  BalanceQueryDto,
  DecisionDto,
  EntitlementDto,
  LeaveRequestDto,
  LeaveTypeDto,
  OptionalRangeQueryDto,
  SickLeaveDto,
} from './dto/hr.dto';
import { actorOf, can } from './hr-common';
import { HrLeaveService } from './hr-leave.service';

const P = Permission;
type Kind = Parameters<HrLeaveService['decide']>[0];

@ApiTags('hr')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr')
export class HrLeaveController {
  constructor(
    private audit: AuditService,
    private leave: HrLeaveService,
  ) {}

  private canApprove(user: JwtPayload) {
    return can(user, P.HR_LEAVE_APPROVE);
  }

  private async decide(kind: Kind, id: string, dto: DecisionDto, user: JwtPayload) {
    if (dto.decision !== 'CANCEL' && !this.canApprove(user)) {
      throw new ForbiddenException('ليست لديك صلاحية الموافقة أو الرفض');
    }
    return this.leave.decide(kind, id, dto.decision, { note: dto.note }, await actorOf(this.audit, user));
  }

  private withApproval<T extends { approveNow?: boolean }>(dto: T, user: JwtPayload): T {
    if (dto.approveNow && !this.canApprove(user)) {
      throw new ForbiddenException('ليست لديك صلاحية الموافقة المباشرة');
    }
    return dto;
  }

  // ── Types ────────────────────────────────────────────────────────────────

  @Get('leave-types')
  @RequirePermissions(P.HR_ACCESS)
  leaveTypes() {
    return this.leave.listLeaveTypes();
  }

  @Post('leave-types')
  @RequirePermissions(P.HR_SETTINGS_MANAGE)
  async createLeaveType(@Body() dto: LeaveTypeDto, @CurrentUser() user: JwtPayload) {
    return this.leave.upsertLeaveType(null, dto, await actorOf(this.audit, user));
  }

  @Patch('leave-types/:id')
  @RequirePermissions(P.HR_SETTINGS_MANAGE)
  async updateLeaveType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LeaveTypeDto, @CurrentUser() user: JwtPayload) {
    return this.leave.upsertLeaveType(id, dto, await actorOf(this.audit, user));
  }

  @Get('absence-types')
  @RequirePermissions(P.HR_ACCESS)
  absenceTypes() {
    return this.leave.listAbsenceTypes();
  }

  @Post('absence-types')
  @RequirePermissions(P.HR_SETTINGS_MANAGE)
  async createAbsenceType(@Body() dto: AbsenceTypeDto, @CurrentUser() user: JwtPayload) {
    return this.leave.upsertAbsenceType(null, dto, await actorOf(this.audit, user));
  }

  @Patch('absence-types/:id')
  @RequirePermissions(P.HR_SETTINGS_MANAGE)
  async updateAbsenceType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AbsenceTypeDto, @CurrentUser() user: JwtPayload) {
    return this.leave.upsertAbsenceType(id, dto, await actorOf(this.audit, user));
  }

  // ── Balances ─────────────────────────────────────────────────────────────

  @Get('leave/balances')
  @RequireAnyPermissions(P.HR_LEAVE_MANAGE, P.HR_EMPLOYEES_VIEW)
  balances(@Query() q: BalanceQueryDto) {
    return this.leave.balances(q.year, q.employeeId);
  }

  @Post('leave/entitlements')
  @RequirePermissions(P.HR_LEAVE_APPROVE)
  async setEntitlement(@Body() dto: EntitlementDto, @CurrentUser() user: JwtPayload) {
    return this.leave.setEntitlement(dto, await actorOf(this.audit, user));
  }

  @Get('attachments/:kind/:id')
  @RequireAnyPermissions(P.HR_LEAVE_MANAGE, P.HR_ATTENDANCE_VIEW)
  attachment(@Param('kind', new ParseEnumPipe(['leave', 'sick', 'absence'])) kind: Kind, @Param('id', ParseUUIDPipe) id: string) {
    return this.leave.getAttachment(kind, id);
  }

  // ── Leave ────────────────────────────────────────────────────────────────

  @Get('leave')
  @RequireAnyPermissions(P.HR_LEAVE_MANAGE, P.HR_ATTENDANCE_VIEW)
  listLeave(@Query() q: OptionalRangeQueryDto) {
    return this.leave.listLeaveRequests(q);
  }

  @Post('leave')
  @RequirePermissions(P.HR_LEAVE_MANAGE)
  async createLeave(@Body() dto: LeaveRequestDto, @CurrentUser() user: JwtPayload) {
    return this.leave.createLeaveRequest(this.withApproval(dto, user), this.canApprove(user), await actorOf(this.audit, user));
  }

  @Post('leave/:id/decision')
  @RequirePermissions(P.HR_LEAVE_MANAGE)
  decideLeave(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() user: JwtPayload) {
    return this.decide('leave', id, dto, user);
  }

  // ── Sick leave ───────────────────────────────────────────────────────────

  @Get('sick-leave')
  @RequireAnyPermissions(P.HR_LEAVE_MANAGE, P.HR_ATTENDANCE_VIEW)
  listSick(@Query() q: OptionalRangeQueryDto) {
    return this.leave.listSickLeaves(q);
  }

  @Post('sick-leave')
  @RequirePermissions(P.HR_LEAVE_MANAGE)
  async createSick(@Body() dto: SickLeaveDto, @CurrentUser() user: JwtPayload) {
    return this.leave.createSickLeave(this.withApproval(dto, user), this.canApprove(user), await actorOf(this.audit, user));
  }

  @Post('sick-leave/:id/decision')
  @RequirePermissions(P.HR_LEAVE_MANAGE)
  decideSick(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() user: JwtPayload) {
    return this.decide('sick', id, dto, user);
  }

  // ── Absences ─────────────────────────────────────────────────────────────

  @Get('absences')
  @RequireAnyPermissions(P.HR_LEAVE_MANAGE, P.HR_ATTENDANCE_VIEW)
  listAbsences(@Query() q: OptionalRangeQueryDto) {
    return this.leave.listAbsences(q);
  }

  @Post('absences')
  @RequirePermissions(P.HR_LEAVE_MANAGE)
  async createAbsence(@Body() dto: AbsenceDto, @CurrentUser() user: JwtPayload) {
    return this.leave.createAbsence(this.withApproval(dto, user), this.canApprove(user), await actorOf(this.audit, user));
  }

  @Post('absences/:id/decision')
  @RequirePermissions(P.HR_LEAVE_MANAGE)
  decideAbsence(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() user: JwtPayload) {
    return this.decide('absence', id, dto, user);
  }
}
