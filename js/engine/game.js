// ============================================================
//  ゲームエンジン（状態管理＋ルール）
//  UIから独立。すべての操作はメソッド経由で行い、{ok,error}を返す。
//  状態が変わるたび log にメッセージを積み、onChange を呼ぶ。
// ============================================================

import { getCard } from '../data/cards.js';
import { applyAttackEffect, applyTrainerEffect } from './effects.js';

let _uid = 1;
const nextUid = () => 'p' + (_uid++);

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 場のポケモン1体（インスタンス）
export class PokemonInPlay {
  constructor(cardId) {
    this.uid = nextUid();
    this.cardId = cardId;       // 一番上のカード
    this.stack = [cardId];      // 進化スタック（下から）
    this.damage = 0;            // 乗っているダメージ
    this.energy = [];           // ついているエネルギーカードid配列
    this.tools = [];            // 道具（v1未使用）
    this.status = new Set();    // 'asleep','paralyzed','confused','poisoned','burned'
    this.placedTurn = -1;       // 場に出た（進化含む）ターン
    this.evolvedTurn = -1;      // 直近で進化したターン
    this.abilityUsedTurn = -1;  // 起動特性を使ったターン（1ターン1回制限）
  }
  get card() { return getCard(this.cardId); }
  get maxHp() { return this.card.hp; }
  get currentHp() { return this.maxHp - this.damage; }
  get isKnockedOut() { return this.damage >= this.maxHp; }
  energyCount(type) {
    return this.energy.filter(eid => {
      const e = getCard(eid);
      return type ? e.energyType === type : true;
    }).length;
  }
}

function makePlayer(name, deckIds, isAI) {
  return {
    name, isAI,
    deck: deckIds.slice(),
    hand: [],
    discard: [],
    lostZone: [],
    prizes: [],
    active: null,        // PokemonInPlay
    bench: [],           // PokemonInPlay[]（最大5）
    setupDone: false,
  };
}

export const BENCH_MAX = 5;
export const PRIZE_COUNT = 6;

// 手動で起動できる特性（名前ベース）。誘発/継続はここに含めない。
export const ACTIVATED_ABILITIES = { 'にげあしドロー': 1, 'さかてにとる': 1 };

export class Game {
  constructor(deck1, deck2, { rng } = {}) {
    this.rng = rng || Math.random;
    this.players = [
      makePlayer('あなた', deck1.list, false),
      makePlayer('あいて', deck2.list, true),
    ];
    this.fillEnergy = [deck1.fill, deck2.fill];
    this.turnPlayer = 0;
    this.firstPlayer = 0;
    this.phase = 'init';
    this.turnCount = 0;
    this.log = [];
    this.winner = null;          // 0 | 1 | null
    this.winReason = '';
    this.awaitingStartDraw = false; // 昇格待ちでターン開始ドローを保留中か
    this.stadium = null;            // 場のスタジアム { id, owner } | null
    this._koLastTurnSnapshot = [false, false]; // 直前のターンにきぜつしたか
    this.onChange = () => {};
    this.onLog = () => {};
    this.pendingCoin = null;     // {label, resolve} UI用
    // ターン内フラグ
    this._resetTurnFlags();
  }

  _resetTurnFlags() {
    this.energyAttached = false;
    this.supporterPlayed = false;
    this.hasAttacked = false;
    this.retreatedThisTurn = false;
    this.stadiumPlayed = false;
    this._koThisTurn = [false, false]; // このターン中にきぜつしたか（さかてにとる用）
  }

  emit(msg) {
    if (msg) { this.log.push(msg); this.onLog(msg); }
    this.onChange();
  }

  cur() { return this.players[this.turnPlayer]; }
  opp() { return this.players[1 - this.turnPlayer]; }
  player(i) { return this.players[i]; }

  // ---- コイン ----
  flip() { return this.rng() < 0.5 ? 'heads' : 'tails'; }

  // ============================================================
  //  セットアップ
  // ============================================================
  start(firstPlayer = null) {
    this.firstPlayer = firstPlayer == null ? (this.rng() < 0.5 ? 0 : 1) : firstPlayer;
    this.turnPlayer = this.firstPlayer;
    // 各プレイヤー：シャッフル → 7枚 → たねがいなければマリガン
    for (let i = 0; i < 2; i++) {
      const p = this.players[i];
      let tries = 0;
      do {
        p.deck = [...p.deck, ...p.hand];
        p.hand = [];
        p.deck = shuffle(p.deck, this.rng);
        p.hand = p.deck.splice(0, 7);
        tries++;
      } while (!this._hasBasic(p.hand) && tries < 50);
    }
    this.phase = 'setup';
    this.emit('対戦開始。たねポケモンをバトル場に置いてください。');
    // AI側はセットアップ自動。人間側はUIで selectActiveForSetup を呼ぶ。
  }

  _hasBasic(handIds) {
    return handIds.some(id => {
      const c = getCard(id);
      return c.category === 'Pokemon' && c.stage === 'Basic';
    });
  }

  // 人間のセットアップ：activeとbenchをhandのindexで指定
  doSetup(playerIndex, activeHandIndex, benchHandIndexes = []) {
    const p = this.players[playerIndex];
    if (p.setupDone) return { ok: false, error: 'すでにセットアップ済み' };
    const aId = p.hand[activeHandIndex];
    if (!aId || getCard(aId).stage !== 'Basic') return { ok: false, error: 'たねポケモンを選んでください' };

    // 取り出すindexを降順で処理
    const idxs = [activeHandIndex, ...benchHandIndexes];
    const picks = idxs.map(i => p.hand[i]);
    // bench検証
    for (let k = 1; k < picks.length; k++) {
      if (getCard(picks[k]).stage !== 'Basic') return { ok: false, error: 'ベンチにはたねポケモンのみ' };
    }
    if (picks.length - 1 > BENCH_MAX) return { ok: false, error: 'ベンチは最大5匹' };

    // handから除去（降順）
    [...idxs].sort((a, b) => b - a).forEach(i => p.hand.splice(i, 1));

    p.active = new PokemonInPlay(picks[0]);
    p.active.placedTurn = 0;
    p.bench = picks.slice(1).map(id => { const x = new PokemonInPlay(id); x.placedTurn = 0; return x; });
    p.setupDone = true;
    this.emit(`${p.name} はバトルポケモンを配置しました。`);
    this._maybeFinishSetup();
    return { ok: true };
  }

  // AIや自動セットアップ
  autoSetup(playerIndex) {
    const p = this.players[playerIndex];
    if (p.setupDone) return;
    const basics = p.hand.map((id, i) => ({ id, i })).filter(x => getCard(x.id).stage === 'Basic');
    // active = 最もHPが高いたね
    basics.sort((a, b) => getCard(b.id).hp - getCard(a.id).hp);
    const active = basics[0];
    const bench = basics.slice(1, 1 + BENCH_MAX).map(x => x.i);
    this.doSetup(playerIndex, active.i, bench);
  }

  _maybeFinishSetup() {
    if (this.players[0].setupDone && this.players[1].setupDone) {
      // サイドを6枚ずつ置く
      for (const p of this.players) {
        p.prizes = p.deck.splice(0, PRIZE_COUNT);
      }
      this.phase = 'main';
      this.turnCount = 1;
      this._resetTurnFlags();
      this.emit(`セットアップ完了。${this.players[this.turnPlayer].name} の番です。`);
      // 先攻最初のターンはドローなし＆ワザ不可（現行ルール）
      this._startTurnDraw(true);
    }
  }

  _startTurnDraw(isVeryFirstTurn) {
    const p = this.cur();
    // 先攻1ターン目はドローしない
    if (!(isVeryFirstTurn && this.turnPlayer === this.firstPlayer && this.turnCount === 1)) {
      const drawn = this._draw(this.turnPlayer, 1);
      if (drawn === 0) { this._loseByDeckout(this.turnPlayer); return; }
    }
    this.emit(`${p.name} の番。`);
  }

  _draw(playerIndex, n) {
    const p = this.players[playerIndex];
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (p.deck.length === 0) break;
      p.hand.push(p.deck.shift());
      count++;
    }
    return count;
  }

  // ============================================================
  //  メインフェイズの操作
  // ============================================================

  _checkMain() {
    if (this.phase !== 'main') return '今は操作できません';
    if (this.winner != null) return 'ゲームは終了しています';
    return null;
  }

  // たねポケモンをベンチに出す
  playBasicToBench(handIndex) {
    const err = this._checkMain(); if (err) return { ok: false, error: err };
    const p = this.cur();
    const id = p.hand[handIndex];
    const c = id && getCard(id);
    if (!c || c.category !== 'Pokemon' || c.stage !== 'Basic') return { ok: false, error: 'たねポケモンではありません' };
    if (p.bench.length >= BENCH_MAX) return { ok: false, error: 'ベンチがいっぱいです' };
    p.hand.splice(handIndex, 1);
    const inst = new PokemonInPlay(id);
    inst.placedTurn = this.turnCount;
    p.bench.push(inst);
    this.emit(`${p.name} は ${c.name} をベンチに出した。`);
    return { ok: true };
  }

  // 進化：手札の進化カード handIndex を 場のポケモン targetUid に進化
  evolve(handIndex, targetUid) {
    const err = this._checkMain(); if (err) return { ok: false, error: err };
    const p = this.cur();
    const id = p.hand[handIndex];
    const c = id && getCard(id);
    if (!c || c.category !== 'Pokemon' || c.stage === 'Basic') return { ok: false, error: '進化カードではありません' };
    const target = this._findInPlay(p, targetUid);
    if (!target) return { ok: false, error: '対象がいません' };
    if (target.cardId !== c.evolvesFrom) return { ok: false, error: `${c.evolvesFrom ? getCard(c.evolvesFrom).name : '？'} からしか進化できません` };
    if (target.placedTurn === this.turnCount || target.evolvedTurn === this.turnCount) return { ok: false, error: 'このターンに出した/進化したポケモンは進化できません' };

    p.hand.splice(handIndex, 1);
    target.stack.push(id);
    target.cardId = id;
    target.evolvedTurn = this.turnCount;
    // 進化で特殊状態は回復する
    target.status.delete('asleep');
    target.status.delete('confused');
    target.status.delete('paralyzed');
    target.status.delete('poisoned');
    target.status.delete('burned');
    this.emit(`${p.name} は ${c.name} に進化させた。`);
    this._triggerOnEvolve(target);
    return { ok: true };
  }

  // エネルギーをつける（1ターン1回）
  attachEnergy(handIndex, targetUid) {
    const err = this._checkMain(); if (err) return { ok: false, error: err };
    if (this.energyAttached) return { ok: false, error: 'このターンはもうエネルギーをつけました' };
    const p = this.cur();
    const id = p.hand[handIndex];
    const c = id && getCard(id);
    if (!c || c.category !== 'Energy') return { ok: false, error: 'エネルギーカードではありません' };
    const target = this._findInPlay(p, targetUid);
    if (!target) return { ok: false, error: '対象がいません' };
    p.hand.splice(handIndex, 1);
    target.energy.push(id);
    this.energyAttached = true;
    this.emit(`${p.name} は ${target.card.name} に ${c.name} をつけた。`);
    return { ok: true };
  }

  // トレーナーを使う
  playTrainer(handIndex, opts = {}) {
    const err = this._checkMain(); if (err) return { ok: false, error: err };
    const p = this.cur();
    const id = p.hand[handIndex];
    const c = id && getCard(id);
    if (!c || c.category !== 'Trainer') return { ok: false, error: 'トレーナーズではありません' };
    if (c.trainerType === 'Supporter' && this.supporterPlayed) return { ok: false, error: 'サポートはこのターンもう使いました' };
    if (c.trainerType === 'Supporter' && this.turnCount === 1 && this.turnPlayer === this.firstPlayer)
      return { ok: false, error: '先攻1ターン目はサポートを使えません' };

    const res = applyTrainerEffect(this, p, c, opts);
    if (!res.ok) return res;
    // 成功したら手札から除去してトラッシュ
    const hi = p.hand.indexOf(id);
    if (hi >= 0) p.hand.splice(hi, 1);
    p.discard.push(id);
    if (c.trainerType === 'Supporter') this.supporterPlayed = true;
    this.emit(`${p.name} は ${c.name} を使った。`);
    return { ok: true };
  }

  // にげる（1ターン1回）
  retreat(benchIndex) {
    const err = this._checkMain(); if (err) return { ok: false, error: err };
    if (this.retreatedThisTurn) return { ok: false, error: 'このターンはもう にげました' };
    const p = this.cur();
    if (!p.active) return { ok: false, error: 'バトルポケモンがいません' };
    if (p.active.status.has('asleep') || p.active.status.has('paralyzed'))
      return { ok: false, error: 'ねむり/マヒ中はにげられません' };
    const cost = p.active.card.retreat || 0;
    if (p.active.energy.length < cost) return { ok: false, error: 'にげるエネルギーが足りません' };
    const target = p.bench[benchIndex];
    if (!target) return { ok: false, error: '入れ替え先を選んでください' };

    // エネルギーをcost個トラッシュ
    for (let i = 0; i < cost; i++) p.discard.push(p.active.energy.shift());
    // 特殊状態を消す
    p.active.status.clear();
    // 入れ替え
    const old = p.active;
    p.active = target;
    p.bench.splice(benchIndex, 1);
    p.bench.push(old);
    this.retreatedThisTurn = true;
    this.emit(`${p.name} は ${old.card.name} を引っ込め ${p.active.card.name} を出した。`);
    return { ok: true };
  }

  // ============================================================
  //  実カードのトレーナーズ用プリミティブ（効果ごとの状態変更）
  //  検証→ピック（UI/コントローラ側）→ここで状態変更→consumeTrainerById
  // ============================================================
  canPlayTrainer(card) {
    const err = this._checkMain(); if (err) return { ok: false, error: err };
    if (card.trainerType === 'Supporter') {
      if (this.supporterPlayed) return { ok: false, error: 'サポートはこのターンもう使いました' };
      if (this.turnCount === 1 && this.turnPlayer === this.firstPlayer)
        return { ok: false, error: '先攻1ターン目はサポートを使えません' };
    }
    return { ok: true };
  }
  consumeTrainerById(id) {
    const p = this.cur(); const i = p.hand.indexOf(id);
    if (i < 0) return { ok: false, error: 'カードがありません' };
    const c = getCard(id);
    p.hand.splice(i, 1); p.discard.push(id);
    if (c.trainerType === 'Supporter') this.supporterPlayed = true;
    this.emit(`${p.name} は ${c.name} を使った。`);
    return { ok: true };
  }
  _shuffleDeck(pi) {
    const a = this.players[pi].deck;
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  }

  // ボスの指令：相手のベンチをバトル場に
  gustOpponent(benchIndex) {
    const opp = this.opp(); const t = opp.bench[benchIndex];
    if (!t) return { ok: false, error: '対象がいません' };
    const old = opp.active; if (old) old.status.clear();
    opp.active = t; opp.bench.splice(benchIndex, 1); if (old) opp.bench.push(old);
    this.emit(`${this.cur().name} は ${opp.name} の ${opp.active.card.name} をバトル場に引きずり出した。`);
    return { ok: true };
  }
  // 改造ハンマー：相手の特殊エネを1個トラッシュ
  discardSpecialEnergy(targetUid) {
    const opp = this.opp(); const t = this._findInPlay(opp, targetUid);
    if (!t) return { ok: false, error: '対象がいません' };
    const i = t.energy.findIndex(eid => getCard(eid).special);
    if (i < 0) return { ok: false, error: '特殊エネルギーがついていません' };
    opp.discard.push(t.energy.splice(i, 1)[0]);
    this.emit(`${this.cur().name} は ${t.card.name} の特殊エネルギーをトラッシュした。`);
    return { ok: true };
  }
  // 山札から手札へ（id配列）
  searchDeckToHand(ids) {
    const p = this.cur();
    for (const id of ids) { const i = p.deck.indexOf(id); if (i >= 0) p.hand.push(p.deck.splice(i, 1)[0]); }
    this._shuffleDeck(this.turnPlayer);
    this.emit(`${p.name} は山札から${ids.length}枚を手札に加えた。`);
    return { ok: true };
  }
  // 山札からベンチへ（id配列）
  searchDeckToBench(ids) {
    const p = this.cur(); let added = 0;
    for (const id of ids) {
      if (p.bench.length >= BENCH_MAX) break;
      const i = p.deck.indexOf(id);
      if (i >= 0) { const inst = new PokemonInPlay(p.deck.splice(i, 1)[0]); inst.placedTurn = this.turnCount; p.bench.push(inst); added++; }
    }
    this._shuffleDeck(this.turnPlayer);
    this.emit(`${p.name} は山札から${added}匹をベンチに出した。`);
    return { ok: true };
  }
  // トラッシュ→手札 / 山札（discardのindex配列）
  moveDiscardToHand(indexes) {
    const p = this.cur(); const taken = [];
    [...indexes].sort((a, b) => b - a).forEach(i => { if (p.discard[i] != null) taken.push(p.discard.splice(i, 1)[0]); });
    p.hand.push(...taken);
    this.emit(`${p.name} はトラッシュから${taken.length}枚を手札に加えた。`);
    return { ok: true };
  }
  moveDiscardToDeck(indexes) {
    const p = this.cur(); const taken = [];
    [...indexes].sort((a, b) => b - a).forEach(i => { if (p.discard[i] != null) taken.push(p.discard.splice(i, 1)[0]); });
    p.deck.push(...taken); this._shuffleDeck(this.turnPlayer);
    this.emit(`${p.name} はトラッシュから${taken.length}枚を山札にもどした。`);
    return { ok: true };
  }
  // ワンダーパッチ：トラッシュの基本エネをベンチにつける
  attachEnergyFromDiscard(discardIndex, targetUid) {
    const p = this.cur(); const id = p.discard[discardIndex]; const c = id && getCard(id);
    if (!c || c.category !== 'Energy') return { ok: false, error: 'エネルギーを選んでください' };
    const t = this._findInPlay(p, targetUid); if (!t) return { ok: false, error: '対象がいません' };
    p.discard.splice(discardIndex, 1); t.energy.push(id);
    this.emit(`${p.name} はトラッシュの ${c.name} を ${t.card.name} につけた。`);
    return { ok: true };
  }
  // ビワ：相手の手札からグッズをトラッシュ
  opponentDiscardFromHand(indexes) {
    const opp = this.opp(); let n = 0;
    [...indexes].sort((a, b) => b - a).forEach(i => { if (opp.hand[i] != null) { opp.discard.push(opp.hand.splice(i, 1)[0]); n++; } });
    this.emit(`${this.cur().name} は ${opp.name} の手札から${n}枚のグッズをトラッシュした。`);
    return { ok: true };
  }
  // ふしぎなアメ：たね→2進化（1進化をとばす）
  rareCandyEvolve(stage2Id, targetUid) {
    const err = this._checkMain(); if (err) return { ok: false, error: err };
    const p = this.cur(); const c = getCard(stage2Id);
    if (!c || c.category !== 'Pokemon' || c.stage !== 'Stage2') return { ok: false, error: '2進化ポケモンを選んでください' };
    const target = this._findInPlay(p, targetUid);
    if (!target) return { ok: false, error: '対象がいません' };
    const stage1 = c.evolvesFrom ? getCard(c.evolvesFrom) : null;
    if (target.card.stage !== 'Basic' || !stage1 || stage1.evolvesFrom !== target.cardId)
      return { ok: false, error: 'そのたねからは進化できません' };
    if (target.placedTurn === this.turnCount) return { ok: false, error: 'このターンに出したポケモンには使えません' };
    const hi = p.hand.indexOf(stage2Id); if (hi >= 0) p.hand.splice(hi, 1);
    target.stack.push(stage2Id); target.cardId = stage2Id; target.evolvedTurn = this.turnCount;
    target.status.clear();
    this.emit(`${p.name} は ふしぎなアメ で ${target.card.name} に進化させた。`);
    this._triggerOnEvolve(target);
    return { ok: true };
  }

  // ============================================================
  //  スタジアム
  // ============================================================
  activeStadium() { return this.stadium ? getCard(this.stadium.id) : null; }

  playStadium(handIndex) {
    const err = this._checkMain(); if (err) return { ok: false, error: err };
    if (this.stadiumPlayed) return { ok: false, error: 'スタジアムはこのターンもう出しました' };
    const p = this.cur(); const id = p.hand[handIndex]; const c = id && getCard(id);
    if (!c || c.category !== 'Trainer' || c.trainerType !== 'Stadium') return { ok: false, error: 'スタジアムではありません' };
    if (this.stadium && getCard(this.stadium.id).name === c.name) return { ok: false, error: '同じ名前のスタジアムは出せません' };
    p.hand.splice(handIndex, 1);
    if (this.stadium) { this.players[this.stadium.owner].discard.push(this.stadium.id); this.emit(`場の ${getCard(this.stadium.id).name} はトラッシュされた。`); }
    this.stadium = { id, owner: this.turnPlayer };
    this.stadiumPlayed = true;
    this.emit(`${p.name} は スタジアム ${c.name} を出した。`);
    return { ok: true };
  }

  // 場のスタジアムにより、相手の効果でベンチにダメカンがのらないか
  _benchProtectedFromOpponent() {
    const s = this.activeStadium();
    return !!(s && s.name === 'バトルコロシアム');
  }
  // ベンチへのダメージ配置（スタジアム等の継続効果を尊重）
  // ownerIndex: ダメージを受ける側 / sourceIndex: 効果の主
  placeBenchDamage(ownerIndex, inst, dmg, sourceIndex) {
    if (!inst || dmg <= 0) return;
    if (sourceIndex !== ownerIndex) {
      if (this._benchProtectedFromOpponent()) { this.emit(`バトルコロシアムにより ${inst.card.name} にダメカンはのらない。`); return; }
      if (this._hasInPlayAbility(ownerIndex, 'はなのカーテン')) { this.emit(`特性「はなのカーテン」により ${inst.card.name} はダメージを受けない。`); return; }
    }
    inst.damage += dmg;
  }
  _hasInPlayAbility(playerIndex, abilityName) {
    return this.allInPlay(this.players[playerIndex]).some(x => x.card.ability && x.card.ability.name === abilityName);
  }

  // ============================================================
  //  特性（とくせい）
  // ============================================================
  // 進化したときに誘発する特性
  _triggerOnEvolve(inst) {
    const ab = inst.card.ability; if (!ab) return;
    if (ab.name === 'サイコドロー') {
      const m = (ab.text || '').match(/(\d+)\s*枚/);
      const n = m ? parseInt(m[1], 10) : 2;
      const drawn = this._draw(this.turnPlayer, n);
      this.emit(`特性「サイコドロー」：${inst.card.name} で${drawn}枚引いた。`);
    }
  }
  // 手動起動できる特性か
  isActivatedAbility(card) {
    return !!(card && card.ability && ACTIVATED_ABILITIES[card.ability.name]);
  }
  canUseAbility(inst) {
    if (!inst || !this.isActivatedAbility(inst.card)) return { ok: false, error: '起動できる特性がありません' };
    if (inst.abilityUsedTurn === this.turnCount) return { ok: false, error: 'この特性はこのターンもう使いました' };
    if (inst.card.ability.name === 'さかてにとる' && !this._koLastTurnSnapshot[this.turnPlayer])
      return { ok: false, error: '前の相手の番に自分のポケモンがきぜつしていません' };
    return { ok: true };
  }
  useAbility(uid) {
    const err = this._checkMain(); if (err) return { ok: false, error: err };
    const p = this.cur(); const inst = this._findInPlay(p, uid);
    if (!inst) return { ok: false, error: '対象がいません' };
    const chk = this.canUseAbility(inst); if (!chk.ok) return chk;
    const ab = inst.card.ability;
    switch (ab.name) {
      case 'にげあしドロー': {
        const drawn = this._draw(this.turnPlayer, 3);
        // 自身と、ついているすべてのカードを山札にもどして切る
        p.deck.push(...inst.stack, ...inst.energy, ...inst.tools);
        if (p.active && p.active.uid === uid) p.active = null;
        else p.bench = p.bench.filter(b => b.uid !== uid);
        this._shuffleDeck(this.turnPlayer);
        this.emit(`特性「にげあしドロー」：${drawn}枚引き、${inst.card.name} を山札にもどした。`);
        this._checkWinConditions();
        return { ok: true };
      }
      case 'さかてにとる': {
        const drawn = this._draw(this.turnPlayer, 3);
        inst.abilityUsedTurn = this.turnCount;
        this.emit(`特性「さかてにとる」：${drawn}枚引いた。`);
        return { ok: true };
      }
      default:
        return { ok: false, error: 'この特性は手動で使えません' };
    }
  }

  // 手動の入れ替え（トレーナー「いれかえ」用）
  forceSwitch(playerIndex, benchIndex) {
    const p = this.players[playerIndex];
    const target = p.bench[benchIndex];
    if (!target) return { ok: false, error: '対象がいません' };
    const old = p.active;
    old.status.clear();
    p.active = target;
    p.bench.splice(benchIndex, 1);
    p.bench.push(old);
    return { ok: true };
  }

  // ============================================================
  //  ワザ・攻撃
  // ============================================================

  canUseAttack(inst, attack) {
    // コスト判定（Colorlessは任意のエネで支払い）
    const have = {};
    for (const eid of inst.energy) {
      const t = getCard(eid).energyType;
      have[t] = (have[t] || 0) + 1;
    }
    let pool = inst.energy.length;
    let needColorless = 0;
    for (const [type, n] of Object.entries(attack.cost)) {
      if (type === 'Colorless') { needColorless += n; continue; }
      if ((have[type] || 0) < n) return false;
      have[type] -= n;
      pool -= n;
    }
    return pool >= needColorless;
  }

  // ワザを使う（attackIndex）
  useAttack(attackIndex) {
    const err = this._checkMain(); if (err) return { ok: false, error: err };
    if (this.hasAttacked) return { ok: false, error: 'すでに攻撃しました' };
    if (this.turnCount === 1 && this.turnPlayer === this.firstPlayer)
      return { ok: false, error: '先攻1ターン目は攻撃できません' };
    const p = this.cur();
    const atk = p.active && p.active.card.attacks && p.active.card.attacks[attackIndex];
    if (!atk) return { ok: false, error: 'ワザがありません' };
    if (!this.canUseAttack(p.active, atk)) return { ok: false, error: 'エネルギーが足りません' };

    // 特殊状態：ねむり/マヒは攻撃不可、こんらんはコイン
    if (p.active.status.has('asleep')) return { ok: false, error: 'ねむり中は攻撃できません' };
    if (p.active.status.has('paralyzed')) return { ok: false, error: 'マヒ中は攻撃できません' };
    if (p.active.status.has('confused')) {
      const coin = this.flip();
      this.emit(`こんらん：コインは${coin === 'heads' ? 'オモテ' : 'ウラ'}。`);
      if (coin === 'tails') {
        p.active.damage += 30;
        this.emit(`${p.active.card.name} は混乱して自分に30ダメージ！`);
        this.hasAttacked = true;
        this._afterDamageChecks();
        return { ok: true, confused: true };
      }
    }

    this.emit(`${p.name} の ${p.active.card.name} の「${atk.name}」！`);
    applyAttackEffect(this, p, this.opp(), p.active, atk);
    this.hasAttacked = true;
    this._afterDamageChecks();
    return { ok: true };
  }

  // ダメージ計算して相手バトルポケモンに与える（弱点/抵抗込み）
  dealDamageToActive(attacker, defenderPlayer, baseDamage, attackType) {
    const def = defenderPlayer.active;
    if (!def || baseDamage <= 0) return;
    let dmg = baseDamage;
    const card = def.card;
    if (card.weakness && card.weakness.type === attackType) dmg = dmg * (card.weakness.mult || 2);
    if (card.resistance && card.resistance.type === attackType) dmg = Math.max(0, dmg - (card.resistance.minus || 30));
    def.damage += dmg;
    this.emit(`${def.card.name} に ${dmg} ダメージ。`);
  }

  dealRawDamage(inst, dmg) {
    if (inst && dmg > 0) inst.damage += dmg;
  }

  // ============================================================
  //  きぜつ判定・サイド・勝敗
  // ============================================================
  _afterDamageChecks() {
    for (let i = 0; i < 2; i++) {
      const p = this.players[i];
      // ベンチのきぜつ
      p.bench = p.bench.filter(b => {
        if (b.isKnockedOut) { this._knockout(i, b); return false; }
        return true;
      });
      // アクティブのきぜつ
      if (p.active && p.active.isKnockedOut) {
        this._knockout(i, p.active);
        p.active = null;
      }
    }
    this._checkWinConditions();
  }

  _knockout(ownerIndex, inst) {
    const owner = this.players[ownerIndex];
    const attackerIndex = 1 - ownerIndex;
    // スタック＋エネルギー＋道具をトラッシュ
    owner.discard.push(...inst.stack, ...inst.energy, ...inst.tools);
    this._koThisTurn[ownerIndex] = true;
    this.emit(`${owner.name} の ${inst.card.name} はきぜつした！`);
    // 相手がサイドを取る
    const taker = this.players[attackerIndex];
    if (taker.prizes.length > 0) {
      const card = taker.prizes.shift();
      taker.hand.push(card);
      this.emit(`${taker.name} はサイドを1枚取った（残り${taker.prizes.length}）。`);
    }
  }

  _checkWinConditions() {
    if (this.winner != null) return;
    // サイド0
    for (let i = 0; i < 2; i++) {
      if (this.players[i].prizes.length === 0) { this._win(i, 'サイドを取りきった'); return; }
    }
    // 場のポケモン全滅（アクティブもベンチもいない）→ 相手の勝ち
    // ただしアクティブが空でベンチがいる場合はプロモート待ち
    for (let i = 0; i < 2; i++) {
      const p = this.players[i];
      if (!p.active && p.bench.length === 0 && p.setupDone) {
        this._win(1 - i, '相手のポケモンが場からいなくなった'); return;
      }
    }
  }

  _loseByDeckout(playerIndex) {
    this._win(1 - playerIndex, '相手の山札が尽きた');
  }

  _win(playerIndex, reason) {
    if (this.winner != null) return;
    this.winner = playerIndex;
    this.winReason = reason;
    this.phase = 'gameover';
    this.emit(`🏆 ${this.players[playerIndex].name} の勝ち！（${reason}）`);
  }

  // アクティブが空のとき、ベンチから昇格させる必要がある
  needsPromotion(playerIndex) {
    const p = this.players[playerIndex];
    return p.setupDone && !p.active && p.bench.length > 0 && this.winner == null;
  }

  promote(playerIndex, benchIndex) {
    const p = this.players[playerIndex];
    const target = p.bench[benchIndex];
    if (!target) return { ok: false, error: '対象がいません' };
    p.active = target;
    p.bench.splice(benchIndex, 1);
    this.emit(`${p.name} は ${p.active.card.name} をバトル場に出した。`);
    // ターン開始ドローが保留されていた場合は、昇格後に実行する
    if (this.awaitingStartDraw && playerIndex === this.turnPlayer && !this.needsPromotion(playerIndex)) {
      this.awaitingStartDraw = false;
      const drawn = this._draw(this.turnPlayer, 1);
      if (drawn === 0) { this._loseByDeckout(this.turnPlayer); return { ok: true }; }
      this.emit(`${this.cur().name} の番。`);
    }
    return { ok: true };
  }

  // ============================================================
  //  ターン終了 → ポケモンチェック → 相手の番
  // ============================================================
  endTurn() {
    const err = this._checkMain(); if (err) return { ok: false, error: err };
    // アクティブ不在なら昇格待ち（UI側で処理を促す）
    if (this.needsPromotion(this.turnPlayer)) return { ok: false, error: '先にバトルポケモンを出してください', needPromote: true };
    this._betweenTurns();
    return { ok: true };
  }

  _betweenTurns() {
    this.phase = 'between';
    // ポケモンチェック：両者のアクティブに、どく→やけど→ねむり/マヒ回復判定
    for (let i = 0; i < 2; i++) {
      const p = this.players[i];
      if (!p.active) continue;
      const a = p.active;
      if (a.status.has('poisoned')) { a.damage += 10; this.emit(`${p.name} の ${a.card.name} はどくで10ダメージ。`); }
      if (a.status.has('burned')) {
        a.damage += 20; this.emit(`${p.name} の ${a.card.name} はやけどで20ダメージ。`);
        const coin = this.flip();
        if (coin === 'heads') { a.status.delete('burned'); this.emit('やけど回復（コインオモテ）。'); }
      }
      if (a.status.has('asleep')) {
        const coin = this.flip();
        if (coin === 'heads') { a.status.delete('asleep'); this.emit(`${a.card.name} は目を覚ました。`); }
      }
      if (a.status.has('paralyzed')) { a.status.delete('paralyzed'); /* 次の自分の番に回復 */ }
    }
    this._afterDamageChecks();
    if (this.winner != null) return;

    // 終わるターン中のきぜつ状況を記録（さかてにとる等の条件判定用）
    this._koLastTurnSnapshot = this._koThisTurn.slice();

    // 相手番へ
    this.turnPlayer = 1 - this.turnPlayer;
    this.turnCount++;
    this._resetTurnFlags();
    this.phase = 'main';
    // 昇格が必要なら（前ターンの攻撃でアクティブきぜつのまま）→ ドローを保留
    if (this.needsPromotion(this.turnPlayer)) {
      this.awaitingStartDraw = true;
      this.emit(`${this.cur().name} はバトルポケモンを出す必要があります。`);
      this.onChange();
      return;
    }
    const drawn = this._draw(this.turnPlayer, 1);
    if (drawn === 0) { this._loseByDeckout(this.turnPlayer); return; }
    this.emit(`${this.cur().name} の番。`);
  }

  // ============================================================
  //  ユーティリティ
  // ============================================================
  _findInPlay(p, uid) {
    if (p.active && p.active.uid === uid) return p.active;
    return p.bench.find(b => b.uid === uid) || null;
  }
  allInPlay(p) { return [p.active, ...p.bench].filter(Boolean); }
}
