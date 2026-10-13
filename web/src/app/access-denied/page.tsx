'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { Suspense } from 'react';

const MESSAGES: Record<string, { ar: string; fr: string }> = {
  none: {
    ar: 'ليس لديك صلاحية الوصول إلى أي مساحة عمل (المعصرة، بيع الزيت أو الموارد البشرية).',
    fr: "Vous n'avez accès à aucun espace de travail.",
  },
  sales: {
    ar: 'ليس لديك صلاحية الوصول إلى وحدة بيع الزيت.',
    fr: "Vous n'avez pas accès au module Vente d'huile.",
  },
  hr: {
    ar: 'ليس لديك صلاحية الوصول إلى وحدة الموارد البشرية (إدارة العمال).',
    fr: "Vous n'avez pas accès au module Ressources Humaines.",
  },
  mill: {
    ar: 'ليس لديك صلاحية الوصول إلى إدارة المعصرة.',
    fr: "Vous n'avez pas accès au module Huilerie.",
  },
};

function DeniedInner() {
  const sp = useSearchParams();
  const msg = MESSAGES[sp.get('workspace') ?? ''] ?? MESSAGES.mill;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--app-bg)] px-6 text-center">
      <ShieldAlert className="mb-4 h-14 w-14 text-red-600" />
      <h1 className="text-2xl font-black text-[var(--app-text)]">لا توجد صلاحية للدخول</h1>
      <p className="mt-3 max-w-md text-[var(--app-text-muted)]">{msg.ar}</p>
      <p className="mt-1 text-sm text-[var(--app-text-dim)]">{msg.fr}</p>
      <Link
        href="/"
        className="mt-8 rounded-xl bg-[var(--app-accent)] px-5 py-2.5 text-sm font-bold text-white"
      >
        تغيير مساحة العمل
      </Link>
    </div>
  );
}

export default function AccessDeniedPage() {
  return (
    <Suspense>
      <DeniedInner />
    </Suspense>
  );
}
