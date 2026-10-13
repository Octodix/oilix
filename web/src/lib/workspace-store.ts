import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type WorkspaceId = 'mill' | 'sales' | 'hr';

export const WORKSPACE_IDS: WorkspaceId[] = ['mill', 'sales', 'hr'];

type WorkspaceState = {
  workspace: WorkspaceId | null;
  setWorkspace: (w: WorkspaceId) => void;
  clearWorkspace: () => void;
};

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      workspace: null,
      setWorkspace: (workspace) => set({ workspace }),
      clearWorkspace: () => set({ workspace: null }),
    }),
    { name: 'oilix_workspace' },
  ),
);

export function isWorkspaceId(v: unknown): v is WorkspaceId {
  return v === 'mill' || v === 'sales' || v === 'hr';
}

export function workspaceHome(w: WorkspaceId) {
  if (w === 'sales') return '/sales';
  if (w === 'hr') return '/hr';
  return '/dashboard';
}

export function workspaceLoginPath(w: WorkspaceId) {
  return `/login?workspace=${w}`;
}

export function workspaceFromPath(pathname: string): WorkspaceId {
  if (pathname === '/sales' || pathname.startsWith('/sales/')) return 'sales';
  if (pathname === '/hr' || pathname.startsWith('/hr/')) return 'hr';
  return 'mill';
}
