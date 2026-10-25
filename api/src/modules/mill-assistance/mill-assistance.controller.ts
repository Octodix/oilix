import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MillAssistanceStatus, Permission } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermissions, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  CloseAssistanceDto,
  ConfirmHandoverDto,
  ResolveDiscrepancyDto,
  StartAssistanceDto,
} from './dto/mill-assistance.dto';
import { MillAssistanceService } from './mill-assistance.service';

@ApiTags('مساعدة المشغّل الرئيسي')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('mill-assistance')
export class MillAssistanceController {
  constructor(private service: MillAssistanceService) {}

  @Get('me')
  @RequirePermissions(Permission.MILL_ASSIST_START)
  @ApiOperation({ summary: 'جلستي النشطة وجلساتي بانتظار التأكيد' })
  me(@CurrentUser() user: JwtPayload) {
    return this.service.mine(user);
  }

  @Get('primaries')
  @RequirePermissions(Permission.MILL_ASSIST_START)
  @ApiOperation({ summary: 'المشغّلون الذين يمكن مساعدتهم' })
  primaries(@CurrentUser() user: JwtPayload) {
    return this.service.primaryCandidates(user);
  }

  @Post('sessions')
  @RequirePermissions(Permission.MILL_ASSIST_START)
  @ApiOperation({ summary: 'بدء جلسة مساعدة' })
  start(@Body() dto: StartAssistanceDto, @CurrentUser() user: JwtPayload) {
    return this.service.start(dto, user);
  }

  @Get('dashboard')
  @RequireAnyPermissions(Permission.MILL_ASSIST_VIEW_ALL, Permission.MILL_ASSIST_CONFIRM)
  @ApiOperation({ summary: 'لوحة المشغّل الرئيسي' })
  dashboard(@CurrentUser() user: JwtPayload) {
    return this.service.dashboard(user);
  }

  @Get('sessions')
  @RequireAnyPermissions(Permission.MILL_ASSIST_START, Permission.MILL_ASSIST_VIEW_ALL)
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: MillAssistanceStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.list(user, status && status in MillAssistanceStatus ? status : undefined, { from, to });
  }

  @Get('sessions/:id')
  @RequireAnyPermissions(Permission.MILL_ASSIST_START, Permission.MILL_ASSIST_VIEW_ALL)
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.service.detail(id, user);
  }

  @Get('sessions/:id/receipt')
  @RequireAnyPermissions(Permission.MILL_ASSIST_PRINT, Permission.MILL_ASSIST_VIEW_ALL)
  @ApiOperation({ summary: 'بيانات وصل تسليم المداخيل' })
  receipt(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.service.receipt(id, user);
  }

  @Post('sessions/:id/close')
  @RequirePermissions(Permission.MILL_ASSIST_CLOSE)
  @ApiOperation({ summary: 'إغلاق الجلسة والتصريح بالمبلغ المسلَّم' })
  close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseAssistanceDto, @CurrentUser() user: JwtPayload) {
    return this.service.close(id, dto, user);
  }

  @Post('sessions/:id/confirm')
  @RequirePermissions(Permission.MILL_ASSIST_CONFIRM)
  @ApiOperation({ summary: 'تأكيد استلام المداخيل (المشغّل الرئيسي)' })
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmHandoverDto, @CurrentUser() user: JwtPayload) {
    return this.service.confirm(id, dto, user);
  }

  @Post('sessions/:id/resolve')
  @RequirePermissions(Permission.MILL_ASSIST_RESOLVE)
  @ApiOperation({ summary: 'تسوية فرق التسليم' })
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDiscrepancyDto, @CurrentUser() user: JwtPayload) {
    return this.service.resolve(id, dto, user);
  }
}
