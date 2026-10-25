import type { LucideIcon } from 'lucide-react';
import {
  ClipboardList,
  Droplets,
  FileSearch,
  HandCoins,
  LayoutDashboard,
  Leaf,
  Monitor,
  Printer,
  Settings,
  Table2,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import { OLIVE_TYPES } from '@/lib/labels';

export { isNavActive } from '@/lib/nav-active';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Permission required (ADMIN bypasses) */
  permission?: string;
  /** Path prefixes that mark this item active */
  match?: string[];
  badge?: string;
  /** Visual cluster (e.g. olive type). Consecutive items with the same group render together. */
  group?: string;
};

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

const oliveNavItems: NavItem[] = OLIVE_TYPES.flatMap((t) => [
  {
    href: `/olive/${t.slug}`,
    label: 'استقبال',
    icon: ClipboardList,
    match: [`/olive/${t.slug}`],
    group: t.label,
  },
  {
    href: `/olive/${t.slug}/processing`,
    label: 'معالجة',
    icon: Table2,
    match: [`/olive/${t.slug}/processing`],
    group: t.label,
  },
]);

export const APP_NAV: NavSection[] = [
  {
    id: 'main',
    label: 'الرئيسية',
    items: [
      {
        href: '/dashboard',
        label: 'لوحة التحكم',
        icon: LayoutDashboard,
        match: ['/dashboard'],
      },
    ],
  },
  {
    id: 'operations',
    label: 'العمليات',
    items: [
      {
        href: '/clients',
        label: 'الزبائن',
        icon: Users,
        match: ['/clients'],
      },
      {
        href: '/pressing',
        label: 'تصفية الزيت',
        icon: Droplets,
        match: ['/pressing'],
      },
      ...oliveNavItems,
    ],
  },
  {
    id: 'finance',
    label: 'المالية والطباعة',
    items: [
      {
        href: '/finance',
        label: 'اليومية المالية',
        icon: Wallet,
        match: ['/finance'],
      },
      {
        href: '/assistance',
        label: 'مساعدة المشغّل وتسليم المداخيل',
        icon: HandCoins,
        permission: 'MILL_ASSIST_START',
        match: ['/assistance'],
      },
      {
        href: '/assistance/dashboard',
        label: 'لوحة المشغّل الرئيسي',
        icon: UserCog,
        permission: 'MILL_ASSIST_CONFIRM',
        match: ['/assistance/dashboard'],
      },
      {
        href: '/print',
        label: 'مركز الطباعة',
        icon: Printer,
        match: ['/print', '/client-phones', '/batch-receipts', '/batch-cards'],
      },
    ],
  },
  {
    id: 'admin',
    label: 'الإدارة',
    items: [
      {
        href: '/settings',
        label: 'الإعدادات',
        icon: Settings,
        match: ['/settings'],
      },
      {
        href: '/settings/devices',
        label: 'الأجهزة',
        icon: Monitor,
        permission: 'MILL_DEVICES_VIEW',
        match: ['/settings/devices'],
      },
      {
        href: '/users',
        label: 'المستخدمون',
        icon: UserCog,
        permission: 'USERS_READ',
        match: ['/users'],
      },
      {
        href: '/audit',
        label: 'سجل النشاط',
        icon: FileSearch,
        permission: 'AUDIT_READ',
        match: ['/audit'],
      },
    ],
  },
];

export const BRAND = {
  name: 'Oilix',
  tagline: 'نظام المعصرة',
  icon: Leaf,
} as const;

export function flattenNavItems(sections: NavSection[]): NavItem[] {
  return sections.flatMap((s) => s.items);
}
