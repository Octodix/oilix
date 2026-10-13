import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  BarChart3,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  ClipboardCheck,
  Clock4,
  FileSignature,
  Fingerprint,
  Gift,
  HandCoins,
  HeartPulse,
  LayoutDashboard,
  MinusCircle,
  Receipt,
  Settings,
  Timer,
  UserX,
  UsersRound,
  Wallet,
  Radio,
  ScrollText,
} from 'lucide-react';
import { isNavActive } from '@/lib/nav-active';

export type HrNavItem = {
  href: string;
  label: string;
  fr: string;
  icon: LucideIcon;
  permission?: string;
  anyOf?: string[];
  match?: string[];
};

export type HrNavGroup = { title: string; items: HrNavItem[] };

export const HR_NAV_GROUPS: HrNavGroup[] = [
  {
    title: 'عام · Général',
    items: [
      { href: '/hr', label: 'لوحة التحكم', fr: 'Tableau de bord', icon: LayoutDashboard, permission: 'HR_DASHBOARD_VIEW', match: ['/hr'] },
      { href: '/hr/presence', label: 'الحضور اليوم', fr: "Présence aujourd'hui", icon: Radio, permission: 'HR_ATTENDANCE_VIEW' },
    ],
  },
  {
    title: 'العمال · Personnel',
    items: [
      { href: '/hr/employees', label: 'العمال', fr: 'Employés', icon: UsersRound, permission: 'HR_EMPLOYEES_VIEW' },
      { href: '/hr/contracts', label: 'العقود', fr: 'Contrats', icon: FileSignature, permission: 'HR_EMPLOYEES_VIEW' },
      { href: '/hr/schedules', label: 'التوقيت', fr: 'Planning / Horaires', icon: CalendarClock, permission: 'HR_ACCESS' },
    ],
  },
  {
    title: 'الحضور · Présence',
    items: [
      { href: '/hr/attendance', label: 'سجل الحضور', fr: 'Présence', icon: ClipboardCheck, permission: 'HR_ATTENDANCE_VIEW' },
      { href: '/hr/punches', label: 'البصمات الخام', fr: 'Pointage', icon: Fingerprint, permission: 'HR_ATTENDANCE_VIEW' },
      { href: '/hr/lates', label: 'التأخرات', fr: 'Retards', icon: Clock4, permission: 'HR_ATTENDANCE_VIEW' },
      { href: '/hr/absences', label: 'الغيابات', fr: 'Absences', icon: UserX, anyOf: ['HR_LEAVE_MANAGE', 'HR_ATTENDANCE_VIEW'] },
      { href: '/hr/overtime', label: 'الساعات الإضافية', fr: 'Heures supplémentaires', icon: Timer, anyOf: ['HR_OVERTIME_MANAGE', 'HR_ATTENDANCE_VIEW'] },
      { href: '/hr/leave', label: 'العطل', fr: 'Congés', icon: CalendarOff, anyOf: ['HR_LEAVE_MANAGE', 'HR_ATTENDANCE_VIEW'] },
      { href: '/hr/sick-leave', label: 'العطل المرضية', fr: 'Congés maladie', icon: HeartPulse, anyOf: ['HR_LEAVE_MANAGE', 'HR_ATTENDANCE_VIEW'] },
    ],
  },
  {
    title: 'الأجور · Paie',
    items: [
      { href: '/hr/advances', label: 'التسبيقات والقروض', fr: 'Avances', icon: HandCoins, permission: 'HR_ADVANCES_MANAGE' },
      { href: '/hr/bonuses', label: 'المنح', fr: 'Primes', icon: Gift, permission: 'HR_BONUSES_MANAGE' },
      { href: '/hr/deductions', label: 'الاقتطاعات', fr: 'Retenues', icon: MinusCircle, permission: 'HR_DEDUCTIONS_MANAGE' },
      { href: '/hr/payroll', label: 'الأجور', fr: 'Paie', icon: Wallet, permission: 'HR_PAYROLL_VIEW' },
      { href: '/hr/payments', label: 'دفع الأجور', fr: 'Paiements des salaires', icon: Banknote, permission: 'HR_PAYROLL_VIEW' },
      { href: '/hr/expenses', label: 'مصاريف العمال', fr: 'Dépenses RH', icon: Receipt, permission: 'HR_EXPENSES_VIEW' },
    ],
  },
  {
    title: 'النظام · Système',
    items: [
      { href: '/hr/devices', label: 'أجهزة البصمة', fr: 'Appareils de pointage', icon: Fingerprint, permission: 'HR_DEVICES_VIEW' },
      { href: '/hr/reports', label: 'التقارير', fr: 'Rapports', icon: BarChart3, permission: 'HR_REPORTS_VIEW' },
      { href: '/hr/calendar', label: 'الرزنامة الشهرية', fr: 'Calendrier', icon: CalendarDays, permission: 'HR_ATTENDANCE_VIEW' },
      { href: '/hr/audit', label: 'سجل العمليات', fr: 'Journal', icon: ScrollText, permission: 'AUDIT_READ' },
      { href: '/hr/settings', label: 'الإعدادات', fr: 'Paramètres RH', icon: Settings, permission: 'HR_ACCESS' },
    ],
  },
];

export const HR_NAV: HrNavItem[] = HR_NAV_GROUPS.flatMap((g) => g.items);

export const HR_BRAND = {
  name: 'Oilix',
  tagline: 'الموارد البشرية',
  taglineFr: 'Ressources Humaines',
  icon: UsersRound,
} as const;

export const isHrNavActive = isNavActive;
