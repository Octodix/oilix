import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cartLineAssistance,
  cartLineNet,
  cartLineSubtotal,
  cartToApiItems,
  holdItemsToCartLines,
  repriceCart,
  resolveLinePrice,
  setCartLineAssistance,
  saleCustomerName,
  type CartLine,
} from './sales-cart.ts';
import { previewSaleFromLines } from './sales-math.ts';

const prices = { priceGreen: 800, priceTaieb: 1000, priceDrou: 1200, priceZebbouche: 900 };
const containers = [{ id: 'c5', unitPrice: 150 }];

function addLine(oilType: string, quantityL: number, key: string): CartLine {
  const unitPrice = resolveLinePrice({ kind: 'LOOSE', oilType }, prices, containers)!;
  return { key, kind: 'LOOSE', oilSource: 'STORED', oilType, quantityL, unitPrice };
}

describe('sales cart pricing', () => {
  it('single oil: 10 L × 800 = 8,000', () => {
    const cart = [addLine('GREEN', 10, 'a')];
    assert.equal(cartLineSubtotal(cart[0]), 8000);
    assert.equal(previewSaleFromLines(cart)?.finalAmount, 8000);
  });

  it('selecting a second oil does not reprice the first line', () => {
    const cart = [addLine('GREEN', 10, 'a'), addLine('TAIEB', 5, 'b')];
    assert.deepEqual(
      cart.map((l) => l.unitPrice),
      [800, 1000],
    );
    assert.deepEqual(cart.map(cartLineSubtotal), [8000, 5000]);
    assert.equal(previewSaleFromLines(cart)?.grossAmount, 13000);
  });

  it('three oils keep three prices', () => {
    const cart = [addLine('GREEN', 10, 'a'), addLine('TAIEB', 5, 'b'), addLine('DROU', 2, 'c')];
    assert.deepEqual(cart.map(cartLineSubtotal), [8000, 5000, 2400]);
    assert.equal(previewSaleFromLines(cart)?.grossAmount, 15400);
  });

  it('held sale restores identical lines and keeps locked prices after a catalog change', () => {
    const held = holdItemsToCartLines(
      [
        { kind: 'LOOSE', oilSource: 'STORED', oilType: 'GREEN', quantityL: 10, unitPrice: 800 },
        { kind: 'LOOSE', oilSource: 'STORED', oilType: 'TAIEB', quantityL: 5, unitPrice: 1000 },
        { kind: 'CONTAINER_ONLY', containerId: 'c5', containerCount: 2, unitPrice: 150, containerPrice: 150 },
      ],
      'h1',
    );
    const raised = { ...prices, priceGreen: 950 };
    const locks = { 'OIL:GREEN': 800, 'OIL:TAIEB': 1000, 'CNT:c5': 150 };
    const repriced = repriceCart(held, raised, containers, locks);
    assert.deepEqual(
      repriced.map((l) => l.unitPrice),
      [800, 1000, 150],
    );
    assert.equal(previewSaleFromLines(repriced)?.grossAmount, 13300);
  });

  it('unlocked lines follow the latest catalog after a server price refresh', () => {
    const cart = [addLine('GREEN', 10, 'a')];
    const repriced = repriceCart(cart, { ...prices, priceGreen: 950 }, containers);
    assert.equal(repriced[0].unitPrice, 950);
  });

  it('API payload carries each line with its own product and price', () => {
    const items = cartToApiItems([addLine('GREEN', 10, 'a'), addLine('TAIEB', 5, 'b')]);
    assert.deepEqual(
      items.map((i) => [i.oilType, i.quantityL, i.unitPrice]),
      [
        ['GREEN', 10, 800],
        ['TAIEB', 5, 1000],
      ],
    );
  });

  it('walk-in label when no customer', () => {
    assert.equal(saleCustomerName(null), 'زبون عابر');
    assert.equal(saleCustomerName({ name: 'Ali' }), 'Ali');
  });
});

describe('assistance per cart line', () => {
  it('each oil keeps its own per-litre assistance: 40 L GREEN @50 + 40 L TAIEB @30', () => {
    const green = { ...addLine('GREEN', 40, 'a'), assistancePerLitre: 50 };
    const taieb = { ...addLine('TAIEB', 40, 'b'), assistancePerLitre: 30 };
    assert.deepEqual([green, taieb].map(cartLineAssistance), [2000, 1200]);
    assert.deepEqual([green, taieb].map(cartLineNet), [30000, 38800]);
    const p = previewSaleFromLines([green, taieb]);
    assert.equal(p?.assistancePerLitreTotal, 3200);
    assert.equal(p?.totalAssistance, 3200);
    assert.equal(p?.finalAmount, 72000 - 3200);
  });

  it('adding a second oil never changes the first line assistance', () => {
    const cart = [{ ...addLine('GREEN', 40, 'a'), assistancePerLitre: 50 }];
    const before = cartLineAssistance(cart[0]);
    const withTaieb = [...cart, { ...addLine('TAIEB', 40, 'b'), assistanceFixed: 500 }];
    assert.equal(cartLineAssistance(withTaieb[0]), before);
    assert.equal(cartLineAssistance(withTaieb[1]), 500);
    assert.equal(previewSaleFromLines(withTaieb)?.totalAssistance, 2500);
  });

  it('editing one line assistance leaves the others untouched', () => {
    const cart = [
      { ...addLine('GREEN', 10, 'a'), assistancePerLitre: 50 },
      { ...addLine('TAIEB', 10, 'b'), assistancePerLitre: 30 },
    ];
    const edited = setCartLineAssistance(cart, 'b', { assistancePerLitre: 0, assistanceFixed: 150 });
    assert.deepEqual(edited.map(cartLineAssistance), [500, 150]);
  });

  it('a line assistance larger than its gross invalidates the preview', () => {
    assert.equal(
      previewSaleFromLines([{ ...addLine('GREEN', 1, 'a'), assistancePerLitre: 900 }]),
      null,
    );
  });

  it('API payload and held sales carry assistance per line', () => {
    const cart = [
      { ...addLine('GREEN', 40, 'a'), assistancePerLitre: 50 },
      { ...addLine('TAIEB', 40, 'b'), assistanceFixed: 100 },
    ];
    assert.deepEqual(
      cartToApiItems(cart).map((i) => [i.oilType, i.assistancePerLitre, i.assistanceFixed]),
      [
        ['GREEN', 50, undefined],
        ['TAIEB', undefined, 100],
      ],
    );
    const restored = holdItemsToCartLines(
      [
        { kind: 'LOOSE', oilSource: 'STORED', oilType: 'GREEN', quantityL: 40, unitPrice: 800, assistancePerLitre: 50 },
        { kind: 'LOOSE', oilSource: 'STORED', oilType: 'TAIEB', quantityL: 40, unitPrice: 1000, assistanceFixed: 100 },
      ],
      'h2',
    );
    assert.deepEqual(restored.map(cartLineAssistance), [2000, 100]);
  });
});
