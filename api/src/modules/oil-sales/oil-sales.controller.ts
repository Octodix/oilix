import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OilSource, OilType, Permission } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  AddStockDto,
  AddContainerStockDto,
  CancelOilSaleDto,
  ContainerInventoryCountDto,
  ContainerLossDto,
  ContainerMovementQueryDto,
  ContainerStockAdjustmentDto,
  CreateOilContainerDto,
  CreateOilCustomerDto,
  CreateOilSaleDto,
  DebtorsQueryDto,
  InventoryCountDto,
  OilCustomerQueryDto,
  OilMovementQueryDto,
  OilReportQueryDto,
  OilSaleQueryDto,
  PreviewSaleDto,
  RecordDebtPaymentDto,
  RecordOilDayReportPrintDto,
  SaveOilSaleHoldDto,
  StockAdjustmentDto,
  UpdateOilContainerDto,
  UpdateOilCustomerDto,
  UpdateOilSalesSettingsDto,
  ConfirmDailyClosingDto,
  DailyStockQueryDto,
  ReopenDailyClosingDto,
} from './dto/oil-sales.dto';
import { OilSalesService } from './oil-sales.service';
import { CashRegisterService } from './cash-register.service';
import { OilSalesDebtService } from './oil-sales-debt.service';
import { OilDailyStockService } from './oil-daily-stock.service';
import {
  CashAdjustDto,
  CashSessionQueryDto,
  CloseCashSessionDto,
  CreateCashRegisterDto,
  OilDashboardQueryDto,
  OpenCashSessionDto,
  UpdateCashRegisterDto,
} from '../devices/dto/devices.dto';

@ApiTags('بيع الزيت')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('oil-sales')
export class OilSalesController {
  constructor(
    private oilSales: OilSalesService,
    private cash: CashRegisterService,
    private debts: OilSalesDebtService,
    private dailyStockService: OilDailyStockService,
  ) {}

  @Get('dashboard')
  @RequirePermissions(Permission.OIL_SALES_DASHBOARD_VIEW)
  @ApiOperation({ summary: 'لوحة تحكم بيع الزيت' })
  dashboard(@Query() query: OilDashboardQueryDto, @CurrentUser() user: JwtPayload) {
    return this.oilSales.dashboard(query, user);
  }

  @Get('cash/registers')
  @RequirePermissions(Permission.OIL_SALES_CASH_REGISTER_VIEW_OWN)
  listRegisters(@Query('all') all?: string) {
    return this.cash.listRegisters(all === '1' || all === 'true');
  }

  @Post('cash/registers')
  @RequirePermissions(Permission.OIL_SALES_DEVICES_MANAGE)
  @ApiOperation({ summary: 'إنشاء صندوق نقدي' })
  createRegister(@Body() dto: CreateCashRegisterDto, @CurrentUser() user: JwtPayload) {
    return this.cash.createRegister(dto, user.sub);
  }

  @Patch('cash/registers/:id')
  @RequirePermissions(Permission.OIL_SALES_DEVICES_MANAGE)
  @ApiOperation({ summary: 'تعديل صندوق نقدي' })
  updateRegister(
    @Param('id') id: string,
    @Body() dto: UpdateCashRegisterDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.cash.updateRegister(id, dto, user.sub);
  }

  @Get('cash/current')
  @RequirePermissions(Permission.OIL_SALES_CASH_REGISTER_VIEW_OWN)
  currentCash(@CurrentUser() user: JwtPayload) {
    return this.cash.current(user);
  }

  @Post('cash/open')
  @RequirePermissions(Permission.OIL_SALES_CASH_REGISTER_OPEN)
  openCash(@Body() dto: OpenCashSessionDto, @CurrentUser() user: JwtPayload) {
    return this.cash.open(dto, user);
  }

  @Post('cash/close')
  @RequirePermissions(Permission.OIL_SALES_CASH_REGISTER_CLOSE)
  closeCash(@Body() dto: CloseCashSessionDto, @CurrentUser() user: JwtPayload) {
    return this.cash.close(dto, user);
  }

  @Post('cash/adjust')
  @RequirePermissions(Permission.OIL_SALES_CASH_REGISTER_ADJUST)
  adjustCash(@Body() dto: CashAdjustDto, @CurrentUser() user: JwtPayload) {
    return this.cash.adjust(dto, user);
  }

  @Get('cash/sessions')
  @RequirePermissions(Permission.OIL_SALES_CASH_REGISTER_VIEW_OWN)
  cashSessions(@Query() query: CashSessionQueryDto, @CurrentUser() user: JwtPayload) {
    return this.cash.listSessions(query, user);
  }

  @Get('cash/sessions/:id')
  @RequirePermissions(Permission.OIL_SALES_CASH_REGISTER_VIEW_OWN)
  cashSession(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.cash.findSession(id, user);
  }

  @Get('stock')
  @RequirePermissions(Permission.OIL_SALES_STOCK_VIEW)
  stock(@Query('oilSource') oilSource?: OilSource) {
    return this.oilSales.stockOverview(oilSource);
  }

  @Post('stock/add')
  @RequirePermissions(Permission.OIL_SALES_STOCK_ADD)
  addStock(@Body() dto: AddStockDto, @CurrentUser() user: JwtPayload) {
    return this.oilSales.addStock(dto, user.sub);
  }

  @Post('stock/adjust')
  @RequirePermissions(Permission.OIL_SALES_STOCK_ADJUST)
  adjust(@Body() dto: StockAdjustmentDto, @CurrentUser() user: JwtPayload) {
    return this.oilSales.adjustStock(dto, user.sub);
  }

  @Get('movements')
  @RequirePermissions(Permission.OIL_SALES_STOCK_VIEW)
  movements(@Query() query: OilMovementQueryDto) {
    return this.oilSales.listMovements(query);
  }

  @Post('inventory')
  @RequirePermissions(Permission.OIL_SALES_INVENTORY_CREATE)
  inventory(@Body() dto: InventoryCountDto, @CurrentUser() user: JwtPayload) {
    return this.oilSales.inventoryCount(dto, user.sub);
  }

  @Get('inventory')
  @RequirePermissions(Permission.OIL_SALES_INVENTORY_VIEW)
  inventoryList(
    @Query('oilSource') oilSource?: OilSource,
    @Query('oilType') oilType?: OilType,
  ) {
    return this.oilSales.listInventoryCounts(oilSource, oilType);
  }

  @Get('containers')
  @RequirePermissions(Permission.OIL_SALES_CONTAINERS_VIEW)
  containers(@Query('all') all?: string) {
    return this.oilSales.listContainers(all === '1' || all === 'true');
  }

  @Post('containers')
  @RequirePermissions(Permission.OIL_SALES_CONTAINERS_CREATE)
  createContainer(@Body() dto: CreateOilContainerDto, @CurrentUser() user: JwtPayload) {
    return this.oilSales.createContainer(dto, user.sub);
  }

  @Patch('containers/:id')
  @RequirePermissions(Permission.OIL_SALES_CONTAINERS_EDIT)
  updateContainer(
    @Param('id') id: string,
    @Body() dto: UpdateOilContainerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.oilSales.updateContainer(id, dto, user.sub);
  }

  @Delete('containers/:id')
  @RequirePermissions(Permission.OIL_SALES_CONTAINERS_DELETE)
  deleteContainer(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.oilSales.deleteContainer(id, user.sub);
  }

  @Get('container-stock')
  @RequirePermissions(Permission.OIL_SALES_CONTAINER_STOCK_VIEW)
  containerStock() {
    return this.oilSales.containerStockOverview();
  }

  @Post('container-stock/add')
  @RequirePermissions(Permission.OIL_SALES_CONTAINER_STOCK_ADD)
  addContainerStock(@Body() dto: AddContainerStockDto, @CurrentUser() user: JwtPayload) {
    return this.oilSales.addContainerStock(dto, user.sub);
  }

  @Post('container-stock/adjust')
  @RequirePermissions(Permission.OIL_SALES_CONTAINER_STOCK_ADJUST)
  adjustContainerStock(
    @Body() dto: ContainerStockAdjustmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.oilSales.adjustContainerStock(dto, user.sub);
  }

  @Post('container-stock/loss')
  @RequirePermissions(Permission.OIL_SALES_CONTAINER_STOCK_LOSS)
  containerLoss(@Body() dto: ContainerLossDto, @CurrentUser() user: JwtPayload) {
    return this.oilSales.recordContainerLoss(dto, user.sub);
  }

  @Get('container-stock/movements')
  @RequirePermissions(Permission.OIL_SALES_CONTAINER_STOCK_VIEW)
  containerMovements(@Query() query: ContainerMovementQueryDto) {
    return this.oilSales.listContainerMovements(query);
  }

  @Post('container-stock/inventory')
  @RequirePermissions(Permission.OIL_SALES_CONTAINER_STOCK_INVENTORY)
  containerInventory(
    @Body() dto: ContainerInventoryCountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.oilSales.containerInventoryCount(dto, user.sub);
  }

  @Get('container-stock/inventory')
  @RequirePermissions(Permission.OIL_SALES_CONTAINER_STOCK_INVENTORY)
  containerInventoryList(@Query('containerId') containerId?: string) {
    return this.oilSales.listContainerInventoryCounts(containerId);
  }

  @Get('customers')
  @RequirePermissions(Permission.OIL_SALES_CUSTOMERS_VIEW)
  customers(@Query() query: OilCustomerQueryDto) {
    return this.oilSales.listCustomers(query);
  }

  @Post('customers')
  @RequirePermissions(Permission.OIL_SALES_CUSTOMERS_CREATE)
  createCustomer(@Body() dto: CreateOilCustomerDto, @CurrentUser() user: JwtPayload) {
    return this.oilSales.createCustomer(dto, user.sub);
  }

  @Get('customers/:id')
  @RequirePermissions(Permission.OIL_SALES_CUSTOMERS_VIEW)
  customerDetail(@Param('id') id: string) {
    return this.oilSales.customerDetail(id);
  }

  @Patch('customers/:id')
  @RequirePermissions(Permission.OIL_SALES_CUSTOMERS_EDIT)
  updateCustomer(
    @Param('id') id: string,
    @Body() dto: UpdateOilCustomerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.oilSales.updateCustomer(id, dto, user.sub);
  }

  @Delete('customers/:id')
  @RequirePermissions(Permission.OIL_SALES_CUSTOMERS_DELETE)
  deleteCustomer(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.oilSales.deleteCustomer(id, user.sub);
  }

  @Post('preview')
  @RequirePermissions(Permission.OIL_SALES_SALES_VIEW)
  preview(@Body() dto: PreviewSaleDto) {
    return this.oilSales.previewSale(dto);
  }

  @Get('next-receipt')
  @RequirePermissions(Permission.OIL_SALES_SALES_VIEW)
  nextReceipt() {
    return this.oilSales.nextReceiptNumber();
  }

  @Get('sales')
  @RequirePermissions(Permission.OIL_SALES_SALES_VIEW)
  sales(@Query() query: OilSaleQueryDto, @CurrentUser() user: JwtPayload) {
    return this.oilSales.listSales(query, user);
  }

  @Post('sales')
  @RequirePermissions(Permission.OIL_SALES_SALES_CREATE)
  createSale(@Body() dto: CreateOilSaleDto, @CurrentUser() user: JwtPayload) {
    return this.oilSales.createSale(
      dto,
      user.sub,
      user.permissions ?? [],
      user.role === 'ADMIN',
      user.role,
    );
  }

  @Get('sale-prices')
  @RequireAnyPermissions(Permission.OIL_SALES_SALES_CREATE, Permission.OIL_SALES_CONTAINERS_SELL)
  @ApiOperation({ summary: 'أسعار البيع المعتمدة (قراءة فقط لشاشة البيع)' })
  async salePrices() {
    const s = await this.oilSales.getSettings();
    return {
      priceGreen: s.priceGreen,
      priceTaieb: s.priceTaieb,
      priceDrou: s.priceDrou,
      priceZebbouche: s.priceZebbouche,
    };
  }

  @Get('holds')
  @RequireAnyPermissions(Permission.OIL_SALES_SALES_CREATE, Permission.OIL_SALES_CONTAINERS_SELL)
  @ApiOperation({ summary: 'قائمة البيوع المعلّقة (قائمة الانتظار)' })
  holds(@CurrentUser() user: JwtPayload) {
    return this.oilSales.listHolds(user);
  }

  @Post('holds')
  @RequireAnyPermissions(Permission.OIL_SALES_SALES_CREATE, Permission.OIL_SALES_CONTAINERS_SELL)
  @ApiOperation({ summary: 'تعليق بيع — بدون أي أثر على المخزون أو الصندوق' })
  createHold(@Body() dto: SaveOilSaleHoldDto, @CurrentUser() user: JwtPayload) {
    return this.oilSales.saveHold(dto, user);
  }

  @Put('holds/:id')
  @RequireAnyPermissions(Permission.OIL_SALES_SALES_CREATE, Permission.OIL_SALES_CONTAINERS_SELL)
  updateHold(
    @Param('id') id: string,
    @Body() dto: SaveOilSaleHoldDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.oilSales.saveHold(dto, user, id);
  }

  @Delete('holds/:id')
  @RequireAnyPermissions(Permission.OIL_SALES_SALES_CREATE, Permission.OIL_SALES_CONTAINERS_SELL)
  deleteHold(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.oilSales.deleteHold(id, user);
  }

  @Get('sales/:id')
  @RequirePermissions(Permission.OIL_SALES_SALES_VIEW)
  sale(@Param('id') id: string) {
    return this.oilSales.findSale(id);
  }

  @Post('sales/:id/cancel')
  @RequirePermissions(Permission.OIL_SALES_SALES_CANCEL)
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelOilSaleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.oilSales.cancelSale(id, dto, user.sub);
  }

  @Get('sales/:id/receipt')
  @RequirePermissions(Permission.OIL_SALES_PRINT_RECEIPT)
  receipt(@Param('id') id: string) {
    return this.oilSales.receiptPayload(id);
  }

  @Get('debts/summary')
  @RequirePermissions(Permission.OIL_SALES_DEBTS_VIEW)
  debtsSummary() {
    return this.debts.debtorsSummary();
  }

  @Get('debts')
  @RequirePermissions(Permission.OIL_SALES_DEBTS_VIEW)
  debtsList(@Query() query: DebtorsQueryDto) {
    return this.debts.listDebtors(query);
  }

  @Get('debts/customers/:id')
  @RequirePermissions(Permission.OIL_SALES_DEBTS_VIEW)
  debtCustomer(@Param('id') id: string) {
    return this.debts.customerDebtDetail(id);
  }

  @Post('debts/payments')
  @RequirePermissions(Permission.OIL_SALES_DEBTS_RECORD_PAYMENT)
  recordDebtPayment(@Body() dto: RecordDebtPaymentDto, @CurrentUser() user: JwtPayload) {
    return this.debts.recordPayment(dto, user.sub, user.permissions ?? [], user.role);
  }

  @Get('debts/payments/:id/receipt')
  @RequirePermissions(Permission.OIL_SALES_DEBTS_VIEW)
  debtPaymentReceipt(@Param('id') id: string) {
    return this.debts.paymentReceiptPayload(id);
  }

  @Post('sales/:id/pay')
  @RequirePermissions(Permission.OIL_SALES_DEBTS_RECORD_PAYMENT)
  async paySale(
    @Param('id') id: string,
    @Body() body: { amount: number; notes?: string; reference?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const sale = await this.oilSales.findSale(id);
    if (!sale.customerId) {
      throw new BadRequestException('بيع زبون عابر — لا يوجد دين لتسديده');
    }
    return this.debts.recordPayment(
      {
        customerId: sale.customerId,
        saleId: id,
        amount: body.amount,
        notes: body.notes,
        reference: body.reference,
      },
      user.sub,
      user.permissions ?? [],
      user.role,
    );
  }

  @Get('reports')
  @RequirePermissions(Permission.OIL_SALES_REPORTS_VIEW)
  reports(@Query() query: OilReportQueryDto) {
    return this.oilSales.salesReport(query);
  }

  @Post('reports/day-print')
  @RequirePermissions(Permission.OIL_SALES_REPORTS_VIEW)
  @ApiOperation({ summary: 'تسجيل توليد يومية صندوق + بيانات الطباعة' })
  recordDayPrint(
    @Body() dto: RecordOilDayReportPrintDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.oilSales.recordDayReportPrint(dto, user.sub);
  }

  // ─── Daily stock closing (الجرد اليومي للزيت) ───────────────────────

  @Get('daily-stock')
  @RequireAnyPermissions(Permission.OIL_SALES_INVENTORY_VIEW, Permission.OIL_SALES_REPORTS_VIEW)
  @ApiOperation({ summary: 'الجرد اليومي: افتتاح، إضافات، مبيعات، متوقع، فعلي، فرق (يوم أو فترة)' })
  dailyStock(@Query() q: DailyStockQueryDto) {
    if (q.from && q.to) return this.dailyStockService.range(q.from, q.to);
    return this.dailyStockService.day(q.date ?? q.to ?? q.from ?? new Date().toISOString().slice(0, 10));
  }

  @Post('daily-stock/close')
  @RequirePermissions(Permission.OIL_SALES_INVENTORY_CREATE)
  @ApiOperation({ summary: 'تأكيد الجرد اليومي وترحيل الرصيد لليوم الموالي' })
  closeDay(@Body() dto: ConfirmDailyClosingDto, @CurrentUser() user: JwtPayload) {
    return this.dailyStockService.confirm(dto, user);
  }

  @Post('daily-stock/reopen')
  @RequirePermissions(Permission.OIL_SALES_INVENTORY_REOPEN)
  @ApiOperation({ summary: 'إعادة فتح جرد يومي مؤكد (يُلغى تعديله ويُحفظ في السجل)' })
  reopenDay(@Body() dto: ReopenDailyClosingDto, @CurrentUser() user: JwtPayload) {
    return this.dailyStockService.reopen(dto, user);
  }

  @Get('settings')
  @RequirePermissions(Permission.OIL_SALES_SETTINGS_VIEW)
  settings() {
    return this.oilSales.getSettings();
  }

  @Patch('settings')
  @RequirePermissions(Permission.OIL_SALES_SETTINGS_EDIT)
  updateSettings(
    @Body() dto: UpdateOilSalesSettingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.oilSales.updateSettings(dto, user.sub);
  }
}
