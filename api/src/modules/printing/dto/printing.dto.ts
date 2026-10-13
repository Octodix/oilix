import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  DAY_REPORT_TARGETS,
  DOCUMENT_ORIENTATIONS,
  DOCUMENT_PAPER_FORMATS,
  MAX_PRINT_COPIES,
  PRINTER_NAME_RE,
  PRINT_CHANNELS,
  PRINT_DOCUMENT_TYPES,
  PRINT_JOB_STATUSES,
  RECEIPT_PAPER_WIDTHS,
} from '../printing.constants';

export class UpdateDevicePrintSettingsDto {
  @IsOptional()
  @IsBoolean()
  directPrinting?: boolean;

  @IsOptional()
  @IsBoolean()
  browserFallback?: boolean;

  @IsOptional()
  @IsBoolean()
  autoPrintAfterSale?: boolean;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(PRINTER_NAME_RE, { message: 'اسم الطابعة غير صالح' })
  receiptPrinter?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsIn(RECEIPT_PAPER_WIDTHS)
  receiptPaperWidth?: number;

  @IsOptional()
  @IsBoolean()
  receiptDirect?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PRINT_COPIES)
  receiptCopies?: number;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(PRINTER_NAME_RE, { message: 'اسم الطابعة غير صالح' })
  documentPrinter?: string | null;

  @IsOptional()
  @IsIn(DOCUMENT_PAPER_FORMATS)
  documentPaperFormat?: string;

  @IsOptional()
  @IsIn(DOCUMENT_ORIENTATIONS)
  documentOrientation?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PRINT_COPIES)
  documentCopies?: number;

  @IsOptional()
  @IsIn(DAY_REPORT_TARGETS)
  dayReportTarget?: string;
}

export class LogPrintJobDto {
  @IsUUID()
  jobId!: string;

  @IsIn(PRINT_DOCUMENT_TYPES)
  documentType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  documentRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  copyLabel?: string;

  @IsOptional()
  @IsBoolean()
  isReprint?: boolean;

  @IsIn(PRINT_CHANNELS)
  channel!: string;

  @IsIn(PRINT_JOB_STATUSES)
  status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  errorCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  errorMessage?: string;

  @IsOptional()
  @IsString()
  @Matches(PRINTER_NAME_RE)
  printerName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PRINT_COPIES)
  copies?: number;
}

export class PrintJobQueryDto {
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsIn(PRINT_DOCUMENT_TYPES)
  documentType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  documentRef?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
