import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { hasPermission as checkPermission } from '@/lib/permission-catalog';

export type AuthUser = {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  role: string;
  roleAr: string;
  permissions: string[];
};

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  logout: () => void;
  hasPermission: (p: string) => boolean;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      setAuth: (token, user) => {
        localStorage.setItem('oilix_token', token);
        set({ token, user });
      },
      logout: () => {
        const token = localStorage.getItem('oilix_token') ?? get().token;
        if (token) {
          void import('@/lib/api').then(({ api }) =>
            api.post('/auth/logout').catch(() => undefined),
          );
        }
        localStorage.removeItem('oilix_token');
        localStorage.removeItem('oilix_user');
        set({ token: null, user: null });
      },
      hasPermission: (p) => {
        const user = get().user;
        if (!user) return false;
        return checkPermission(user.permissions, p, user.role);
      },
    }),
    {
      name: 'oilix_auth',
      onRehydrateStorage: () => (state) => {
        if (typeof window === 'undefined') return;
        if (state?.token) {
          localStorage.setItem('oilix_token', state.token);
        } else {
          localStorage.removeItem('oilix_token');
        }
      },
    },
  ),
);

/**
 * False during the SSR/hydration render, where the store still reports the server snapshot
 * (token null) — redirecting on "no token" before this is true bounces every deep link / refresh.
 */
export function useAuthHydrated(): boolean {
  return useSyncExternalStore(
    (cb) => useAuthStore.persist.onFinishHydration(cb),
    () => useAuthStore.persist.hasHydrated(),
    () => false,
  );
}
