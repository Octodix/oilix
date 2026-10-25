import type { LucideIcon } from 'lucide-react';
import {
  Box,
  CalendarCheck,
  ClipboardList,
  Computer,
  Droplets,
  HandCoins,
  Landmark,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';
import { isNavActive } from '@/lib/nav-active';

export type SalesNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  anyOf?: string[];
  match?: string[];
};

export const OIL_SOURCES = [
  {
    value: 'STORED' as const,
    label: 'زيت المخزن',
    labelFr: 'Huile du magasin',
    emoji: '🏪',
    color: '#1d4ed8',
    soft: 'rgba(29,78,216,0.12)',
  },
  {
    value: 'FARMER' as const,
    label: 'زيت الفلاح',
    labelFr: 'Huile du paysan',
    emoji: '🌾',
    color: '#b45309',
    soft: 'rgba(180,83,9,0.12)',
  },
] as const;

export type OilSourceValue = (typeof OIL_SOURCES)[number]['value'];

export const OIL_TYPES = [
  {
    value: 'GREEN' as const,
    label: 'زيت أخضر',
    shortLabel: 'أخضر',
    labelFr: 'Huile Verte',
    emoji: '🟢',
    color: '#2d6a4f',
    soft: 'rgba(45,106,79,0.12)',
  },
  {
    value: 'TAIEB' as const,
    label: 'زيت طايب',
    shortLabel: 'طايب',
    labelFr: 'Huile Taïeb',
    emoji: '⚫',
    color: '#6b4f2a',
    soft: 'rgba(107,79,42,0.12)',
  },
  {
    value: 'DROU' as const,
    label: 'زيت الضرو',
    shortLabel: 'الضرو',
    labelFr: 'Huile Drou',
    emoji: '🟤',
    color: '#7c3aed',
    soft: 'rgba(124,58,237,0.12)',
  },
  {
    value: 'ZEBBOUCHE' as const,
    label: 'زيت الزبوش',
    shortLabel: 'الزبوش',
    labelFr: 'Huile Zebbouche',
    emoji: '🫒',
    color: '#0f766e',
    soft: 'rgba(15,118,110,0.12)',
  },
] as const;

export type OilTypeValue = (typeof OIL_TYPES)[number]['value'];

export function oilSourceMeta(source: string) {
  return OIL_SOURCES.find((s) => s.value === source) ?? OIL_SOURCES[0];
}

export function oilMeta(type: string) {
  return OIL_TYPES.find((t) => t.value === type) ?? OIL_TYPES[0];
}

export const SALES_NAV: SalesNavItem[] = [
  {
    href: '/sales',
    label: 'لوحة التحكم',
    icon: LayoutDashboard,
    permission: 'OIL_SALES_DASHBOARD_VIEW',
    match: ['/sales'],
  },
  {
    href: '/sales/new',
    label: 'بيع جديد',
    icon: ShoppingCart,
    permission: 'OIL_SALES_SALES_CREATE',
    anyOf: ['OIL_SALES_SALES_CREATE', 'OIL_SALES_CONTAINERS_SELL'],
    match: ['/sales/new'],
  },
  {
    href: '/sales/history',
    label: 'المبيعات',
    icon: ClipboardList,
    permission: 'OIL_SALES_SALES_VIEW',
    match: ['/sales/history'],
  },
  {
    href: '/sales/stock',
    label: 'مخزون الزيت',
    icon: Warehouse,
    permission: 'OIL_SALES_STOCK_VIEW',
    match: ['/sales/stock', '/sales/movements'],
  },
  {
    href: '/sales/container-stock',
    label: 'مخزون الضلف',
    icon: Package,
    permission: 'OIL_SALES_CONTAINER_STOCK_VIEW',
    match: ['/sales/container-stock'],
  },
  {
    href: '/sales/containers',
    label: 'الضلف / التعبئة',
    icon: Box,
    permission: 'OIL_SALES_CONTAINERS_VIEW',
    match: ['/sales/containers'],
  },
  {
    href: '/sales/daily-closing',
    label: 'الجرد اليومي',
    icon: CalendarCheck,
    permission: 'OIL_SALES_INVENTORY_VIEW',
    match: ['/sales/daily-closing'],
  },
  {
    href: '/sales/inventory',
    label: 'الجرد',
    icon: ClipboardList,
    permission: 'OIL_SALES_INVENTORY_VIEW',
    match: ['/sales/inventory'],
  },
  {
    href: '/sales/customers',
    label: 'الزبائن',
    icon: Users,
    permission: 'OIL_SALES_CUSTOMERS_VIEW',
    match: ['/sales/customers'],
  },
  {
    href: '/sales/debts',
    label: 'الديون',
    icon: HandCoins,
    permission: 'OIL_SALES_DEBTS_VIEW',
    match: ['/sales/debts'],
  },
  {
    href: '/sales/reports',
    label: 'التقارير',
    icon: Wallet,
    permission: 'OIL_SALES_REPORTS_VIEW',
    match: ['/sales/reports'],
  },
  {
    href: '/sales/cash',
    label: 'الصندوق',
    icon: Landmark,
    permission: 'OIL_SALES_CASH_REGISTER_VIEW_OWN',
    anyOf: ['OIL_SALES_CASH_REGISTER_VIEW_OWN', 'OIL_SALES_CASH_REGISTER_VIEW_ALL'],
    match: ['/sales/cash'],
  },
  {
    href: '/sales/devices',
    label: 'الأجهزة',
    icon: Computer,
    permission: 'OIL_SALES_DEVICES_VIEW',
    anyOf: ['OIL_SALES_DEVICES_VIEW', 'OIL_SALES_DEVICES_MANAGE'],
    match: ['/sales/devices'],
  },
  {
    href: '/sales/settings',
    label: 'الإعدادات',
    icon: Settings,
    permission: 'OIL_SALES_SETTINGS_VIEW',
    match: ['/sales/settings'],
  },
];

export const SALES_BRAND = {
  name: 'Oilix',
  tagline: 'بيع الزيت',
  millTagline: 'إدارة المعصرة',
  icon: Droplets,
} as const;

export const isSalesNavActive = isNavActive;
