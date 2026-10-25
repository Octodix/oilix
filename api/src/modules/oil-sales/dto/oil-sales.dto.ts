import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OilSaleStatus, OilSource, OilStockMovementType, OilType } from '@prisma/client';

export class CreateOilCustomerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  wilaya?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  commune?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateOilCustomerDto extends CreateOilCustomerDto {}

export class OilCustomerQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}

export class AddStockDto {
  @IsEnum(OilSource)
  oilSource!: OilSource;

  @IsEnum(OilType)
  oilType!: OilType;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  quantityL!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class InventoryCountDto {
  @IsEnum(OilSource)
  oilSource!: OilSource;

  @IsEnum(OilType)
  oilType!: OilType;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  physicalQty!: number;

  /** Theoretical stock shown on the form — reject if stock changed concurrently. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  expectedTheoreticalQty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class StockAdjustmentDto {
  @IsEnum(OilSource)
  oilSource!: OilSource;

  @IsEnum(OilType)
  oilType!: OilType;

  /** Signed delta applied to theoretical stock (positive = add, negative = remove). */
  @Type(() => Number)
  @IsNumber()
  quantityL!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class CreateOilSaleItemDto {
  @IsEnum(['CONTAINER', 'LOOSE', 'CONTAINER_ONLY'] as const)
  kind!: 'CONTAINER' | 'LOOSE' | 'CONTAINER_ONLY';

  @IsOptional()
  @IsEnum(OilSource)
  oilSource?: OilSource;

  @IsOptional()
  @IsEnum(OilType)
  oilType?: OilType;

  @IsOptional()
  @IsUUID()
  containerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  containerCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  quantityL?: number;

  /**
   * Price shown to the cashier. Never used for the sale: the server prices from
   * configuration and rejects the request if this differs (409 PRICE_CHANGED).
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  /** Ignored for oil lines — oil is always priced per litre from configuration. */
  @IsOptional()
  @IsEnum(['PER_LITRE', 'FIXED_CONTAINER'] as const)
  pricingMode?: 'PER_LITRE' | 'FIXED_CONTAINER';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  containerPrice?: number;

  /** Assistance of THIS line, DZD per litre of this line's oil (needs OIL_SALES_ASSISTANCE_PER_LITRE). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  assistancePerLitre?: number;

  /** Fixed assistance of THIS line in DZD (needs OIL_SALES_ASSISTANCE_FIXED). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  assistanceFixed?: number;
}

export class CreateOilSaleDto {
  /** Omit for a walk-in counter sale (زبون عابر) — debt then is refused. */
  @IsOptional()
  @IsUUID()
  customerId?: string;

  /** Held sale being finalized — its server-captured prices apply; deleted atomically. */
  @IsOptional()
  @IsUUID()
  holdId?: string;

  @IsOptional()
  @IsEnum(OilSource)
  oilSource?: OilSource;

  @IsOptional()
  @IsEnum(OilType)
  oilType?: OilType;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOilSaleItemDto)
  items?: CreateOilSaleItemDto[];

  @ValidateIf((o: CreateOilSaleDto) => !o.items?.length)
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  quantityL?: number;

  /** Compare-only, same rule as item unitPrice. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  assistanceFixed?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  assistancePercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  assistancePerLitre?: number;

  /** Cash paid now (defaults to full net if omitted). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountPaid?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  overrideStock?: boolean;

  @IsOptional()
  @IsBoolean()
  overrideContainerStock?: boolean;
}

export class SaveOilSaleHoldDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateOilSaleItemDto)
  items!: CreateOilSaleItemDto[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  assistanceFixed?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  assistancePerLitre?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateOilContainerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  capacityL!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minStock?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateOilContainerDto extends CreateOilContainerDto {}

export class AddContainerStockDto {
  @IsUUID()
  containerId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ContainerInventoryCountDto {
  @IsUUID()
  containerId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  physicalQty!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  expectedTheoreticalQty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ContainerStockAdjustmentDto {
  @IsUUID()
  containerId!: string;

  /** Signed delta in pieces (positive = add, negative = remove). */
  @Type(() => Number)
  @IsNumber()
  quantity!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class ContainerLossDto {
  @IsUUID()
  containerId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsEnum(['DAMAGE', 'LOSS'] as const)
  type!: 'DAMAGE' | 'LOSS';

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class ContainerMovementQueryDto {
  @IsOptional()
  @IsUUID()
  containerId?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}

export class CancelOilSaleDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class OilSaleQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(OilSource)
  oilSource?: OilSource;

  @IsOptional()
  @IsEnum(OilType)
  oilType?: OilType;

  @IsOptional()
  @IsEnum(OilSaleStatus)
  status?: OilSaleStatus;

  @IsOptional()
  @IsString()
  paymentStatus?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsUUID()
  cashRegisterId?: string;

  @IsOptional()
  @IsUUID()
  cashSessionId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  receiptNumber?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}

export class OilMovementQueryDto {
  @IsOptional()
  @IsEnum(OilSource)
  oilSource?: OilSource;

  @IsOptional()
  @IsEnum(OilType)
  oilType?: OilType;

  @IsOptional()
  @IsEnum(OilStockMovementType)
  type?: OilStockMovementType;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}

export class OilReportQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(OilSource)
  oilSource?: OilSource;

  @IsOptional()
  @IsEnum(OilType)
  oilType?: OilType;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsUUID()
  cashRegisterId?: string;
}

export class RecordOilDayReportPrintDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsUUID()
  cashRegisterId!: string;
}

export class UpdateOilSalesSettingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceGreen?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceTaieb?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceDrou?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceZebbouche?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  receiptHeader?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  receiptFooter?: string;

  /** Business day start hour, Algeria time (0–23). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  dayStartHour?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  closingReasonLitres?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  closingReasonPercent?: number;
}

export class DailyStockQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}

export class DailyClosingItemDto {
  @IsEnum(OilSource)
  oilSource!: OilSource;

  @IsEnum(OilType)
  oilType!: OilType;

  /** Physical quantity counted at closing (litres). */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  actualQty!: number;

  /** Expected quantity shown on screen — rejected (409) if movements changed meanwhile. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  expectedQty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class ConfirmDailyClosingDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => DailyClosingItemDto)
  items!: DailyClosingItemDto[];
}

export class ReopenDailyClosingDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsEnum(OilSource)
  oilSource!: OilSource;

  @IsEnum(OilType)
  oilType!: OilType;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class RecordDebtPaymentDto {
  @IsUUID()
  customerId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsUUID()
  saleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class DebtorsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  sort?: string;
}

export class PreviewSaleDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOilSaleItemDto)
  items?: CreateOilSaleItemDto[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  quantityL?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  assistanceFixed?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  assistancePercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  assistancePerLitre?: number;
}
