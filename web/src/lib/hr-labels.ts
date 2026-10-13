/**
 * HR (Ressources Humaines) labels in Arabic + French and small pure helpers shared by the
 * /hr pages. No React, no '@/' imports: covered by node:test in hr-labels.spec.ts.
 */

export type Tone = 'default' | 'primary' | 'gold' | 'success' | 'warning' | 'danger';
export type Label = { ar: string; fr: string; tone?: Tone };

function pick(map: Record<string, Label>, key: string | null | undefined): Label {
  if (!key) return { ar: '—', fr: '—', tone: 'default' };
  return map[key] ?? { ar: key, fr: key, tone: 'default' };
}

export const ATTENDANCE_STATUS: Record<string, Label> = {
  PRESENT: { ar: 'حاضر', fr: 'Présent', tone: 'success' },
  LATE: { ar: 'متأخر', fr: 'En retard', tone: 'warning' },
  ABSENT: { ar: 'غائب', fr: 'Absent', tone: 'danger' },
  MISSING_PUNCH: { ar: 'بصمة ناقصة', fr: 'Pointage incomplet', tone: 'warning' },
  IN_PROGRESS: { ar: 'في العمل', fr: 'En poste', tone: 'primary' },
  NOT_ARRIVED: { ar: 'لم يصل بعد', fr: 'Pas encore arrivé', tone: 'default' },
  UPCOMING: { ar: 'قادم', fr: 'À venir', tone: 'default' },
  LEAVE: { ar: 'عطلة', fr: 'Congé', tone: 'primary' },
  SICK_LEAVE: { ar: 'عطلة مرضية', fr: 'Congé maladie', tone: 'primary' },
  AUTHORIZED_ABSENCE: { ar: 'غياب مرخص', fr: 'Absence autorisée', tone: 'gold' },
  REST_DAY: { ar: 'راحة', fr: 'Repos', tone: 'default' },
  HOLIDAY: { ar: 'عطلة رسمية', fr: 'Jour férié', tone: 'gold' },
  NOT_EMPLOYED: { ar: 'خارج العقد', fr: 'Hors contrat', tone: 'default' },
};

export const LIVE_BUCKET: Record<string, Label> = {
  PRESENT: { ar: 'حاضرون', fr: 'Présents', tone: 'success' },
  LATE: { ar: 'متأخرون', fr: 'En retard', tone: 'warning' },
  ABSENT: { ar: 'غائبون', fr: 'Absents', tone: 'danger' },
  NOT_ARRIVED: { ar: 'لم يصلوا بعد', fr: 'Pas encore arrivés', tone: 'default' },
  LEAVE: { ar: 'في عطلة', fr: 'En congé', tone: 'primary' },
  SICK_LEAVE: { ar: 'عطلة مرضية', fr: 'Congé maladie', tone: 'primary' },
  LEFT: { ar: 'غادروا', fr: 'Sortis', tone: 'default' },
  OFF: { ar: 'راحة / عطلة رسمية', fr: 'Repos / férié', tone: 'default' },
};

export const LIVE_BUCKET_ORDER = ['PRESENT', 'LATE', 'NOT_ARRIVED', 'ABSENT', 'LEAVE', 'SICK_LEAVE', 'LEFT', 'OFF'];

export const ATTENDANCE_FLAG: Record<string, Label> = {
  NO_SCHEDULE: { ar: 'بدون توقيت', fr: 'Sans horaire', tone: 'warning' },
  DUPLICATE_PUNCHES_IGNORED: { ar: 'بصمات مكررة تم تجاهلها', fr: 'Doublons ignorés' },
  CORRECTED: { ar: 'مصحح', fr: 'Corrigé', tone: 'gold' },
  WORKED_DURING_LEAVE: { ar: 'عمل أثناء العطلة', fr: 'Travail pendant congé', tone: 'warning' },
  HOLIDAY_ON_REST_DAY: { ar: 'عطلة رسمية يوم راحة', fr: 'Férié sur repos' },
  WORKED_HOLIDAY: { ar: 'عمل يوم عطلة رسمية', fr: 'Travail jour férié', tone: 'gold' },
  WORKED_REST_DAY: { ar: 'عمل يوم الراحة', fr: 'Travail jour de repos', tone: 'gold' },
  OVERTIME: { ar: 'ساعات إضافية', fr: 'Heures sup.', tone: 'primary' },
  SINGLE_PUNCH_ON_DAY_OFF: { ar: 'بصمة واحدة يوم راحة', fr: 'Pointage isolé (repos)', tone: 'warning' },
  MISSING_OUT: { ar: 'خروج غير مسجل', fr: 'Sortie manquante', tone: 'warning' },
  MISSING_IN: { ar: 'دخول غير مسجل', fr: 'Entrée manquante', tone: 'warning' },
  EARLY_LEAVE: { ar: 'خروج مبكر', fr: 'Départ anticipé', tone: 'warning' },
};

export const APPROVAL_STATUS: Record<string, Label> = {
  PENDING: { ar: 'في الانتظار', fr: 'En attente', tone: 'warning' },
  APPROVED: { ar: 'مقبول', fr: 'Approuvé', tone: 'success' },
  REJECTED: { ar: 'مرفوض', fr: 'Refusé', tone: 'danger' },
  CANCELLED: { ar: 'ملغى', fr: 'Annulé', tone: 'default' },
};

export const EMPLOYEE_STATUS: Record<string, Label> = {
  ACTIVE: { ar: 'نشط', fr: 'Actif', tone: 'success' },
  ON_LEAVE: { ar: 'في عطلة', fr: 'En congé', tone: 'primary' },
  SUSPENDED: { ar: 'موقوف', fr: 'Suspendu', tone: 'warning' },
  LEFT: { ar: 'غادر', fr: 'Sorti', tone: 'default' },
};

export const CONTRACT_TYPE: Record<string, Label> = {
  CDI: { ar: 'عقد غير محدد المدة', fr: 'CDI' },
  CDD: { ar: 'عقد محدد المدة', fr: 'CDD' },
  SEASONAL: { ar: 'عقد موسمي', fr: 'Saisonnier' },
  PART_TIME: { ar: 'دوام جزئي', fr: 'Temps partiel' },
  TRIAL: { ar: 'فترة تجربة', fr: "Période d'essai" },
  INTERNSHIP: { ar: 'تربص', fr: 'Stage' },
  OTHER: { ar: 'آخر', fr: 'Autre' },
};

export const CONTRACT_STATUS: Record<string, Label> = {
  ACTIVE: { ar: 'ساري', fr: 'Actif', tone: 'success' },
  ENDED: { ar: 'منتهٍ', fr: 'Terminé', tone: 'default' },
  TERMINATED: { ar: 'مفسوخ', fr: 'Résilié', tone: 'danger' },
};

export const SALARY_MODE: Record<string, Label> = {
  MONTHLY: { ar: 'شهري', fr: 'Mensuel' },
  DAILY: { ar: 'يومي', fr: 'Journalier' },
  HOURLY: { ar: 'بالساعة', fr: 'Horaire' },
};

export const PAYMENT_METHOD: Record<string, Label> = {
  CASH_REGISTER: { ar: 'من الصندوق', fr: 'Caisse' },
  CASH: { ar: 'نقداً (خارج الصندوق)', fr: 'Espèces (hors caisse)' },
  BANK_TRANSFER: { ar: 'تحويل بنكي', fr: 'Virement bancaire' },
  CCP: { ar: 'حوالة بريدية CCP', fr: 'CCP' },
  CHEQUE: { ar: 'صك', fr: 'Chèque' },
};

export const PAYROLL_STATUS: Record<string, Label> = {
  DRAFT: { ar: 'مسودة', fr: 'Brouillon', tone: 'default' },
  CALCULATED: { ar: 'محسوبة', fr: 'Calculée', tone: 'primary' },
  REVIEWED: { ar: 'مراجَعة', fr: 'Vérifiée', tone: 'gold' },
  VALIDATED: { ar: 'مصادق عليها', fr: 'Validée', tone: 'success' },
  PAID: { ar: 'مدفوعة', fr: 'Payée', tone: 'success' },
  CLOSED: { ar: 'مغلقة', fr: 'Clôturée', tone: 'default' },
};

export const PAYSLIP_PAYMENT_STATUS: Record<string, Label> = {
  UNPAID: { ar: 'غير مدفوع', fr: 'Non payé', tone: 'danger' },
  PARTIAL: { ar: 'مدفوع جزئياً', fr: 'Partiel', tone: 'warning' },
  PAID: { ar: 'مدفوع', fr: 'Payé', tone: 'success' },
};

export const EXPENSE_CATEGORY: Record<string, Label> = {
  SOCIAL_CONTRIBUTION: { ar: 'اشتراكات اجتماعية', fr: 'Cotisations sociales' },
  INSURANCE: { ar: 'تأمين', fr: 'Assurance' },
  MEDICAL: { ar: 'مصاريف طبية', fr: 'Frais médicaux' },
  TRAINING: { ar: 'تكوين', fr: 'Formation' },
  UNIFORM: { ar: 'ملابس العمل', fr: 'Tenues de travail' },
  TRANSPORT: { ar: 'نقل', fr: 'Transport' },
  MEAL: { ar: 'إطعام', fr: 'Restauration' },
  RECRUITMENT: { ar: 'توظيف', fr: 'Recrutement' },
  OTHER: { ar: 'أخرى', fr: 'Autre' },
  SALARY: { ar: 'أجور مدفوعة', fr: 'Salaires versés' },
  ADVANCE: { ar: 'تسبيقات', fr: 'Avances' },
  LOAN: { ar: 'قروض ممنوحة', fr: 'Prêts accordés' },
};

export const VERIFY_METHOD: Record<string, Label> = {
  FINGERPRINT: { ar: 'بصمة', fr: 'Empreinte' },
  CARD: { ar: 'بطاقة', fr: 'Badge' },
  PIN: { ar: 'رمز سري', fr: 'Code' },
  FACE: { ar: 'وجه', fr: 'Visage' },
  PALM: { ar: 'كف', fr: 'Paume' },
  OTHER: { ar: 'أخرى', fr: 'Autre' },
  UNKNOWN: { ar: 'غير معروف', fr: 'Inconnu' },
  MANUAL: { ar: 'يدوي', fr: 'Manuel' },
};

export const DEVICE_STATUS: Record<string, Label & { dot: string }> = {
  ONLINE: { ar: 'متصل', fr: 'Connecté', tone: 'success', dot: '🟢' },
  SYNCING: { ar: 'مزامنة', fr: 'Synchronisation', tone: 'warning', dot: '🟠' },
  OFFLINE: { ar: 'غير متصل', fr: 'Hors ligne', tone: 'danger', dot: '🔴' },
  WAITING_FOR_DEVICE: { ar: 'بانتظار الجهاز', fr: 'En attente du terminal', tone: 'warning', dot: '🟠' },
  AUTH_REQUIRED: { ar: 'مفتاح الاتصال مرفوض', fr: 'Clé refusée', tone: 'danger', dot: '🔴' },
  NOT_APPLICABLE: { ar: 'استيراد ملفات', fr: 'Import fichier', tone: 'default', dot: '⚪' },
  ERROR: { ar: 'خطأ', fr: 'Erreur', tone: 'danger', dot: '🔴' },
  NEVER_CONNECTED: { ar: 'لم يتصل أبداً', fr: 'Jamais connecté', tone: 'default', dot: '⚪' },
  DISABLED: { ar: 'معطل', fr: 'Désactivé', tone: 'default', dot: '⚫' },
  UNKNOWN: { ar: 'غير معروف', fr: 'Inconnu', tone: 'default', dot: '⚪' },
};

export function deviceStatus(status: string | null | undefined, enabled = true) {
  if (!enabled) return DEVICE_STATUS.DISABLED;
  return DEVICE_STATUS[status ?? 'UNKNOWN'] ?? { ...DEVICE_STATUS.UNKNOWN, ar: status ?? '—', fr: status ?? '—' };
}

export const PROVIDER: Record<string, Label> = {
  ZKTECO_ADMS: { ar: 'ZKTeco ADMS (الجهاز يرسل تلقائياً)', fr: 'ZKTeco ADMS (push HTTP)' },
  ZKTECO_TCP: { ar: 'ZKTeco SDK (المنفذ 4370)', fr: 'ZKTeco SDK TCP/UDP' },
  ZKTECO_FILE: { ar: 'استيراد ملف (USB)', fr: 'Import de fichier (USB)' },
};

export const SYNC_STATUS: Record<string, Label> = {
  RUNNING: { ar: 'جارية', fr: 'En cours', tone: 'warning' },
  SUCCESS: { ar: 'نجحت', fr: 'Réussie', tone: 'success' },
  PARTIAL: { ar: 'جزئية', fr: 'Partielle', tone: 'warning' },
  FAILED: { ar: 'فشلت', fr: 'Échec', tone: 'danger' },
  REJECTED: { ar: 'مرفوضة', fr: 'Rejetée', tone: 'danger' },
  NO_DATA: { ar: 'لا جديد', fr: 'Rien de nouveau', tone: 'default' },
};

export const SYNC_TRIGGER: Record<string, Label> = {
  PUSH: { ar: 'إرسال من الجهاز', fr: 'Push terminal' },
  MANUAL: { ar: 'يدوي', fr: 'Manuel' },
  SCHEDULED: { ar: 'مجدول', fr: 'Planifié' },
  FILE: { ar: 'استيراد ملف', fr: 'Import fichier' },
  DIAGNOSTIC: { ar: 'تشخيص / اختبار', fr: 'Diagnostic' },
};

export const SICK_TREATMENT: Record<string, Label> = {
  UNPAID: { ar: 'غير مدفوعة', fr: 'Non payé' },
  PAID: { ar: 'مدفوعة كلياً', fr: 'Payé' },
  PARTIAL: { ar: 'مدفوعة جزئياً', fr: 'Partiellement payé' },
};

export const OVERTIME_RULE: Record<string, Label> = {
  WORKDAY: { ar: 'يوم عمل', fr: 'Jour ouvré' },
  REST_DAY: { ar: 'يوم راحة', fr: 'Jour de repos' },
  HOLIDAY: { ar: 'عطلة رسمية', fr: 'Jour férié' },
};

export const OVERTIME_SOURCE: Record<string, Label> = {
  CALCULATED: { ar: 'من البصمة', fr: 'Pointage' },
  MANUAL: { ar: 'يدوي', fr: 'Manuel' },
};

export const BONUS_CATEGORY: Record<string, Label> = {
  BONUS: { ar: 'منحة', fr: 'Prime' },
  ALLOWANCE: { ar: 'تعويض', fr: 'Indemnité' },
};

export const ADVANCE_STATUS: Record<string, Label> = {
  OPEN: { ar: 'في انتظار الاقتطاع', fr: 'À déduire', tone: 'warning' },
  DEDUCTED: { ar: 'تم اقتطاعها', fr: 'Déduite', tone: 'success' },
  CANCELLED: { ar: 'ملغاة', fr: 'Annulée', tone: 'default' },
};

export const LOAN_STATUS: Record<string, Label> = {
  ACTIVE: { ar: 'جارٍ', fr: 'En cours', tone: 'warning' },
  COMPLETED: { ar: 'مسدد', fr: 'Remboursé', tone: 'success' },
  CANCELLED: { ar: 'ملغى', fr: 'Annulé', tone: 'default' },
};

export const MONEY_STATUS: Record<string, Label> = {
  POSTED: { ar: 'مسجل', fr: 'Enregistré', tone: 'success' },
  CANCELLED: { ar: 'ملغى', fr: 'Annulé', tone: 'default' },
};

export const WEEKDAYS: Label[] = [
  { ar: 'الأحد', fr: 'Dimanche' },
  { ar: 'الإثنين', fr: 'Lundi' },
  { ar: 'الثلاثاء', fr: 'Mardi' },
  { ar: 'الأربعاء', fr: 'Mercredi' },
  { ar: 'الخميس', fr: 'Jeudi' },
  { ar: 'الجمعة', fr: 'Vendredi' },
  { ar: 'السبت', fr: 'Samedi' },
];

export const MONTHS: Label[] = [
  { ar: 'جانفي', fr: 'Janvier' },
  { ar: 'فيفري', fr: 'Février' },
  { ar: 'مارس', fr: 'Mars' },
  { ar: 'أفريل', fr: 'Avril' },
  { ar: 'ماي', fr: 'Mai' },
  { ar: 'جوان', fr: 'Juin' },
  { ar: 'جويلية', fr: 'Juillet' },
  { ar: 'أوت', fr: 'Août' },
  { ar: 'سبتمبر', fr: 'Septembre' },
  { ar: 'أكتوبر', fr: 'Octobre' },
  { ar: 'نوفمبر', fr: 'Novembre' },
  { ar: 'ديسمبر', fr: 'Décembre' },
];

export const label = {
  attendance: (k?: string | null) => pick(ATTENDANCE_STATUS, k),
  bucket: (k?: string | null) => pick(LIVE_BUCKET, k),
  flag: (k?: string | null) => pick(ATTENDANCE_FLAG, k),
  approval: (k?: string | null) => pick(APPROVAL_STATUS, k),
  employee: (k?: string | null) => pick(EMPLOYEE_STATUS, k),
  contractType: (k?: string | null) => pick(CONTRACT_TYPE, k),
  contractStatus: (k?: string | null) => pick(CONTRACT_STATUS, k),
  salaryMode: (k?: string | null) => pick(SALARY_MODE, k),
  payment: (k?: string | null) => pick(PAYMENT_METHOD, k),
  payroll: (k?: string | null) => pick(PAYROLL_STATUS, k),
  payslipPayment: (k?: string | null) => pick(PAYSLIP_PAYMENT_STATUS, k),
  expense: (k?: string | null) => pick(EXPENSE_CATEGORY, k),
  verify: (k?: string | null) => pick(VERIFY_METHOD, k),
  provider: (k?: string | null) => pick(PROVIDER, k),
  sync: (k?: string | null) => pick(SYNC_STATUS, k),
  trigger: (k?: string | null) => pick(SYNC_TRIGGER, k),
  sick: (k?: string | null) => pick(SICK_TREATMENT, k),
  overtimeRule: (k?: string | null) => pick(OVERTIME_RULE, k),
  overtimeSource: (k?: string | null) => pick(OVERTIME_SOURCE, k),
  bonusCategory: (k?: string | null) => pick(BONUS_CATEGORY, k),
  advance: (k?: string | null) => pick(ADVANCE_STATUS, k),
  loan: (k?: string | null) => pick(LOAN_STATUS, k),
  money: (k?: string | null) => pick(MONEY_STATUS, k),
};

/** Payroll warning codes from the API ("CODE" or "CODE:detail") → readable text. */
export function payrollWarning(code: string): string {
  const sep = code.indexOf(':');
  const key = sep < 0 ? code : code.slice(0, sep);
  const detail = sep < 0 ? undefined : code.slice(sep + 1);
  switch (key) {
    case 'NO_CONTRACT':
      return 'لا يوجد عقد ساري · Aucun contrat actif';
    case 'NO_CONTRACT_ON':
      return `يوم عمل بدون عقد (${detail}) · Jour sans contrat`;
    case 'CONTRACT_CHANGED_IN_PERIOD':
      return 'تغيّر العقد خلال الشهر · Contrat modifié dans le mois';
    case 'MISSING_PUNCH_DAYS':
      return `${detail} يوم ببصمة ناقصة غير معالجة · jours de pointage incomplet`;
    case 'PENDING_OVERTIME':
      return `${detail} ساعات إضافية في انتظار الموافقة (غير مدفوعة) · HS en attente`;
    case 'PENDING_OVERTIME_EMPLOYEES':
      return `${detail} عمال لديهم ساعات إضافية غير مقبولة · employés avec HS en attente`;
    case 'PERIOD_NOT_FINISHED':
      return 'الشهر لم ينتهِ بعد — الحساب مؤقت · Mois non terminé';
    case 'NEGATIVE_NET':
      return 'الصافي سالب — راجع الاقتطاعات · Net négatif';
    default:
      return code;
  }
}

// ── Numbers, money, durations ───────────────────────────────────────────────

/** Prisma Decimal arrives as a string in JSON. */
export function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 125 → "2h05", 45 → "45 min", 0 → "0". */
export function fmtMinutes(m: number | null | undefined): string {
  const v = Math.round(toNum(m));
  if (!v) return '0';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a < 60) return `${sign}${a} min`;
  return `${sign}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
}

export function fmtHours(m: number | null | undefined): string {
  return (toNum(m) / 60).toFixed(2);
}

// ── Dates (YYYY-MM-DD keys, Algeria UTC+1 without DST) ────────────────────────

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts "2026-10-06" or an ISO datetime of a date-only column ("2026-10-06T00:00:00.000Z"). */
export function dayKey(v: string | Date | null | undefined): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

export function isDateKey(v: string): boolean {
  if (!DATE_KEY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** "2026-10-06" → "06/10/2026" (no timezone conversion). */
export function fmtDay(v: string | Date | null | undefined): string {
  const k = dayKey(v);
  if (!k) return '—';
  const [y, m, d] = k.split('-');
  return `${d}/${m}/${y}`;
}

export function weekdayOf(key: string): number {
  return new Date(`${dayKey(key)}T00:00:00Z`).getUTCDay();
}

export function addDays(key: string, n: number): string {
  const d = new Date(`${dayKey(key)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${dayKey(from)}T00:00:00Z`);
  const b = Date.parse(`${dayKey(to)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from, to: `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}

export function monthLabel(year: number, month: number): string {
  const m = MONTHS[month - 1];
  return m ? `${m.ar} ${year} · ${m.fr}` : `${month}/${year}`;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** Today's key in Algeria (UTC+60 min, no DST). */
export function todayKeyDz(now: Date = new Date(), offsetMinutes = 60): string {
  return new Date(now.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Wall-clock HH:MM of an instant in Algeria (UTC+60). */
export function timeDz(v: string | Date | null | undefined, offsetMinutes = 60): string {
  if (!v) return '—';
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return '—';
  return new Date(t + offsetMinutes * 60_000).toISOString().slice(11, 16);
}

export function dateTimeDz(v: string | Date | null | undefined, offsetMinutes = 60): string {
  if (!v) return '—';
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return '—';
  const iso = new Date(t + offsetMinutes * 60_000).toISOString();
  return `${fmtDay(iso.slice(0, 10))} ${iso.slice(11, 16)}`;
}

/** "il y a 3 min" style age, Arabic first. */
export function ageLabel(v: string | Date | null | undefined, now: Date = new Date()): string {
  if (!v) return 'أبداً · jamais';
  const s = Math.max(0, Math.round((now.getTime() - new Date(v).getTime()) / 1000));
  if (s < 60) return `منذ ${s} ث · il y a ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `منذ ${m} د · il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `منذ ${h} سا · il y a ${h} h`;
  const d = Math.round(h / 24);
  return `منذ ${d} يوم · il y a ${d} j`;
}

// ── People ────────────────────────────────────────────────────────────────

export function fullName(e: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!e) return '—';
  return [e.lastName, e.firstName].filter(Boolean).join(' ').trim() || '—';
}

// ── Payroll workflow (mirrors the API state machine) ──────────────────────────

export type PayrollAction = 'calculate' | 'review' | 'validate' | 'reopen' | 'pay' | 'close';

export function payrollActions(status: string): PayrollAction[] {
  switch (status) {
    case 'DRAFT':
      return ['calculate'];
    case 'CALCULATED':
      return ['calculate', 'review'];
    case 'REVIEWED':
      return ['calculate', 'validate'];
    case 'VALIDATED':
      return ['pay', 'reopen'];
    case 'PAID':
      return ['close'];
    default:
      return [];
  }
}

/** Remaining amount a payslip can still receive. */
export function payslipRemaining(p: { netSalary: unknown; paidAmount: unknown }): number {
  return Math.max(0, round2(toNum(p.netSalary) - toNum(p.paidAmount)));
}

// ── Idempotency + CSV ─────────────────────────────────────────────────────────

/** Client-generated key for money-out requests; reused on retry so the API never posts twice. */
export function newIdempotencyKey(prefix = 'hr'): string {
  const b = new Uint8Array(12);
  globalThis.crypto.getRandomValues(b);
  return `${prefix}-${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? String(v) : String(v);
  // Spreadsheet formula injection guard.
  if (/^[=+\-@\t\r]/.test(s) && !(typeof v === 'number')) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Semicolon CSV with BOM so Excel (fr/ar locales) opens Arabic text and columns correctly. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(';'), ...rows.map((r) => r.map(csvCell).join(';'))];
  return `\uFEFF${lines.join('\r\n')}`;
}
