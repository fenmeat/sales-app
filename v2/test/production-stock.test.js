import test from 'node:test';
import assert from 'node:assert/strict';
import {productionStockBalance} from '../src/production.js';

test('closing physical stock uses actual output, not a plan or future route demand',()=>{
 const item={stock:8,actual:27,pack_plan:40,demand:21};
 const before=structuredClone(item);
 assert.deepEqual(productionStockBalance(item),{opening:8,produced:27,closing:35});
 assert.deepEqual(item,before);
 assert.equal(productionStockBalance({...item,pack_plan:100,demand:999}).closing,35);
});

test('unknown or invalid counts never create a false closing stock; zero is explicit',()=>{
 for(const invalid of [null,undefined,'',NaN,Infinity,-1,100001,0.0001]){
  assert.equal(productionStockBalance({stock:8,actual:invalid}).closing,null);
  assert.equal(productionStockBalance({stock:invalid,actual:27}).closing,null);
 }
 assert.deepEqual(productionStockBalance({stock:8,actual:0}),{opening:8,produced:0,closing:8});
 assert.deepEqual(productionStockBalance({stock:0,actual:0}),{opening:0,produced:0,closing:0});
});

test('closing stock keeps allowed decimal precision and does not cap two valid counts',()=>{
 assert.equal(productionStockBalance({stock:0.1,actual:0.2}).closing,0.3);
 assert.equal(productionStockBalance({stock:8.125,actual:27.375}).closing,35.5);
 assert.equal(productionStockBalance({stock:100000,actual:100000}).closing,200000);
});
