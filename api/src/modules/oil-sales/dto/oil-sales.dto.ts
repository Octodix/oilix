import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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
