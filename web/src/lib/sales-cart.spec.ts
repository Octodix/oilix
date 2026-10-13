import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cartLineSubtotal,
  cartToApiItems,
  holdItemsToCartLines,
  repriceCart,
  resolveLinePrice,
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
