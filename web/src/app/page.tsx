'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Droplets, Factory, Leaf, UsersRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { FullscreenToggle } from '@/components/layout/fullscreen-toggle';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { useAuthStore } from '@/lib/auth-store';
import { canAccessWorkspace } from '@/lib/permission-catalog';
import {
  WORKSPACE_IDS,
  useWorkspaceStore,
  workspaceHome,
  workspaceLoginPath,
  type WorkspaceId,
} from '@/lib/workspace-store';

const CARDS: Record<
  WorkspaceId,
  { title: string; fr: string; desc: string; icon: LucideIcon; iconClass: string; hover: string }
> = {
  mill: {
    title: 'المعصرة',
    fr: "Gestion de l'huilerie",
    desc: 'استقبال الزيتون، التصفية، المالية',
    icon: Factory,
    iconClass: 'text-emerald-700',
    hover: 'hover:border-emerald-600',
  },
  sales: {
    title: 'بيع الزيت',
    fr: "Vente d'huile",
    desc: 'نقطة البيع، المخزون، الزبائن، التقارير',
    icon: Droplets,
    iconClass: 'text-amber-700',
    hover: 'hover:border-amber-600',
  },
  hr: {
    title: 'الموارد البشرية',
    fr: 'Ressources Humaines',
    desc: 'العمال، الحضور بالبصمة، العطل، الأجور',
    icon: UsersRound,
    iconClass: 'text-sky-700',
    hover: 'hover:border-sky-600',
  },
};

export default function WorkspaceSelectPage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  const loggedIn = Boolean(token && user);

  const accessible = loggedIn
    ? WORKSPACE_IDS.filter((w) => canAccessWorkspace(user?.permissions, w, user?.role))
    : WORKSPACE_IDS;

  useEffect(() => {
    if (!loggedIn || !user) return;
    const allowed = WORKSPACE_IDS.filter((w) => canAccessWorkspace(user.permissions, w, user.role));
    if (allowed.length === 0) {
      router.replace('/access-denied?workspace=none');
      return;
    }
    if (allowed.length === 1) {
      setWorkspace(allowed[0]);
      router.replace(workspaceHome(allowed[0]));
    }
  }, [loggedIn, user, router, setWorkspace]);

  function choose(id: WorkspaceId) {
    setWorkspace(id);
    if (token && user) {
      if (!canAccessWorkspace(user.permissions, id, user.role)) {
        router.push(`/access-denied?workspace=${id}`);
        return;
      }
      router.push(workspaceHome(id));
      return;
    }
    router.push(workspaceLoginPath(id));
  }

  if (loggedIn && accessible.length <= 1) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] text-[var(--app-text-dim)]">
        جاري التوجيه...
      </div>
    );
  }

  const cols = accessible.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2';

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[var(--app-bg)] px-4">
      <div className="absolute left-5 top-5 flex gap-2">
        <FullscreenToggle />
        <ThemeToggle />
      </div>

      <div className="mb-10 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-lg">
          <Leaf className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-black text-[var(--app-text)]">Oilix</h1>
        <p className="mt-2 text-[var(--app-text-dim)]">اختر مساحة العمل</p>
      </div>

      <div className={`grid w-full gap-4 ${accessible.length >= 3 ? 'max-w-5xl' : 'max-w-3xl'} ${cols}`}>
        {accessible.map((id) => {
          const c = CARDS[id];
          const Icon = c.icon;
          return (
            <button
              key={id}
              type="button"
              onClick={() => choose(id)}
              className={`rounded-3xl border border-[var(--app-border)] bg-[var(--app-surface)] p-8 text-right shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${c.hover}`}
            >
              <Icon className={`mb-4 h-10 w-10 ${c.iconClass}`} />
              <h2 className="text-2xl font-black">{c.title}</h2>
              <p className="mt-1 text-sm text-[var(--app-text-dim)]">{c.fr}</p>
              <p className="mt-3 text-sm text-[var(--app-text-muted)]">{c.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
