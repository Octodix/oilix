import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class StartAssistanceDto {
  /** The main operator being helped. */
  @IsUUID()
  primaryOperatorId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CloseAssistanceDto {
  /** Physical cash the assistant counted and is handing over. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  declaredHandover!: number;

  /** Required when declared ≠ expected. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  discrepancyNote?: string;
}

export class ConfirmHandoverDto {
  /** Cash the primary operator actually counted on receipt. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  receivedHandover!: number;

  /** Required when received ≠ expected. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ResolveDiscrepancyDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  resolutionNote!: string;
}
