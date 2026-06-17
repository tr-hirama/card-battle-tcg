// ============================================================
//  テスト（依存なしの簡易ランナー）
//  tests/index.html から読み込み、ブラウザ(localhost)で実行する。
//  結果は画面と window.__TEST_RESULTS に出力。
// ============================================================

import { Game, PokemonInPlay } from '../js/engine/game.js';
import { AI } from '../js/ai/ai.js';
import { DECKS, getCard, registerLocalCards, buildAutoDeck } from '../js/data/cards.js';
import { checkUnlocked } from '../js/auth.js';
import { IMAGE_UNLOCK_HASH } from '../js/config.js';

// ---- 簡易テストフレームワーク ----
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq failed') + ` (got ${a}, want ${b})`); }

// 決定的RNG（mulberry32）
function rngFrom(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ============================================================
//  デッキ・データ
// ============================================================
test('デッキは60枚（炎/水雷）', () => {
  eq(DECKS.fire.list.length, 60, '炎デッキ枚数');
  eq(DECKS.water.list.length, 60, '水雷デッキ枚数');
});

test('全カードが getCard で引ける', () => {
  for (const id of [...DECKS.fire.list, ...DECKS.water.list]) {
    const c = getCard(id); assert(c && c.id, 'カード不正: ' + id);
  }
});

// ============================================================
//  セットアップ
// ============================================================
test('セットアップ後：サイド6・バトル場あり', () => {
  const g = new Game(DECKS.fire, DECKS.water, { rng: rngFrom(123) });
  g.start(0); g.autoSetup(0); g.autoSetup(1);
  eq(g.players[0].prizes.length, 6, 'P0サイド');
  eq(g.players[1].prizes.length, 6, 'P1サイド');
  assert(g.players[0].active, 'P0バトル場');
  assert(g.players[1].active, 'P1バトル場');
  eq(g.phase, 'main', 'フェイズ');
});

// ============================================================
//  ダメージ計算（弱点・抵抗力）
// ============================================================
test('弱点は×2（炎→草スプラウト）', () => {
  const g = new Game(DECKS.fire, DECKS.water, { rng: rngFrom(1) });
  g.players[1].active = new PokemonInPlay('sprout');     // 草・弱点炎×2
  g.dealDamageToActive(null, g.players[1], 10, 'Fire');
  eq(g.players[1].active.damage, 20, '弱点2倍');
});

test('抵抗力は-30（超→雷ボルティック）', () => {
  const g = new Game(DECKS.fire, DECKS.water, { rng: rngFrom(2) });
  g.players[1].active = new PokemonInPlay('voltik');     // 抵抗力 超-30
  g.dealDamageToActive(null, g.players[1], 50, 'Psychic');
  eq(g.players[1].active.damage, 20, '抵抗力-30');
});

test('抵抗力で0未満にならない', () => {
  const g = new Game(DECKS.fire, DECKS.water, { rng: rngFrom(3) });
  g.players[1].active = new PokemonInPlay('voltik');
  g.dealDamageToActive(null, g.players[1], 20, 'Psychic'); // 20-30 → 0
  eq(g.players[1].active.damage, 0, '下限0');
});

// ============================================================
//  ワザのエネルギーコスト（無色は任意で支払い）
// ============================================================
test('無色コストは任意エネで支払える', () => {
  const inst = new PokemonInPlay('fluffit');  // たいあたり: Colorless×2
  const g = new Game(DECKS.fire, DECKS.water, { rng: rngFrom(4) });
  const atk = getCard('fluffit').attacks[0];
  inst.energy = ['energy-fire'];
  eq(g.canUseAttack(inst, atk), false, 'エネ1では不可');
  inst.energy = ['energy-fire', 'energy-water'];
  eq(g.canUseAttack(inst, atk), true, 'エネ2で可');
});

test('色つきコストは該当タイプが必要', () => {
  const inst = new PokemonInPlay('embor');  // ひのこ: Fire×1 + Colorless×1
  const g = new Game(DECKS.fire, DECKS.water, { rng: rngFrom(5) });
  const hinoko = getCard('embor').attacks[1];
  inst.energy = ['energy-water', 'energy-water'];
  eq(g.canUseAttack(inst, hinoko), false, '炎が無いと不可');
  inst.energy = ['energy-fire', 'energy-water'];
  eq(g.canUseAttack(inst, hinoko), true, '炎+無色で可');
});

// ============================================================
//  きぜつ・サイド取り
// ============================================================
test('きぜつでサイドを取り、場から除かれる', () => {
  const g = new Game(DECKS.fire, DECKS.water, { rng: rngFrom(6) });
  g.players[0].setupDone = true; g.players[1].setupDone = true;
  g.players[0].active = new PokemonInPlay('embor');
  g.players[1].active = new PokemonInPlay('sprout');   // HP60
  g.players[1].bench = [new PokemonInPlay('embor')];
  g.players[0].prizes = Array(6).fill('energy-fire');
  g.players[1].active.damage = 60;                     // 致死
  g.turnPlayer = 0;
  g._afterDamageChecks();
  eq(g.players[0].prizes.length, 5, '攻撃側がサイドを取る');
  eq(g.players[1].active, null, 'きぜつでバトル場が空く');
});

// ============================================================
//  先攻1ターン目の制限
// ============================================================
test('先攻1ターン目はワザ不可', () => {
  const g = new Game(DECKS.fire, DECKS.water, { rng: rngFrom(7) });
  g.start(0); g.autoSetup(0); g.autoSetup(1);   // 先攻=0
  // P0のアクティブに十分なエネを乗せる
  const a = g.players[0].active;
  a.energy = ['energy-fire', 'energy-fire', 'energy-fire'];
  const res = g.useAttack(0);
  eq(res.ok, false, '先攻1T攻撃は不可');
});

// ============================================================
//  AI対AI 通し（クラッシュ無し・必ず決着）
// ============================================================
test('AI対AI 15戦：全て決着・例外なし', () => {
  for (let s = 0; s < 15; s++) {
    const g = new Game(DECKS.fire, DECKS.water, { rng: rngFrom(1000 + s) });
    g.start(); g.autoSetup(0); g.autoSetup(1);
    const ais = [new AI(g, 0), new AI(g, 1)];
    let guard = 0;
    while (g.winner == null && guard < 500) { ais[g.turnPlayer].takeTurn(); guard++; }
    assert(g.winner != null, `seed ${s}: 決着せず (guard=${guard})`);
  }
});

// ============================================================
//  パスワード錠（SHA-256）
// ============================================================
test('パスワード錠：正/誤/空', async () => {
  const orig = window.__CARD_KEY;
  window.__CARD_KEY = 'tropius-local-2026';
  eq(await checkUnlocked(), true, '既定パスワードで解錠');
  window.__CARD_KEY = 'wrong';
  eq(await checkUnlocked(), false, '誤パスワードは施錠');
  window.__CARD_KEY = '';
  eq(await checkUnlocked(), false, '空は施錠（=公開サイト相当）');
  window.__CARD_KEY = orig;
  assert(/^[0-9a-f]{64}$/.test(IMAGE_UNLOCK_HASH), 'ハッシュ形式');
});

// ============================================================
//  自動デッキ構築
// ============================================================
test('buildAutoDeck：手持ち番号から60枚', () => {
  // 仮の実カードを登録（トロピウス相当）
  registerLocalCards({
    '99001': { id: '99001', name: 'テストたね', category: 'Pokemon', type: 'Grass', hp: 110, stage: 'Basic',
      retreat: 1, attacks: [{ name: 'A', cost: { Grass: 1, Colorless: 1 }, damage: 60 }],
      weakness: { type: 'Fire', mult: 2 }, imageUrl: 'x' },
  });
  const deck = buildAutoDeck(['99001'], getCard);
  eq(deck.list.length, 60, '60枚');
  assert(deck.list.includes('99001'), '実カードを含む');
  assert(deck.list.some(id => id === 'energy-grass'), '草エネで補充');
});

// ============================================================
//  トレーナーズ効果のプリミティブ
// ============================================================
test('ボスの指令：相手ベンチを引きずり出す', () => {
  const g = new Game(DECKS.fire, DECKS.water, { rng: rngFrom(11) });
  g.players[0].setupDone = true; g.players[1].setupDone = true; g.turnPlayer = 0;
  g.players[1].active = new PokemonInPlay('aqualet');
  g.players[1].bench = [new PokemonInPlay('voltik')];
  g.gustOpponent(0);
  eq(g.players[1].active.cardId, 'voltik', 'ベンチが前へ');
  eq(g.players[1].bench[0].cardId, 'aqualet', '元バトルがベンチへ');
});

test('改造ハンマー：相手の特殊エネのみトラッシュ', () => {
  registerLocalCards({ 'sp-x': { id: 'sp-x', name: '特殊E', category: 'Energy', energyType: 'Psychic', special: true } });
  const g = new Game(DECKS.fire, DECKS.water, { rng: rngFrom(12) });
  g.turnPlayer = 0;
  const t = new PokemonInPlay('aqualet'); t.energy = ['energy-water', 'sp-x'];
  g.players[1].active = t;
  assert(g.discardSpecialEnergy(t.uid).ok, 'ok');
  eq(t.energy.length, 1, '1個に'); eq(t.energy[0], 'energy-water', '基本エネは残る');
});

test('ふしぎなアメ：たね→2進化（1進化スキップ）', () => {
  registerLocalCards({
    'tb':  { id: 'tb',  name: 'TB',  category: 'Pokemon', type: 'Psychic', hp: 50,  stage: 'Basic',  retreat: 1, attacks: [] },
    'ts1': { id: 'ts1', name: 'TS1', category: 'Pokemon', type: 'Psychic', hp: 80,  stage: 'Stage1', evolvesFrom: 'tb',  retreat: 1, attacks: [] },
    'ts2': { id: 'ts2', name: 'TS2', category: 'Pokemon', type: 'Psychic', hp: 140, stage: 'Stage2', evolvesFrom: 'ts1', retreat: 1, attacks: [] },
  });
  const g = new Game(DECKS.fire, DECKS.water, { rng: rngFrom(13) });
  g.turnPlayer = 0; g.turnCount = 2; g.phase = 'main';
  const inst = new PokemonInPlay('tb'); inst.placedTurn = 1;
  g.players[0].active = inst; g.players[0].hand = ['ts2'];
  const r = g.rareCandyEvolve('ts2', inst.uid);
  assert(r.ok, r.error || 'ok'); eq(inst.cardId, 'ts2', '2進化に'); eq(g.players[0].hand.length, 0, '手札消費');
});

test('searchDeckToBench / moveDiscardToHand', () => {
  const g = new Game(DECKS.fire, DECKS.water, { rng: rngFrom(14) });
  g.turnPlayer = 0;
  g.players[0].deck = ['embor', 'energy-fire']; g.players[0].bench = [];
  g.searchDeckToBench(['embor']);
  eq(g.players[0].bench.length, 1, 'ベンチに出る'); eq(g.players[0].bench[0].cardId, 'embor');
  g.players[0].discard = ['potion', 'aqualet']; g.players[0].hand = [];
  g.moveDiscardToHand([1]);
  eq(g.players[0].hand[0], 'aqualet', 'トラッシュ→手札'); eq(g.players[0].discard.length, 1);
});

// ============================================================
//  実行
// ============================================================
async function run() {
  const results = [];
  for (const t of tests) {
    try { await t.fn(); results.push({ name: t.name, ok: true }); }
    catch (e) { results.push({ name: t.name, ok: false, error: e.message }); }
  }
  const pass = results.filter(r => r.ok).length;
  const summary = { total: results.length, pass, fail: results.length - pass, results };
  window.__TEST_RESULTS = summary;

  // 画面出力
  const el = document.getElementById('out');
  if (el) {
    el.innerHTML = `<h2>${summary.fail === 0 ? '✅ 全テスト合格' : '❌ 失敗あり'} : ${pass}/${results.length}</h2>` +
      results.map(r => `<div class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✔' : '✘'} ${r.name}${r.error ? ' — <code>' + r.error + '</code>' : ''}</div>`).join('');
  }
  console.log('TEST SUMMARY', JSON.stringify(summary));
  return summary;
}
run();
