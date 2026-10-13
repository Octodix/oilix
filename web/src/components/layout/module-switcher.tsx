'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Factory, ShoppingBag, UsersRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { canAccessWorkspace } from '@/lib/permission-catalog';
import {
  useWorkspaceStore,
  workspaceFromPath,
  workspaceHome,
  type WorkspaceId,
} from '@/lib/workspace-store';
import { cn } from '@/lib/utils';

const ITEMS: { id: WorkspaceId; label: string; icon: LucideIcon; active: string }[] = [
  { id: 'mill', label: 'المعصرة', icon: Factory, active: 'bg-[var(--app-surface)] text-[var(--app-accent)] shadow-sm' },
  { id: 'sales', label: 'بيع الزيت', icon: ShoppingBag, active: 'bg-amber-600 text-white shadow-sm' },
  { id: 'hr', label: 'العمال', icon: UsersRound, active: 'bg-sky-700 text-white shadow-sm' },
];

export function ModuleSwitcher({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  const current =
    workspace ?? (typeof window !== 'undefined' ? workspaceFromPath(window.location.pathname) : 'mill');

  const visible = ITEMS.filter(
    (i) => i.id === current || canAccessWorkspace(user?.permissions, i.id, user?.role),
  );

  function go(id: WorkspaceId) {
    setWorkspace(id);
    if (!canAccessWorkspace(user?.permissions, id, user?.role)) {
      router.push(`/access-denied?workspace=${id}`);
      return;
    }
    router.push(workspaceHome(id));
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div
        className="inline-flex items-center gap-1 rounded-xl border border-[var(--app-border)] bg-[var(--app-bg-muted)] p-1"
        role="tablist"
        aria-label="تبديل الوحدة"
      >
        {visible.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.id)}
              className={cn(
                'inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-bold transition',
                current === item.id
                  ? item.active
                  : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>
      {compact ? null : (
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
        >
          <ArrowLeftRight className="h-3 w-3" />
          تغيير مساحة العمل
        </Link>
      )}
    </div>
  );
}
