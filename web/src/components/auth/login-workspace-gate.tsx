'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { canAccessWorkspace } from '@/lib/permission-catalog';
import { isWorkspaceId, useWorkspaceStore, workspaceHome, type WorkspaceId } from '@/lib/workspace-store';

export function LoginWorkspaceGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const sp = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const stored = useWorkspaceStore((s) => s.workspace);
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  const q = sp.get('workspace');
  const fromQuery: WorkspaceId | null = isWorkspaceId(q) ? q : null;
  const workspace = fromQuery ?? stored;

  useEffect(() => {
    if (fromQuery) {
      setWorkspace(fromQuery);
    } else if (!stored) {
      router.replace('/');
      return;
    }
    const ws = fromQuery ?? stored;
    if (token && user && ws) {
      if (!canAccessWorkspace(user.permissions, ws, user.role)) {
        router.replace(`/access-denied?workspace=${ws}`);
        return;
      }
      router.replace(workspaceHome(ws));
    }
  }, [fromQuery, stored, setWorkspace, router, token, user]);

  if (!workspace) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] text-sm text-[var(--app-text-dim)]">
        جاري التحويل…
      </div>
    );
  }

  if (token && user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] text-sm text-[var(--app-text-dim)]">
        جاري التحويل…
      </div>
    );
  }

  return <>{children}</>;
}
