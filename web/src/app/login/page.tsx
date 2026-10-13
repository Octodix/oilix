'use client';

import { Suspense } from 'react';
import { Leaf, Shield, Sparkles, TrendingUp } from 'lucide-react';
import { LoginForm } from '@/components/auth/login-form';
import { LoginWorkspaceGate } from '@/components/auth/login-workspace-gate';
import { FullscreenToggle } from '@/components/layout/fullscreen-toggle';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { BUSINESS_NAME } from '@/lib/labels';
import { useWorkspaceStore } from '@/lib/workspace-store';

const MILL_FEATURES = [
  { icon: Leaf, text: 'إدارة الزيتون والتصفية' },
  { icon: TrendingUp, text: 'اليومية المالية' },
  { icon: Shield, text: 'صلاحيات آمنة للمستخدمين' },
];

const SALES_FEATURES = [
  { icon: Leaf, text: 'بيع الزيت باللتر وبالتعبئة' },
  { icon: TrendingUp, text: 'المخزون والمساعدات' },
  { icon: Shield, text: 'صلاحيات دقيقة لكل عملية' },
];

const HR_FEATURES = [
  { icon: Leaf, text: 'ملفات العمال والعقود' },
  { icon: TrendingUp, text: 'الحضور بالبصمة والأجور' },
  { icon: Shield, text: 'صلاحيات دقيقة وسجل تدقيق' },
];

const COPY = {
  mill: {
    badge: 'أوليكس · نظام المعصرة',
    intro: 'منصة حديثة لإدارة الاستقبال، المعالجة، والتصفية — كل ما تحتاجه معصرتك في مكان واحد.',
    footer: 'إدارة معصرة الزيتون',
    logo: '🫒',
    subtitle: 'الدخول إلى إدارة المعصرة',
  },
  sales: {
    badge: 'أوليكس · بيع الزيت',
    intro: 'نقطة بيع الزيت، المخزون، الزبائن والتقارير — مساحة مستقلة عن إدارة المعصرة.',
    footer: 'بيع الزيت',
    logo: '🛢️',
    subtitle: 'الدخول إلى مساحة بيع الزيت',
  },
  hr: {
    badge: 'أوليكس · الموارد البشرية',
    intro: 'العمال، التوقيت، الحضور بجهاز البصمة، العطل، التسبيقات والأجور — Ressources Humaines.',
    footer: 'الموارد البشرية',
    logo: '👷',
    subtitle: 'الدخول إلى إدارة العمال',
  },
} as const;

function LoginInner() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const ws = workspace === 'sales' || workspace === 'hr' ? workspace : 'mill';
  const copy = COPY[ws];
  const features = ws === 'sales' ? SALES_FEATURES : ws === 'hr' ? HR_FEATURES : MILL_FEATURES;

  return (
    <div className="login-page relative flex min-h-screen flex-col lg:flex-row">
      <div className="absolute left-5 top-5 z-30 flex items-center gap-2 sm:left-8 sm:top-8">
        <FullscreenToggle />
        <ThemeToggle />
      </div>
      <aside className="login-hero relative flex flex-1 flex-col justify-between overflow-hidden px-8 py-10 lg:px-12 lg:py-14">
        <div className="login-hero-bg pointer-events-none absolute inset-0" />
        <div className="login-hero-pattern pointer-events-none absolute inset-0 opacity-40" />

        <div className="login-orb login-orb-1 pointer-events-none absolute -left-20 top-1/4 h-64 w-64 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="login-orb login-orb-2 pointer-events-none absolute -right-16 bottom-1/4 h-72 w-72 rounded-full bg-teal-300/15 blur-3xl" />

        <div className="login-hero-enter relative z-10">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-medium text-emerald-100 backdrop-blur-md">
            <Sparkles className="h-4 w-4 text-amber-300" />
            {copy.badge}
          </div>
          <h1 className="max-w-lg text-3xl font-black leading-tight text-white md:text-4xl lg:text-[2.75rem]">
            {BUSINESS_NAME}
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-emerald-100/85">
            {copy.intro}
          </p>
        </div>

        <ul className="login-features-enter relative z-10 mt-10 hidden space-y-3 lg:block">
          {features.map(({ icon: Icon, text }) => (
            <li
              key={text}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white/90 backdrop-blur-sm"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/30 text-emerald-100">
                <Icon className="h-4 w-4" />
              </span>
              {text}
            </li>
          ))}
        </ul>

        <p className="login-footer-enter relative z-10 mt-8 text-xs text-emerald-200/50 lg:mt-0">
          © {new Date().getFullYear()} Oilix — {copy.footer}
        </p>
      </aside>

      <main className="login-panel relative flex w-full flex-col justify-center px-6 py-14 sm:px-10 lg:w-[min(100%,28rem)] lg:max-w-md lg:shrink-0 xl:w-[32rem]">
        <div className="login-panel-bg pointer-events-none absolute inset-0" />

        <div className="login-card-enter relative z-10 mx-auto w-full max-w-sm">
          <div className="mb-8 text-center lg:text-right">
            <div className="login-logo mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-3xl shadow-lg shadow-emerald-500/30 lg:mx-0">
              {copy.logo}
            </div>
            <h2 className="text-2xl font-black text-[var(--app-text)]">تسجيل الدخول</h2>
            <p className="mt-2 text-sm text-[var(--app-text-dim)]">
              {copy.subtitle}
            </p>
          </div>

          <div className="app-glass-panel p-7 sm:p-9">
            <LoginForm />
          </div>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginWorkspaceGate>
        <LoginInner />
      </LoginWorkspaceGate>
    </Suspense>
  );
}
