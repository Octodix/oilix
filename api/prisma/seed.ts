import { Permission, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const ALL_PERMISSIONS = Object.values(Permission);

async function main() {
  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: { permissions: ALL_PERMISSIONS },
    create: {
      name: 'ADMIN',
      nameAr: 'مدير النظام',
      permissions: ALL_PERMISSIONS,
    },
  });

  const operatorPerms = [
        Permission.MILL_ACCESS,
        Permission.CLIENTS_READ,
        Permission.CLIENTS_WRITE,
        Permission.OLIVE_READ,
        Permission.OLIVE_WRITE,
        Permission.PRESSING_READ,
        Permission.PRESSING_WRITE,
        Permission.FILTRATION_READ,
        Permission.FILTRATION_WRITE,
        Permission.FINANCE_READ,
        // Recording a customer payment is part of the operator's counter work (سالك already is).
        Permission.FINANCE_WRITE,
        Permission.REPORTS_READ,
        Permission.OIL_SALES_READ,
        Permission.OIL_SALES_WRITE,
        Permission.OIL_SALES_CANCEL,
        Permission.OIL_STOCK_WRITE,
        Permission.OIL_INVENTORY_WRITE,
        Permission.OIL_CUSTOMERS_WRITE,
        Permission.OIL_SALES_ACCESS,
        Permission.OIL_SALES_DASHBOARD_VIEW,
        Permission.OIL_SALES_SALES_VIEW,
        Permission.OIL_SALES_SALES_CREATE,
        Permission.OIL_SALES_SALES_CANCEL,
        Permission.OIL_SALES_PRINT_RECEIPT,
        Permission.OIL_SALES_ASSISTANCE_FIXED,
        Permission.OIL_SALES_ASSISTANCE_PERCENT,
        Permission.OIL_SALES_ASSISTANCE_PER_LITRE,
        Permission.OIL_SALES_SALES_ALLOW_DEBT,
        Permission.OIL_SALES_DEBTS_VIEW,
        Permission.OIL_SALES_DEBTS_RECORD_PAYMENT,
        Permission.OIL_SALES_DEBTS_VIEW_ALL,
        Permission.OIL_SALES_DEBTS_EXPORT,
        Permission.OIL_SALES_STOCK_VIEW,
        Permission.OIL_SALES_STOCK_ADD,
        Permission.OIL_SALES_STOCK_LOSS,
        Permission.OIL_SALES_INVENTORY_VIEW,
        Permission.OIL_SALES_INVENTORY_CREATE,
        Permission.OIL_SALES_CUSTOMERS_VIEW,
        Permission.OIL_SALES_CUSTOMERS_CREATE,
        Permission.OIL_SALES_CUSTOMERS_EDIT,
        Permission.OIL_SALES_CONTAINERS_VIEW,
        Permission.OIL_SALES_CONTAINERS_SELL,
        Permission.OIL_SALES_CONTAINER_STOCK_VIEW,
        Permission.OIL_SALES_REPORTS_VIEW,
        Permission.OIL_SALES_CASH_REGISTER_OPEN,
        Permission.OIL_SALES_CASH_REGISTER_CLOSE,
        Permission.OIL_SALES_CASH_REGISTER_VIEW_OWN,
        Permission.OIL_SALES_DEVICES_VIEW,
        Permission.MILL_DEVICES_VIEW,
        // Operators may help the primary operator and hand over what they collected;
        // confirming a handover stays with the primary operator / admin.
        Permission.MILL_ASSIST_START,
        Permission.MILL_ASSIST_CLOSE,
        Permission.MILL_ASSIST_PRINT,
      ];

  const operatorRole = await prisma.role.upsert({
    where: { name: 'OPERATOR' },
    update: {
      permissions: operatorPerms,
    },
    create: {
      name: 'OPERATOR',
      nameAr: 'عامل',
      permissions: operatorPerms,
    },
  });

  const passwordHash = await bcrypt.hash('admin123', 12);
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash, isActive: true, deletedAt: null, roleId: adminRole.id, permissions: ALL_PERMISSIONS },
    create: {
      username: 'admin',
      email: 'admin@oilix.local',
      passwordHash,
      firstName: 'مدير',
      lastName: 'النظام',
      roleId: adminRole.id,
      permissions: ALL_PERMISSIONS,
    },
  });

  const season = await prisma.season.upsert({
    where: { id: 'seed-season-2026' },
    update: {},
    create: {
      id: 'seed-season-2026',
      name: 'موسم 2026',
      startDate: new Date('2026-01-01'),
      isActive: true,
    },
  });

  const settings = [
    { key: 'price_per_quintal', value: 250 },
    { key: 'active_season_id', value: season.id },
    { key: 'company_name', value: 'معصرة الزيتون - الصفا والمروة - المصيف' },
    { key: 'company_phone', value: '+213 555 12 34 56' },
    { key: 'company_address', value: 'حي النور، بلدية الأبيار، ولاية الجزائر — الجزائر' },
    { key: 'oil_price_green', value: 900 },
    { key: 'oil_price_taieb', value: 900 },
    { key: 'oil_receipt_header', value: '' },
    { key: 'oil_receipt_footer', value: 'شكراً لثقتكم · Oilix' },
  ];

  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    });
  }

  const packs = [
    { name: 'Bidon 2L', capacityL: 2, sortOrder: 10, sku: 'BIDON-2L', unitPrice: 80, minStock: 20 },
    { name: 'Bidon 5L', capacityL: 5, sortOrder: 20, sku: 'BIDON-5L', unitPrice: 150, minStock: 15 },
    { name: 'Bidon 30L', capacityL: 30, sortOrder: 30, sku: 'BIDON-30L', unitPrice: 500, minStock: 5 },
  ];
  for (const p of packs) {
    const existing = await prisma.oilContainer.findFirst({
      where: { name: p.name, deletedAt: null },
    });
    if (!existing) {
      await prisma.oilContainer.create({
        data: {
          name: p.name,
          capacityL: p.capacityL,
          sortOrder: p.sortOrder,
          sku: p.sku,
          unitPrice: p.unitPrice,
          minStock: p.minStock,
          isActive: true,
        },
      });
    } else {
      await prisma.oilContainer.update({
        where: { id: existing.id },
        data: {
          sku: existing.sku ?? p.sku,
          unitPrice: existing.unitPrice ?? p.unitPrice,
          minStock: existing.minStock || p.minStock,
        },
      });
    }
  }

  const registers = [
    { code: 'CAISSE-01', name: 'صندوق البيع 1', sortOrder: 10 },
    { code: 'CAISSE-02', name: 'صندوق البيع 2', sortOrder: 20 },
    { code: 'CAISSE-03', name: 'صندوق البيع 3', sortOrder: 30 },
  ];
  for (const r of registers) {
    await prisma.cashRegister.upsert({
      where: { code: r.code },
      update: { name: r.name, isActive: true, sortOrder: r.sortOrder },
      create: r,
    });
  }

  console.log('Seed OK — admin / admin123');
  console.log('Roles:', adminRole.name, operatorRole.name);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
