export const PROTECTED_ADMIN_USERNAME = 'admin';

export const AUDIT_MODULE_LABELS: Record<string, string> = {
  auth: 'المصادقة',
  users: 'المستخدمون',
  clients: 'الزبائن',
  olive: 'استقبال الزيتون',
  processing: 'المعالجة',
  pressing: 'التصفية',
  payments: 'المدفوعات',
  finance: 'المالية',
  settings: 'الإعدادات',
  seasons: 'المواسم',
  reports: 'التذاكر / الطباعة',
  system: 'النظام',
  oil_sales: 'بيع الزيت',
  devices: 'الأجهزة',
  cash: 'الصناديق',
  filtration: 'التصفية',
  hr: 'الموارد البشرية',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: 'إضافة',
  UPDATE: 'تعديل',
  DELETE: 'حذف',
  LOGIN: 'تسجيل دخول',
  LOGOUT: 'تسجيل خروج',
  PRINT: 'طباعة',
  VALIDATE: 'تحقق / تأكيد',
  CANCEL: 'إلغاء',
  COLLECT: 'أخذ الزيت',
  PAY: 'دفع (سلك)',
  NEW_SEASON: 'موسم جديد',
  CLOSE_SEASON: 'إغلاق موسم',
  PURGE: 'تفريغ قاعدة البيانات',
  READ: 'استعراض',
  TRANSFER: 'نقل',
  START: 'بدء',
  VIEW_ARCHIVE: 'أرشيف موسم',
  RESET_PASSWORD: 'إعادة كلمة المرور',
};

export function auditModuleLabel(module: string) {
  return AUDIT_MODULE_LABELS[module] ?? module;
}

export function auditActionLabel(action: string) {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/** عرض مختصر للتغييرات المخزّنة في oldData/newData */
export function formatAuditDiff(
  oldData?: Record<string, unknown> | null,
  newData?: Record<string, unknown> | null,
): string | null {
  if (!oldData && !newData) return null;
  const keys = new Set([
    ...Object.keys(oldData ?? {}),
    ...Object.keys(newData ?? {}),
  ]);
  const parts: string[] = [];
  for (const key of keys) {
    const b = oldData?.[key];
    const a = newData?.[key];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    parts.push(`${key}: ${String(b ?? '—')} → ${String(a ?? '—')}`);
  }
  return parts.length ? parts.join(' · ') : null;
}
