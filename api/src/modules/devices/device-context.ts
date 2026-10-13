import { AsyncLocalStorage } from 'async_hooks';
import type { Device, DeviceStatus, DeviceWorkspace } from '@prisma/client';

export type WorkspaceHint = 'mill' | 'sales' | 'hr';

export type DeviceContext = {
  device: Device | null;
  workspace: WorkspaceHint | null;
};

export const deviceAls = new AsyncLocalStorage<DeviceContext>();

export function currentDevice(): Device | null {
  return deviceAls.getStore()?.device ?? null;
}

export function currentDeviceId(): string | null {
  return currentDevice()?.id ?? null;
}

export function currentWorkspaceHint(): WorkspaceHint | null {
  return deviceAls.getStore()?.workspace ?? null;
}

export const DEVICE_INSTALLATION_HEADER = 'x-device-installation-id';
export const DEVICE_NAME_HEADER = 'x-device-name';
export const DEVICE_WORKSPACE_HEADER = 'x-oilix-workspace';

export const DEVICE_DISABLED_MESSAGE =
  'هذا الجهاز غير مصرّح له بتنفيذ العمليات.';
export const DEVICE_PENDING_MESSAGE =
  'هذا الجهاز بانتظار موافقة المدير قبل تنفيذ العمليات.';
export const DEVICE_REQUIRED_MESSAGE =
  'يجب تسجيل هذا الجهاز قبل تنفيذ العمليات.';
export const DEVICE_WORKSPACE_MESSAGE =
  'هذا الجهاز غير مسموح له بالعمل في هذه المساحة.';

export function workspaceMatches(
  deviceWorkspace: DeviceWorkspace,
  requested: WorkspaceHint | null,
): boolean {
  if (!requested || requested === 'hr') return true;
  if (deviceWorkspace === 'BOTH') return true;
  if (requested === 'sales') return deviceWorkspace === 'SALES';
  return deviceWorkspace === 'MILL';
}

export function isWriteMethod(method: string) {
  return ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method.toUpperCase());
}

export function attributedDeviceId(): string | null {
  return currentDeviceId();
}

function pathOf(url: string) {
  return url.split('?')[0].toLowerCase();
}

export function isOilSalesWritePath(url: string, method: string) {
  if (!isWriteMethod(method)) return false;
  const path = pathOf(url);
  if (path.includes('/oil-sales/preview') || path.includes('/oil-sales/next-receipt')) {
    return false;
  }
  return path.includes('/oil-sales/');
}

export function isSensitiveWritePath(url: string, method: string) {
  if (!isWriteMethod(method)) return false;
  const path = pathOf(url);
  if (path.includes('/devices/me')) return false;
  if (path.includes('/auth/')) return false;
  if (path.includes('/oil-sales/preview') || path.includes('/oil-sales/next-receipt')) {
    return false;
  }
  if (path.includes('/oil-sales/')) return true;
  if (
    path.includes('/clients') ||
    path.includes('/olive-entries') ||
    path.includes('/pressing') ||
    path.includes('/payments') ||
    path.includes('/filtration') ||
    path.includes('/mobile') ||
    path.includes('/api/v1/hr/')
  ) {
    return true;
  }
  return false;
}

export function deviceWriteBlockReason(
  device: Device | null,
  opts: { method: string; url: string; workspace: WorkspaceHint | null },
): string | null {
  if (!isSensitiveWritePath(opts.url, opts.method)) return null;
  const salesWrite = isOilSalesWritePath(opts.url, opts.method);
  if (!device) {
    // Oil Sales terminals must be registered. Mill/mobile legacy rows stay nullable.
    // Workspace access is enforced by user permissions — not device.workspace.
    return salesWrite ? DEVICE_REQUIRED_MESSAGE : null;
  }
  if (device.status === ('DISABLED' as DeviceStatus)) return DEVICE_DISABLED_MESSAGE;
  if (device.status === ('PENDING' as DeviceStatus)) return DEVICE_PENDING_MESSAGE;
  // Device registration = FROM which device. User permissions = WHAT they can access.
  void opts.workspace;
  return null;
}
