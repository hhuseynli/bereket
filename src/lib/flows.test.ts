// End-to-end demo script against the real flows, in offline mode (no keys needed).
import os from 'node:os';
import path from 'node:path';
// Everything below runs in its own data folder, so tests never touch the presenter's .data/.
process.env.DEMO_DATA_DIR = path.join(os.tmpdir(), `berekat-test-${process.pid}`);
process.env.DEMO_RESTORE = '0';
process.env.DEMO_STEP_MS = '0';
process.env.DEMO_RECOVERY_MS = '0';
process.env.AI_OFFLINE = '1';
process.env.ELEVENLABS_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.WHATSAPP_CHANNEL = 'simulator';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { offlineExtract, wordsToDigits } from './ai';
import { confirmProposal, confirmReceipt, director, findSupply, handleInbound, operatorApproveRecovery, rateFarmer, sendDemoVoice } from './flows';
import { getState } from './store';

test('Azerbaijani number words become digits', () => {
  assert.equal(wordsToDigits('yüz səksən kilo'), '180 kilo');
  assert.equal(wordsToDigits('iki yüz iyirmi kilo'), '220 kilo');
  assert.equal(wordsToDigits('bir manat on beş qəpikdən'), '1 manat 15 qəpikdən');
  const ex = offlineExtract('Mənim yüz səksən kilo Roma pomidorum var, birinci sortdur. Kilosunu bir manat on beş qəpikdən verirəm.', '2026-11-11T10:00:00Z');
  assert.equal(ex.qtyKg, 180);
  assert.equal(ex.priceAzn, 1.15);
  assert.equal(ex.product, 'Tomato');
  assert.equal(ex.variety, 'Roma');
  assert.equal(ex.grade, 1);
});

test('full demo: listing, match, confirm, cancel, recover, deliver, rate', async () => {
  await director('reset');
  const s = () => getState();

  // Act 1: Elşən sends a voice note and a photo
  await sendDemoVoice('elsen-listing', 'tomatoes-stage4');
  const draft = s().listings.find((l) => l.farmerId === 'f-elsen' && l.status === 'draft')!;
  assert.ok(draft, 'draft listing created');
  assert.equal(draft.qtyKg, 180);
  assert.equal(draft.priceAzn, 1.15);
  assert.equal(draft.ripeness, 4);
  const run = s().aiRuns[0];
  assert.deepEqual(run.steps.map((x) => x.status), ['done', 'done', 'done', 'done', 'done']);
  await handleInbound({ farmerId: 'f-elsen', text: '1', via: 'simulator' });
  assert.equal(draft.status, 'live');

  // Act 2: match and confirm
  await findSupply('T-1042');
  const props = s().proposals.filter((p) => p.tenderId === 'T-1042');
  assert.deepEqual(props.map((p) => p.costs.perKg), [1.33, 1.23, 1.38]);
  const orderId = confirmProposal(props[0].id);
  const order = s().orders.find((o) => o.id === orderId)!;
  assert.equal(order.allocations.filter((a) => a.status === 'offered').length, 3);
  await handleInbound({ farmerId: 'f-elsen', text: '1', via: 'simulator' });
  await director('acceptOthers');
  assert.equal(order.status, 'confirmed');

  // Act 3: Rauf cancels by voice, operator approves Səbinə, she accepts
  await director('sebineHello');
  await sendDemoVoice('rauf-cancel');
  assert.equal(order.recovery?.status, 'proposed');
  assert.equal(order.recovery!.candidates[order.recovery!.selected!].farmerId, 'f-sebine');
  operatorApproveRecovery(orderId);
  assert.equal(order.recovery?.status, 'offered');
  await handleInbound({ farmerId: 'f-sebine', text: '1', via: 'simulator' });
  assert.equal(order.recovery?.status, 'resolved');
  assert.equal(order.status, 'confirmed');
  assert.equal(order.costs.perKg, 1.35);
  assert.match(order.priceNotice ?? '', /Səbinə Kərimova now supplies 80 kg/);

  // Act 4: deliver, release, rate both ways
  await director('thursday');
  assert.equal(order.status, 'delivered');
  confirmReceipt(orderId);
  assert.equal(order.status, 'settled');
  assert.equal(order.escrow.status, 'released');
  rateFarmer(orderId, 'f-elsen', 5);
  await handleInbound({ farmerId: 'f-elsen', text: '5', via: 'simulator' });
  assert.equal(order.farmerRatings['f-elsen'], 5);
});

test('spoiled photo is held and never listed', async () => {
  await director('reset');
  await sendDemoVoice('elsen-listing', 'tomatoes-spoiled');
  const s = getState();
  assert.ok(!s.listings.some((l) => l.farmerId === 'f-elsen' && l.product === 'Tomato'));
  assert.equal(s.aiRuns[0].status, 'needs_review');
});
