export const PROTECTED_ADMIN_USERNAME = 'admin';

export const AUDIT_MODULES = {
  AUTH: 'auth',
  USERS: 'users',
  CLIENTS: 'clients',
  OLIVE: 'olive',
  PROCESSING: 'processing',
  PRESSING: 'pressing',
  FILTRATION: 'filtration',
  OIL_SALES: 'oil_sales',
  DEVICES: 'devices',
  CASH: 'cash',
  PAYMENTS: 'payments',
  FINANCE: 'finance',
  SETTINGS: 'settings',
  SEASONS: 'seasons',
  REPORTS: 'reports',
  HR: 'hr',
  SYSTEM: 'system',
} as const;

export type AuditModule = (typeof AUDIT_MODULES)[keyof typeof AUDIT_MODULES];

export const AUDIT_ACTIONS = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  PRINT: 'PRINT',
  VALIDATE: 'VALIDATE',
  CANCEL: 'CANCEL',
  COLLECT: 'COLLECT',
  PAY: 'PAY',
  NEW_SEASON: 'NEW_SEASON',
  PURGE: 'PURGE',
  READ: 'READ',
  TRANSFER: 'TRANSFER',
  START: 'START',
  VIEW_ARCHIVE: 'VIEW_ARCHIVE',
  CLOSE_SEASON: 'CLOSE_SEASON',
  RESET_PASSWORD: 'RESET_PASSWORD',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  CORRECT: 'CORRECT',
  ARCHIVE: 'ARCHIVE',
  SYNC: 'SYNC',
  IMPORT: 'IMPORT',
  CALCULATE: 'CALCULATE',
  REOPEN: 'REOPEN',
  CLOSE: 'CLOSE',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
