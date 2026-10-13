'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Leaf } from 'lucide-react';
import { TopHeader } from './top-header';
import { AppSidebar } from './app-sidebar';
import { SeasonViewBanner } from '@/components/season/season-view-banner';
import { DeviceStatusBanner } from '@/components/devices/device-status-banner';
import { useAuthHydrated, useAuthStore } from '@/lib/auth-store';
import { canAccessWorkspace } from '@/lib/permission-catalog';
import { useWorkspaceStore, workspaceLoginPath } from '@/lib/workspace-store';
import { BRAND } from '@/lib/navigation';

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthHydrated();
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setWorkspace('mill');
  }, [setWorkspace]);

  useEffect(() => {
    if (hydrated && !token) router.replace(workspaceLoginPath('mill'));
  }, [hydrated, token, router]);

  useEffect(() => {
    if (token && user && !canAccessWorkspace(user.permissions, 'mill', user.role)) {
      router.replace('/access-denied?workspace=mill');
    }
  }, [token, user, router]);

  if (!token) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,color-mix(in_srgb,var(--app-accent)_12%,transparent),transparent)]"
          aria-hidden
        />
        <div className="app-glass-panel relative flex flex-col items-center gap-5 px-10 py-8">
          <div className="app-brand-loader flex h-16 w-16 items-center justify-center rounded-[var(--app-radius-lg)] bg-gradient-to-br from-[var(--app-accent)] to-[var(--app-accent-dark)] text-white">
            <Leaf className="h-8 w-8" strokeWidth={2} />
          </div>
          <div className="text-center">
            <p className="text-lg font-black text-[var(--app-text)]">{BRAND.name}</p>
            <p className="mt-1 text-sm text-[var(--app-text-dim)]">جاري التحميل...</p>
          </div>
          <div className="h-1 w-32 overflow-hidden rounded-full bg-[var(--app-bg-muted)]">
            <div className="h-full w-1/2 animate-[dashboard-fade-up_1.2s_ease-in-out_infinite_alternate] rounded-full bg-[var(--app-accent)]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell flex flex-col">
      <div className="app-shell-row">
        <AppSidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

        <div className="app-content-panel">
          <TopHeader onMenuClick={() => setSidebarOpen(true)} />
          <SeasonViewBanner />
          <DeviceStatusBanner workspace="mill" />
          <main className="app-main flex-1 overflow-x-hidden overflow-y-auto p-[var(--space-page)] md:p-[var(--space-page-lg)] [&:has(.dashboard-page)]:p-0 [&:has(.processing-page)]:p-0 [&:has(.olive-intake-page)]:p-0 [&:has(.finance-page)]:p-0 [&:has(.print-page-bg)]:p-0 [&:has(.settings-page-bg)]:p-0 [&:has(.module-page)]:p-0 [&:has(.clients-page)]:p-0 [&:has(.pressing-page)]:p-0">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
