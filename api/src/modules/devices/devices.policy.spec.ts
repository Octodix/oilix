import {
  DEVICE_DISABLED_MESSAGE,
  DEVICE_PENDING_MESSAGE,
  DEVICE_REQUIRED_MESSAGE,
  deviceWriteBlockReason,
  workspaceMatches,
} from './device-context';
import type { Device } from '@prisma/client';

function device(partial: Partial<Device>): Device {
  return {
    id: 'd1',
    installationId: 'inst',
    code: 'VENTE-01',
    name: 'Caisse 1',
    workspace: 'SALES',
    status: 'ACTIVE',
    location: null,
    notes: null,
    lastSeenAt: null,
    approvedAt: null,
    approvedById: null,
    cashRegisterId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as Device;
}

describe('device write policy', () => {
  it('allows GET without a device', () => {
    expect(
      deviceWriteBlockReason(null, {
        method: 'GET',
        url: '/api/v1/oil-sales/dashboard',
        workspace: 'sales',
      }),
    ).toBeNull();
  });

  it('blocks sales writes without a device', () => {
    expect(
      deviceWriteBlockReason(null, {
        method: 'POST',
        url: '/api/v1/oil-sales/sales',
        workspace: 'sales',
      }),
    ).toBe(DEVICE_REQUIRED_MESSAGE);
  });

  it('allows mill writes without a device (legacy / mobile)', () => {
    expect(
      deviceWriteBlockReason(null, {
        method: 'POST',
        url: '/api/v1/olive-entries',
        workspace: 'mill',
      }),
    ).toBeNull();
  });

  it('blocks disabled devices with a clear message', () => {
    expect(
      deviceWriteBlockReason(device({ status: 'DISABLED' }), {
        method: 'POST',
        url: '/api/v1/oil-sales/sales',
        workspace: 'sales',
      }),
    ).toBe(DEVICE_DISABLED_MESSAGE);
  });

  it('blocks pending devices from sales', () => {
    expect(
      deviceWriteBlockReason(device({ status: 'PENDING' }), {
        method: 'POST',
        url: '/api/v1/oil-sales/sales',
        workspace: 'sales',
      }),
    ).toBe(DEVICE_PENDING_MESSAGE);
  });

  it('does not block sales writes when device workspace is MILL (user permissions decide workspace)', () => {
    expect(
      deviceWriteBlockReason(device({ workspace: 'MILL', status: 'ACTIVE' }), {
        method: 'POST',
        url: '/api/v1/oil-sales/sales',
        workspace: 'sales',
      }),
    ).toBeNull();
  });

  it('allows mill-only device on mill writes', () => {
    expect(workspaceMatches('MILL', 'mill')).toBe(true);
    expect(workspaceMatches('SALES', 'mill')).toBe(false);
    expect(workspaceMatches('BOTH', 'sales')).toBe(true);
    expect(workspaceMatches('SALES', 'hr')).toBe(true);
  });
});
