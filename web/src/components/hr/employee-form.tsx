'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  apiError,
  DepartmentSelect,
  Modal,
  Select,
  TextArea,
  TextInput,
  useCan,
  useHrMeta,
} from '@/components/hr/hr-ui';
import { api } from '@/lib/api';
import { EMPLOYEE_STATUS, label, todayKeyDz } from '@/lib/hr-labels';

export type EmployeeDetail = {
  id: string;
  matricule: string;
  firstName: string;
  lastName: string;
  photo: string | null;
  birthDate: string | null;
  phone: string | null;
  address: string | null;
  nationalIdNumber: string | null;
  nationalIdIssuedAt: string | null;
  nationalIdIssuedBy: string | null;
  socialSecurityNumber: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  jobTitle: string | null;
  departmentId: string | null;
  workSite: string | null;
  hireDate: string;
  status: string;
  leftAt: string | null;
  leftReason: string | null;
  paymentMethod: string;
  bankAccount: string | null;
  userId: string | null;
  notes: string | null;
  archivedAt: string | null;
};

type FormState = Record<
  | 'matricule' | 'firstName' | 'lastName' | 'birthDate' | 'phone' | 'address' | 'nationalIdNumber' | 'nationalIdIssuedAt'
  | 'nationalIdIssuedBy' | 'socialSecurityNumber' | 'emergencyContactName' | 'emergencyContactPhone' | 'emergencyContactRelation'
  | 'jobTitle' | 'departmentId' | 'workSite' | 'hireDate' | 'status' | 'leftAt' | 'leftReason' | 'paymentMethod' | 'bankAccount'
  | 'userId' | 'notes',
  string
>;

const TEXT_KEYS: (keyof FormState)[] = [
  'birthDate', 'phone', 'address', 'nationalIdNumber', 'nationalIdIssuedAt', 'nationalIdIssuedBy', 'socialSecurityNumber',
  'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'jobTitle', 'departmentId', 'workSite', 'userId', 'notes',
];

function toForm(e?: EmployeeDetail | null): FormState {
  return {
    matricule: e?.matricule ?? '',
    firstName: e?.firstName ?? '',
    lastName: e?.lastName ?? '',
    birthDate: e?.birthDate ?? '',
    phone: e?.phone ?? '',
    address: e?.address ?? '',
    nationalIdNumber: e?.nationalIdNumber ?? '',
    nationalIdIssuedAt: e?.nationalIdIssuedAt ?? '',
    nationalIdIssuedBy: e?.nationalIdIssuedBy ?? '',
    socialSecurityNumber: e?.socialSecurityNumber ?? '',
    emergencyContactName: e?.emergencyContactName ?? '',
    emergencyContactPhone: e?.emergencyContactPhone ?? '',
    emergencyContactRelation: e?.emergencyContactRelation ?? '',
    jobTitle: e?.jobTitle ?? '',
    departmentId: e?.departmentId ?? '',
    workSite: e?.workSite ?? '',
    hireDate: e?.hireDate ?? todayKeyDz(),
    status: e?.status ?? 'ACTIVE',
    leftAt: e?.leftAt ?? '',
    leftReason: e?.leftReason ?? '',
    paymentMethod: e?.paymentMethod ?? 'CASH',
    bankAccount: e?.bankAccount ?? '',
    userId: e?.userId ?? '',
    notes: e?.notes ?? '',
  };
}

/** Downscales a photo so the stored data URL stays well under the API limit (400k chars). */
async function resizePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image'));
      i.src = url;
    });
    const max = 360;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function EmployeeFormModal({
  open,
  onClose,
  employee,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  employee?: EmployeeDetail | null;
  onSaved?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const can = useCan();
  const meta = useHrMeta();
  const editing = !!employee;
  const [f, setF] = useState<FormState>(() => toForm(employee));
  const [photo, setPhoto] = useState<string | null>(employee?.photo ?? null);
  const [seed, setSeed] = useState<string | null>(null);
  const key = `${employee?.id ?? 'new'}:${open}`;
  if (open && seed !== key) {
    setSeed(key);
    setF(toForm(employee));
    setPhoto(employee?.photo ?? null);
  }

  const usersQ = useQuery({
    queryKey: ['hr', 'linkable-users'],
    enabled: open,
    queryFn: async () =>
      (await api.get<{ id: string; username: string; firstName: string | null; lastName: string | null }[]>('/hr/employees/linkable-users')).data,
  });

  const canBank = can('HR_SALARIES_EDIT');
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const payload = useMemo(() => {
    const base = toForm(employee);
    const body: Record<string, unknown> = {};
    const changed = (k: keyof FormState) => !editing || f[k] !== base[k];
    if (changed('firstName')) body.firstName = f.firstName.trim();
    if (changed('lastName')) body.lastName = f.lastName.trim();
    if (changed('hireDate')) body.hireDate = f.hireDate;
    if (!editing && f.matricule.trim()) body.matricule = f.matricule.trim();
    for (const k of TEXT_KEYS) if (changed(k)) body[k] = f[k].trim() || null;
    if (changed('paymentMethod')) body.paymentMethod = f.paymentMethod;
    if (canBank && changed('bankAccount') && f.bankAccount !== '••••') body.bankAccount = f.bankAccount.trim() || null;
    if ((employee?.photo ?? null) !== photo) body.photo = photo;
    if (editing && f.status !== base.status) {
      body.status = f.status;
      if (f.status === 'LEFT') {
        body.leftAt = f.leftAt || null;
        body.leftReason = f.leftReason.trim() || null;
      }
    }
    return body;
  }, [f, photo, employee, editing, canBank]);

  const save = useMutation({
    mutationFn: async () =>
      editing
        ? (await api.patch<EmployeeDetail>(`/hr/employees/${employee!.id}`, payload)).data
        : (await api.post<EmployeeDetail>('/hr/employees', payload)).data,
    onSuccess: (row) => {
      toast.success(editing ? 'تم حفظ التعديلات' : `تمت إضافة العامل ${row.matricule}`);
      qc.invalidateQueries({ queryKey: ['hr'] });
      onSaved?.(row.id);
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const leaving = editing && f.status === 'LEFT' && employee?.status !== 'LEFT';
  const valid = f.firstName.trim() && f.lastName.trim() && f.hireDate && (!leaving || f.leftAt);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? `تعديل ${employee?.lastName} ${employee?.firstName} · Modifier` : 'عامل جديد · Nouvel employé'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!valid || (editing && Object.keys(payload).length === 0)} loading={save.isPending} onClick={() => save.mutate()}>
            حفظ
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg-muted)]">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" className="h-full w-full object-cover" />
            ) : (
              <Camera className="h-8 w-8 opacity-40" />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--app-border)] px-3 py-2 text-sm font-bold hover:bg-[var(--app-bg-muted)]">
              <Camera className="h-4 w-4" />
              صورة · Photo
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  try {
                    setPhoto(await resizePhoto(file));
                  } catch {
                    toast.error('تعذرت قراءة الصورة');
                  }
                }}
              />
            </label>
            {photo ? (
              <Button variant="ghost" size="sm" onClick={() => setPhoto(null)}>
                <Trash2 className="h-4 w-4" />
                حذف الصورة
              </Button>
            ) : null}
          </div>
        </div>

        <Section title="الهوية · Identité">
          <TextInput label="اللقب · Nom *" value={f.lastName} onChange={set('lastName')} maxLength={80} />
          <TextInput label="الاسم · Prénom *" value={f.firstName} onChange={set('firstName')} maxLength={80} />
          {editing ? (
            <TextInput label="رقم التسجيل · Matricule" value={f.matricule} disabled />
          ) : (
            <TextInput
              label="رقم التسجيل · Matricule"
              value={f.matricule}
              onChange={set('matricule')}
              placeholder="تلقائي (EMP-0001)"
              maxLength={30}
            />
          )}
          <TextInput label="تاريخ الميلاد · Date de naissance" type="date" value={f.birthDate} onChange={set('birthDate')} />
          <TextInput label="الهاتف · Téléphone" value={f.phone} onChange={set('phone')} dir="ltr" maxLength={30} />
          <TextInput label="العنوان · Adresse" value={f.address} onChange={set('address')} maxLength={300} />
          <TextInput label="رقم بطاقة التعريف · N° CNI" value={f.nationalIdNumber} onChange={set('nationalIdNumber')} dir="ltr" maxLength={40} />
          <TextInput label="تاريخ الإصدار · Délivrée le" type="date" value={f.nationalIdIssuedAt} onChange={set('nationalIdIssuedAt')} />
          <TextInput label="جهة الإصدار · Délivrée par" value={f.nationalIdIssuedBy} onChange={set('nationalIdIssuedBy')} maxLength={100} />
          <TextInput label="رقم الضمان الاجتماعي · N° sécurité sociale" value={f.socialSecurityNumber} onChange={set('socialSecurityNumber')} dir="ltr" maxLength={40} />
        </Section>

        <Section title="الاتصال في حالة الطوارئ · Contact d'urgence">
          <TextInput label="الاسم · Nom" value={f.emergencyContactName} onChange={set('emergencyContactName')} maxLength={100} />
          <TextInput label="الهاتف · Téléphone" value={f.emergencyContactPhone} onChange={set('emergencyContactPhone')} dir="ltr" maxLength={30} />
          <TextInput label="صلة القرابة · Lien" value={f.emergencyContactRelation} onChange={set('emergencyContactRelation')} maxLength={50} />
        </Section>

        <Section title="العمل · Poste">
          <TextInput label="المنصب · Poste" value={f.jobTitle} onChange={set('jobTitle')} maxLength={100} />
          <DepartmentSelect value={f.departmentId} onChange={(v) => setF((s) => ({ ...s, departmentId: v }))} allowAll={false} />
          <Select label="موقع العمل · Site" value={f.workSite} onChange={set('workSite')}>
            <option value="">—</option>
            {(meta.data?.workSites ?? []).concat(f.workSite && !(meta.data?.workSites ?? []).includes(f.workSite) ? [f.workSite] : []).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
          <TextInput label="تاريخ التوظيف · Date d'embauche *" type="date" value={f.hireDate} onChange={set('hireDate')} />
          <Select label="طريقة دفع الأجر · Paiement du salaire" value={f.paymentMethod} onChange={set('paymentMethod')}>
            {(meta.data?.employeePaymentMethods ?? ['CASH', 'BANK_TRANSFER', 'CCP', 'CHEQUE']).map((m) => (
              <option key={m} value={m}>
                {label.payment(m).ar} · {label.payment(m).fr}
              </option>
            ))}
          </Select>
          <TextInput
            label="الحساب البنكي / CCP · RIB"
            value={f.bankAccount}
            onChange={set('bankAccount')}
            dir="ltr"
            maxLength={60}
            disabled={!canBank}
            hint={canBank ? undefined : 'يتطلب صلاحية تعديل الرواتب'}
          />
          <Select label="حساب مستخدم Oilix · Compte utilisateur" value={f.userId} onChange={set('userId')}>
            <option value="">— بدون —</option>
            {employee?.userId && !(usersQ.data ?? []).some((u) => u.id === employee.userId) ? (
              <option value={employee.userId}>الحساب الحالي</option>
            ) : null}
            {(usersQ.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
                {u.firstName ? ` — ${u.firstName} ${u.lastName ?? ''}` : ''}
              </option>
            ))}
          </Select>
        </Section>

        {editing ? (
          <Section title="الحالة · Statut">
            <Select label="الحالة" value={f.status} onChange={set('status')}>
              {Object.keys(EMPLOYEE_STATUS).map((s) => (
                <option key={s} value={s}>
                  {label.employee(s).ar} · {label.employee(s).fr}
                </option>
              ))}
            </Select>
            {f.status === 'LEFT' ? (
              <>
                <TextInput label="تاريخ المغادرة · Date de sortie *" type="date" value={f.leftAt} onChange={set('leftAt')} />
                <TextInput label="سبب المغادرة · Motif" value={f.leftReason} onChange={set('leftReason')} maxLength={500} />
              </>
            ) : null}
            {leaving ? (
              <p className="text-xs text-amber-700 sm:col-span-3">
                عند تسجيل المغادرة تُنهى العقود السارية بتاريخ المغادرة تلقائياً.
              </p>
            ) : null}
          </Section>
        ) : null}

        <TextArea label="ملاحظات · Notes" value={f.notes} onChange={set('notes')} maxLength={2000} />
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-black text-sky-800 dark:text-sky-300">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-3">{children}</div>
    </fieldset>
  );
}
