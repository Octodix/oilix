'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import axios, { type AxiosError } from 'axios';
import { Eye, EyeOff, Lock, LogIn, User } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { resolveApiBaseUrl } from '@/lib/api-url';
import { useAuthStore, type AuthUser } from '@/lib/auth-store';
import { canAccessWorkspace } from '@/lib/permission-catalog';
import { WORKSPACE_IDS, useWorkspaceStore, workspaceHome } from '@/lib/workspace-store';
import { cn } from '@/lib/utils';

type LoginResponse = { accessToken: string; user: AuthUser };

/** Reliable across Next.js bundles (axios.isAxiosError can fail with duplicate packages). */
function asAxiosError(err: unknown): AxiosError<{ message?: string | string[] }> | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as AxiosError<{ message?: string | string[] }>;
  if (axios.isAxiosError(e)) return e;
  if ('response' in e || 'request' in e || 'isAxiosError' in e) return e;
  return null;
}

function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'خطأ غير متوقع';
}

export function LoginForm() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  const clearWorkspace = useWorkspaceStore((s) => s.clearWorkspace);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const username = String(fd.get('username'));
    const password = String(fd.get('password'));
    setLoading(true);
    const apiUrl = `${resolveApiBaseUrl()}/auth/login`;
    try {
      const { data, status, headers } = await api.post<LoginResponse>('/auth/login', {
        username,
        password,
      });

      const contentType = String(headers?.['content-type'] ?? '');
      if (contentType.includes('text/html') || typeof data === 'string') {
        toast.error(
          `الخادم أرجع HTML بدل JSON (${apiUrl}). تحقق من Nginx و NEXT_PUBLIC_API_URL=/api/v1 ثم أعد build.`,
        );
        return;
      }

      if (!data?.accessToken || !data?.user?.id) {
        toast.error(
          `استجابة دخول غير صالحة (${status} · ${apiUrl}). تأكد أن الـ API يعمل خلف Nginx.`,
        );
        return;
      }

      setAuth(data.accessToken, data.user);
      const allowed = WORKSPACE_IDS.filter((w) =>
        canAccessWorkspace(data.user.permissions, w, data.user.role),
      );

      if (allowed.length === 0) {
        router.replace('/access-denied?workspace=none');
        return;
      }

      toast.success('مرحباً بك');

      if (allowed.length === 1) {
        setWorkspace(allowed[0]);
        router.push(workspaceHome(allowed[0]));
        return;
      }

      clearWorkspace();
      router.push('/');
    } catch (err) {
      const ax = asAxiosError(err);
      if (ax && !ax.response) {
        toast.error(`تعذر الاتصال بالخادم (${apiUrl}). تحقق من Nginx و pm2.`);
      } else if (ax?.response?.status === 401) {
        toast.error('اسم المستخدم أو كلمة المرور غير صحيحة');
      } else if (ax?.response?.status === 404) {
        toast.error(`مسار API غير موجود (${apiUrl}) — أعد build الويب على السيرفر`);
      } else if (ax?.response?.status === 429) {
        toast.error('تم تجاوز عدد المحاولات — انتظر 15 دقيقة');
      } else if (ax && (ax.response?.status ?? 0) >= 500) {
        toast.error(`خطأ في الخادم (${ax.response?.status}) — راجع pm2 logs oilix-api`);
      } else if (ax) {
        const msg = ax.response?.data?.message;
        const status = ax.response?.status;
        if (typeof msg === 'string') toast.error(msg);
        else if (Array.isArray(msg)) toast.error(msg.join(' · '));
        else toast.error(`تعذر تسجيل الدخول (${status ?? '?'} · ${apiUrl})`);
      } else {
        toast.error(`تعذر تسجيل الدخول — ${errorText(err)} (${apiUrl})`);
        console.error('[login]', err);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="login-form-enter space-y-5">
      <Field
        id="username"
        name="username"
        label="اسم المستخدم"
        icon={User}
        autoComplete="username"
        required
        placeholder="أدخل اسم المستخدم"
      />

      <Field
        id="password"
        name="password"
        label="كلمة المرور"
        icon={Lock}
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        required
        placeholder="أدخل كلمة المرور"
        trailing={
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((v) => !v)}
            className="rounded-lg p-1.5 text-[var(--app-text-dim)] transition hover:bg-[var(--app-bg-muted)] hover:text-[var(--app-text)]"
            aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        }
      />

      <button
        type="submit"
        disabled={loading}
        className={cn(
          'login-submit-btn flex w-full items-center justify-center gap-2 rounded-[var(--app-radius-lg)] px-6 py-3.5 text-base font-bold text-white shadow-[var(--app-shadow-glow)] transition-all duration-200',
          'bg-gradient-to-l from-[var(--app-accent)] to-[var(--app-accent-dark)]',
          'hover:brightness-110 hover:shadow-[var(--app-shadow-lg)]',
          'focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] focus:ring-offset-2 focus:ring-offset-[var(--app-bg)]',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        {loading ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : (
          <>
            <LogIn className="h-5 w-5" />
            تسجيل الدخول
          </>
        )}
      </button>

      <Link
        href="/"
        className="block text-center text-sm font-bold text-[var(--app-accent)] hover:underline"
      >
        تغيير مساحة العمل
      </Link>
    </form>
  );
}

function Field({
  id,
  name,
  label,
  icon: Icon,
  type = 'text',
  trailing,
  className,
  ...props
}: {
  id: string;
  name: string;
  label: string;
  icon: React.ElementType;
  trailing?: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn('space-y-2', className)}>
      <label htmlFor={id} className="block text-sm font-semibold text-[var(--app-text-muted)]">
        {label}
      </label>
      <div className="relative">
        <Icon className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--app-accent)] opacity-70" />
        <input
          id={id}
          name={name}
          type={type}
          className={cn(
            'w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] py-3 pr-10 pl-10 text-sm text-[var(--app-text)] shadow-sm transition-all duration-200',
            'placeholder:text-[var(--app-text-dim)]',
            'hover:border-[color-mix(in_srgb,var(--app-accent)_35%,var(--app-border))]',
            'focus:border-[var(--app-accent)] focus:bg-[var(--app-surface)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--app-accent)_25%,transparent)] focus:shadow-[var(--app-shadow-md)]',
          )}
          {...props}
        />
        {trailing && (
          <div className="absolute left-2 top-1/2 -translate-y-1/2">{trailing}</div>
        )}
      </div>
    </div>
  );
}
