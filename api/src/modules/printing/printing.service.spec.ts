/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await -- untyped in-memory Prisma fake */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Device } from '@prisma/client';
import { deviceAls } from '../devices/device-context';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  LogPrintJobDto,
  UpdateDevicePrintSettingsDto,
} from './dto/printing.dto';
import { DEFAULT_PRINT_SETTINGS } from './printing.constants';
import { PrintingService } from './printing.service';

type Row = Record<string, any>;

function makeDevice(
  id: string,
  code: string,
  cashRegisterId: string | null,
): Device {
  return {
    id,
    installationId: `inst-${id}`,
    code,
    name: `Caisse ${code}`,
    workspace: 'SALES',
    status: 'ACTIVE',
    location: null,
    notes: null,
    lastSeenAt: null,
    approvedAt: null,
    approvedById: null,
    cashRegisterId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const deviceA = makeDevice('dev-a', 'POS-HUILE-01', 'reg-1');
const deviceB = makeDevice('dev-b', 'POS-HUILE-02', 'reg-2');

function makeFakePrisma() {
  const devices = new Map<string, Device>([
    [deviceA.id, deviceA],
    [deviceB.id, deviceB],
  ]);
  const registers = new Map<string, Row>([
    ['reg-1', { id: 'reg-1', code: 'C1', name: 'Caisse 1' }],
    ['reg-2', { id: 'reg-2', code: 'C2', name: 'Caisse 2' }],
  ]);
  const settings = new Map<string, Row>();
  const jobs = new Map<string, Row>();
  const forbidden = () => {
    throw new Error('printing must never touch sales, cash or stock');
  };

  const prisma = {
    device: {
      findUnique: async ({ where }: Row) => {
        const d = devices.get(where.id);
        if (!d) return null;
        const reg = d.cashRegisterId ? registers.get(d.cashRegisterId) : null;
        return {
          id: d.id,
          code: d.code,
          name: d.name,
          status: d.status,
          cashRegister: reg ?? null,
          printSettings: settings.get(d.id) ?? null,
        };
      },
    },
    cashRegister: {
      findUnique: async ({ where }: Row) => registers.get(where.id) ?? null,
    },
    devicePrintSettings: {
      upsert: async ({ where, create, update }: Row) => {
        const prev = settings.get(where.deviceId);
        const base = prev ?? {
          id: `s-${where.deviceId}`,
          ...DEFAULT_PRINT_SETTINGS,
          ...create,
          createdAt: new Date(),
        };
        const next = {
          ...base,
          ...(prev ? update : {}),
          updatedAt: new Date(),
        };
        settings.set(where.deviceId, next);
        return next;
      },
    },
    printJobLog: {
      upsert: async ({ where, create, update }: Row) => {
        const prev = jobs.get(where.jobId);
        const next = prev
          ? { ...prev, ...update }
          : { id: `j-${jobs.size + 1}`, ...create };
        jobs.set(where.jobId, next);
        return next;
      },
      findMany: async () => [...jobs.values()],
    },
    oilSale: { create: forbidden, update: forbidden, delete: forbidden },
    cashRegisterSession: { update: forbidden },
    oilStockMovement: { create: forbidden },
    $transaction: forbidden,
  };
  return { prisma, settings, jobs };
}

const cashier: JwtPayload = {
  sub: 'user-1',
  username: 'amine',
  role: 'CASHIER',
  permissions: [],
};

function withDevice<T>(device: Device | null, fn: () => Promise<T>) {
  return deviceAls.run({ device, workspace: 'sales' }, fn);
}

function setup() {
  const fake = makeFakePrisma();
  const audit = { log: jest.fn(async () => undefined) };
  const service = new PrintingService(fake.prisma as any, audit as any);
  return { ...fake, audit, service };
}

describe('device printer configuration', () => {
  it('device A and device B keep different printer settings', async () => {
    const { service, audit } = setup();
    await service.updateForDevice(
      deviceA.id,
      {
        directPrinting: true,
        receiptPrinter: 'XPrinter XP-Q200',
        receiptPaperWidth: 80,
        documentPrinter: 'HP LaserJet Pro M404',
        documentPaperFormat: 'A4',
        autoPrintAfterSale: true,
      },
      'admin-1',
    );
    await service.updateForDevice(
      deviceB.id,
      {
        directPrinting: true,
        receiptPrinter: 'Epson TM-T20',
        receiptPaperWidth: 58,
      },
      'admin-1',
    );

    const a = await service.forDevice(deviceA.id);
    const b = await service.forDevice(deviceB.id);
    expect(a.settings.receiptPrinter).toBe('XPrinter XP-Q200');
    expect(a.settings.documentPrinter).toBe('HP LaserJet Pro M404');
    expect(a.settings.autoPrintAfterSale).toBe(true);
    expect(b.settings.receiptPrinter).toBe('Epson TM-T20');
    expect(b.settings.receiptPaperWidth).toBe(58);
    expect(b.settings.documentPrinter).toBeNull();
    expect(b.settings.autoPrintAfterSale).toBe(false);
    expect(audit.log).toHaveBeenCalledTimes(2);
  });

  it('partial updates keep the other fields and blank printer names clear them', async () => {
    const { service } = setup();
    await service.updateForDevice(
      deviceA.id,
      { receiptPrinter: 'XP-Q200', receiptCopies: 2 },
      'x',
    );
    await service.updateForDevice(deviceA.id, { receiptPrinter: '   ' }, 'x');
    const a = await service.forDevice(deviceA.id);
    expect(a.settings.receiptPrinter).toBeNull();
    expect(a.settings.receiptCopies).toBe(2);
  });

  it('a device without configuration gets safe defaults (browser printing)', async () => {
    const { service } = setup();
    const res = await service.forDevice(deviceB.id);
    expect(res.configured).toBe(false);
    expect(res.settings.directPrinting).toBe(false);
    expect(res.settings.browserFallback).toBe(true);
  });
});

describe('user / device independence', () => {
  it('the same user uses the printer of the device they are logged in from', async () => {
    const { service } = setup();
    await service.updateForDevice(
      deviceA.id,
      { receiptPrinter: 'Printer A' },
      'admin',
    );
    await service.updateForDevice(
      deviceB.id,
      { receiptPrinter: 'Printer B' },
      'admin',
    );

    const onA = await withDevice(deviceA, () => service.forCurrentDevice());
    const onB = await withDevice(deviceB, () => service.forCurrentDevice());
    expect(onA.device?.code).toBe('POS-HUILE-01');
    expect(onA.settings.receiptPrinter).toBe('Printer A');
    expect(onB.device?.code).toBe('POS-HUILE-02');
    expect(onB.settings.receiptPrinter).toBe('Printer B');
  });

  it('an unregistered browser gets no device and default (browser) printing', async () => {
    const { service } = setup();
    const res = await withDevice(null, () => service.forCurrentDevice());
    expect(res.device).toBeNull();
    expect(res.settings.directPrinting).toBe(false);
  });
});

describe('print job audit', () => {
  const jobId = '7d1b6c1e-3a52-4c55-9a3e-4b1f3f9f2a11';

  it('records user, device and cash register of the submitting workstation', async () => {
    const { service, jobs } = setup();
    await withDevice(deviceA, () =>
      service.logJob(
        {
          jobId,
          documentType: 'OIL_SALE_CLIENT_RECEIPT',
          documentRef: 'sale-1',
          channel: 'AGENT',
          status: 'SUBMITTED',
          printerName: 'XPrinter XP-Q200',
          copies: 1,
        },
        cashier,
      ),
    );
    const row = jobs.get(jobId)!;
    expect(row.userId).toBe('user-1');
    expect(row.userName).toBe('amine');
    expect(row.deviceCode).toBe('POS-HUILE-01');
    expect(row.cashRegisterName).toBe('Caisse 1');
    expect(row.status).toBe('SUBMITTED');
    expect(row.isReprint).toBe(false);
  });

  it('a retry of the same job updates one row instead of creating duplicates', async () => {
    const { service, jobs } = setup();
    const base = {
      jobId,
      documentType: 'OIL_SALE_CLIENT_RECEIPT',
      documentRef: 'sale-1',
      channel: 'AGENT',
    };
    await withDevice(deviceA, () =>
      service.logJob(
        { ...base, status: 'FAILED', errorCode: 'AGENT_UNAVAILABLE' },
        cashier,
      ),
    );
    await withDevice(deviceA, () =>
      service.logJob({ ...base, status: 'SUBMITTED' }, cashier),
    );
    expect(jobs.size).toBe(1);
    expect(jobs.get(jobId)!.status).toBe('SUBMITTED');
    expect(jobs.get(jobId)!.errorCode).toBeNull();
  });

  it('reprints are recorded as reprints, not new sales', async () => {
    const { service, jobs } = setup();
    await withDevice(deviceB, () =>
      service.logJob(
        {
          jobId: '0b8f4a52-8d55-4f2c-b2a4-1c1f0f2b9e77',
          documentType: 'OIL_SALE_CLIENT_RECEIPT',
          documentRef: 'sale-1',
          isReprint: true,
          channel: 'AGENT',
          status: 'SUBMITTED',
        },
        cashier,
      ),
    );
    const row = [...jobs.values()][0];
    expect(row.isReprint).toBe(true);
    expect(row.deviceCode).toBe('POS-HUILE-02');
  });

  it('a failed print only writes the print log — the sale is never touched', async () => {
    const { service, jobs } = setup();
    await expect(
      withDevice(deviceA, () =>
        service.logJob(
          {
            jobId,
            documentType: 'OIL_SALE_CLIENT_RECEIPT',
            documentRef: 'sale-1',
            channel: 'AGENT',
            status: 'FAILED',
            errorCode: 'PRINTER_UNAVAILABLE',
            errorMessage: 'Printer offline',
          },
          cashier,
        ),
      ),
    ).resolves.toMatchObject({ status: 'FAILED' });
    expect(jobs.size).toBe(1);
  });
});

describe('print DTO validation', () => {
  async function errorsOf<T extends object>(cls: new () => T, body: object) {
    const errs = await validate(plainToInstance(cls, body));
    return errs.map((e) => e.property);
  }

  it('rejects unsupported paper sizes, formats and copy counts', async () => {
    expect(
      await errorsOf(UpdateDevicePrintSettingsDto, { receiptPaperWidth: 72 }),
    ).toContain('receiptPaperWidth');
    expect(
      await errorsOf(UpdateDevicePrintSettingsDto, {
        documentPaperFormat: 'A3',
      }),
    ).toContain('documentPaperFormat');
    expect(
      await errorsOf(UpdateDevicePrintSettingsDto, { receiptCopies: 50 }),
    ).toContain('receiptCopies');
    expect(
      await errorsOf(UpdateDevicePrintSettingsDto, { receiptPaperWidth: 58 }),
    ).toEqual([]);
  });

  it('rejects printer names with control characters', async () => {
    expect(
      await errorsOf(UpdateDevicePrintSettingsDto, {
        receiptPrinter: 'XP\r\nQ200',
      }),
    ).toContain('receiptPrinter');
    expect(
      await errorsOf(UpdateDevicePrintSettingsDto, { receiptPrinter: null }),
    ).toEqual([]);
  });

  it('rejects unknown document types and channels in job logs', async () => {
    const errs = await errorsOf(LogPrintJobDto, {
      jobId: 'not-a-uuid',
      documentType: 'SHELL',
      channel: 'FTP',
      status: 'DONE',
    });
    expect(errs).toEqual(
      expect.arrayContaining(['jobId', 'documentType', 'channel', 'status']),
    );
  });
});
