'use client';

import { PERMISSION_MATRIX } from '@/lib/permission-catalog';
import { cn } from '@/lib/utils';

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

export function PermissionMatrix({ value, onChange, disabled }: Props) {
  const mill = PERMISSION_MATRIX.filter((g) => g.workspace === 'mill');
  const sales = PERMISSION_MATRIX.filter((g) => g.workspace === 'sales');
  const hr = PERMISSION_MATRIX.filter((g) => g.workspace === 'hr');

  function toggle(key: string) {
    if (disabled) return;
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  }

  function setGroup(keys: string[], on: boolean) {
    if (disabled) return;
    const rest = value.filter((k) => !keys.includes(k));
    onChange(on ? [...rest, ...keys] : rest);
  }

  return (
    <div className="space-y-5">
      <WorkspaceBlock title="المعصرة" groups={mill} value={value} toggle={toggle} setGroup={setGroup} disabled={disabled} />
      <WorkspaceBlock title="بيع الزيت" groups={sales} value={value} toggle={toggle} setGroup={setGroup} disabled={disabled} />
      <WorkspaceBlock title="الموارد البشرية · RH" groups={hr} value={value} toggle={toggle} setGroup={setGroup} disabled={disabled} />
    </div>
  );
}

function WorkspaceBlock({
  title,
  groups,
  value,
  toggle,
  setGroup,
  disabled,
}: {
  title: string;
  groups: typeof PERMISSION_MATRIX;
  value: string[];
  toggle: (key: string) => void;
  setGroup: (keys: string[], on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-black text-[var(--app-text)]">{title}</h3>
      <div className="space-y-2">
        {groups.map((g) => {
          const keys = g.actions.map((a) => a.key);
          const allOn = keys.every((k) => value.includes(k));
          return (
            <div key={g.section} className="rounded-xl border border-[var(--app-border)] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-bold">{g.sectionAr}</p>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setGroup(keys, !allOn)}
                  className="text-[11px] font-bold text-[var(--app-accent)] disabled:opacity-40"
                >
                  {allOn ? 'إلغاء الكل' : 'تحديد الكل'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.actions.map((a) => {
                  const on = value.includes(a.key);
                  return (
                    <button
                      key={a.key}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggle(a.key)}
                      className={cn(
                        'rounded-lg border px-2.5 py-1 text-xs font-bold transition',
                        on
                          ? 'border-emerald-700 bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200'
                          : 'border-[var(--app-border)] text-[var(--app-text-muted)]',
                        disabled && 'opacity-50',
                      )}
                    >
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
