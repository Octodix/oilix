'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, UsersRound } from 'lucide-react';
import { HrSidebar } from './hr-sidebar';
import { ModuleSwitcher } from './module-switcher';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { FullscreenToggle } from '@/components/layout/fullscreen-toggle';
import { LogoutButton } from '@/components/layout/logout-button';
import { DeviceStatusBanner } from '@/components/devices/device-status-banner';
import { useAuthHydrated, useAuthStore } from '@/lib/auth-store';
import { canAccessWorkspace } from '@/lib/permission-catalog';
import { useWorkspaceStore, workspaceLoginPath } from '@/lib/workspace-store';
import { HR_BRAND } from '@/lib/hr-nav';
import { formatDateShortDz, formatTimeDz } from '@/lib/locale-dz';

export function HrShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthHydrated();
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setWorkspace('hr');
  }, [setWorkspace]);

  useEffect(() => {
    if (hydrated && !token) router.replace(workspaceLoginPath('hr'));
  }, [hydrated, token, router]);

  useEffect(() => {
    if (token && user && !canAccessWorkspace(user.permissions, 'hr', user.role)) {
      router.replace('/access-denied?workspace=hr');
    }
  }, [token, user, router]);

  useEffect(() => {
    const first = setTimeout(() => setNow(new Date()), 0);
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="app-glass-panel px-8 py-6 text-center">
          <UsersRound className="mx-auto h-8 w-8 text-sky-700" />
          <p className="mt-2 text-sm text-[var(--app-text-dim)]">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  const userName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || '—';

  return (
    <div className="app-shell flex flex-col">
      <div className="app-shell-row">
        <HrSidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

        <div className="app-content-panel">
          <header className="app-header no-print shrink-0 border-b border-[var(--app-glass-border)]">
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--app-glass-border)] bg-[var(--app-bg-muted)] backdrop-blur-md lg:hidden"
                aria-label="فتح القائمة"
              >
                <Menu className="h-5 w-5" />
              </button>

              <div className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[var(--app-text)]">
                    {HR_BRAND.tagline} · {HR_BRAND.taglineFr}
                  </p>
                  <p className="truncate text-xs text-sky-800/90 dark:text-sky-400/90">
                    {userName} · {user?.roleAr ?? user?.role ?? ''}
                  </p>
                </div>
              </div>

              <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                <ModuleSwitcher compact className="hidden sm:inline-flex" />
                {now ? (
                  <span className="hidden text-xs text-[var(--app-text-dim)] md:inline">
                    {formatDateShortDz(now)} · {formatTimeDz(now)}
                  </span>
                ) : null}
                <FullscreenToggle />
                <ThemeToggle />
                <LogoutButton compact />
              </div>
            </div>
          </header>
          <DeviceStatusBanner workspace="mill" />
          <main className="app-main flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
