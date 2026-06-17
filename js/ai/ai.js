// ============================================================
//  AI対戦相手（ルールベース）
//  人間と同等：実カードのトレーナーズ・スタジアム・特性も使う。
//  各操作は engine のメソッドを呼ぶ。選択はAIが自動で決める。
// ============================================================

import { getCard } from '../data/cards.js';

export class AI {
  constructor(game, playerIndex) {
    this.game = game;
    this.me = playerIndex;
  }

  player() { return this.game.players[this.me]; }
  opp() { return this.game.players[1 - this.me]; }

  // 1ターンを最後まで実行
  takeTurn() {
    const g = this.game;
    if (g.winner != null) return;
    if (g.needsPromotion(this.me)) this._promoteBest();
    if (g.turnPlayer !== this.me || g.phase !== 'main') return;

    this._playBasics(2);
    this._useDrawAbilities();   // さかてにとる / にげあしドロー
    this._useSupporter();       // 1枚（ボスの指令でKO狙い、無ければドロー/サーチ）
    this._useItems();           // ポフィン/ポケパッド/タンカ/ハンマー/ワンダーパッチ
    this._useRareCandy();       // ふしぎなアメ
    this._evolveAll();          // 通常進化
    this._useStadium();         // スタジアム
    this._attachEnergy();
    this._attackOrPass();

    if (g.phase === 'main' && g.turnPlayer === this.me) {
      if (g.needsPromotion(this.me)) this._promoteBest();
      g.endTurn();
    }
  }

  // ---- 補助 ----
  _card(id) { try { return getCard(id); } catch { return null; } }
  _idByName(name) { return this.player().hand.find(id => { const c = this._card(id); return c && c.name === name; }); }
  _indexByName(name) { return this.player().hand.findIndex(id => { const c = this._card(id); return c && c.name === name; }); }

  _playBasics(n) {
    const g = this.game, p = this.player();
    for (let i = p.hand.length - 1; i >= 0 && n > 0; i--) {
      const c = this._card(p.hand[i]);
      if (c && c.category === 'Pokemon' && c.stage === 'Basic' && p.bench.length < 5) {
        if (g.playBasicToBench(i).ok) n--;
      }
    }
  }

  _promoteBest() {
    const p = this.player();
    if (p.bench.length === 0) return;
    let best = 0, bestHp = -1;
    p.bench.forEach((b, i) => { if (b.currentHp > bestHp) { bestHp = b.currentHp; best = i; } });
    this.game.promote(this.me, best);
  }

  _evolveAll() {
    const g = this.game, p = this.player();
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < p.hand.length; i++) {
        const c = this._card(p.hand[i]);
        if (!c || c.category !== 'Pokemon' || c.stage === 'Basic') continue;
        const target = g.allInPlay(p).find(inst =>
          inst.cardId === c.evolvesFrom && inst.placedTurn !== g.turnCount && inst.evolvedTurn !== g.turnCount);
        if (target && g.evolve(i, target.uid).ok) { changed = true; break; }
      }
    }
  }

  // ---- 特性（ドロー系） ----
  _useDrawAbilities() {
    const g = this.game, p = this.player();
    const insts = g.allInPlay(p).slice();
    for (const inst of insts) {
      const ab = inst.card.ability; if (!ab) continue;
      if (ab.name === 'さかてにとる' && g.canUseAbility(inst).ok) g.useAbility(inst.uid);
      if (ab.name === 'にげあしドロー' && g.canUseAbility(inst).ok) {
        const onBench = p.bench.some(b => b.uid === inst.uid);
        // 手札が細く、ベンチに余裕があるとき、ベンチのものだけ使う（アクティブは温存）
        if (onBench && p.active && p.bench.length >= 2 && p.hand.length <= 4) g.useAbility(inst.uid);
      }
    }
  }

  // ---- トレーナーズ（グッズ） ----
  _useItems() {
    const g = this.game, p = this.player();

    // プレースホルダー：博士/ボール/キズぐすり
    if (p.active && p.active.damage >= 30) { const i = p.hand.indexOf('potion'); if (i >= 0) g.playTrainer(i, { targetUid: p.active.uid }); }
    if (p.bench.length < 2) { const i = p.hand.indexOf('poke-ball'); if (i >= 0 && g.playTrainer(i).ok) this._playBasics(1); }

    // なかよしポフィン：HP70以下のたねを2枚までベンチに
    { const id = this._idByName('なかよしポフィン');
      if (id && p.bench.length < 5) {
        const picks = p.deck.filter(d => { const c = this._card(d); return c && c.category === 'Pokemon' && c.stage === 'Basic' && c.hp <= 70; }).slice(0, Math.min(2, 5 - p.bench.length));
        if (picks.length) { g.searchDeckToBench(picks); g.consumeTrainerById(id); }
      } }

    // ポケパッド：必要ならポケモンを手札に（進化元が場にある進化を優先）
    { const id = this._idByName('ポケパッド');
      if (id) {
        const want = this._wantedPokemonFromDeck();
        if (want) { g.searchDeckToHand([want]); g.consumeTrainerById(id); }
      } }

    // 夜のタンカ：トラッシュにポケモンがあり手札/盤面が薄いとき回収
    { const id = this._idByName('夜のタンカ');
      if (id) {
        const di = p.discard.findIndex(d => { const c = this._card(d); return c && c.category === 'Pokemon'; });
        if (di >= 0 && (p.bench.length < 3)) { g.moveDiscardToHand([di]); g.consumeTrainerById(id); }
      } }

    // 改造ハンマー：相手の特殊エネをトラッシュ
    { const id = this._idByName('改造ハンマー');
      if (id) {
        const t = g.allInPlay(this.opp()).find(x => x.energy.some(e => { const c = this._card(e); return c && c.special; }));
        if (t) { g.discardSpecialEnergy(t.uid); g.consumeTrainerById(id); }
      } }

    // ワンダーパッチ：トラッシュの基本エネをベンチに
    { const id = this._idByName('ワンダーパッチ');
      if (id && p.bench.length) {
        const di = p.discard.findIndex(d => { const c = this._card(d); return c && c.category === 'Energy' && c.basic; });
        if (di >= 0) { g.attachEnergyFromDiscard(di, p.bench[0].uid); g.consumeTrainerById(id); }
      } }
  }

  // 場のたねから進化できる、デッキ内の進化カードid（無ければベンチ用たね）
  _wantedPokemonFromDeck() {
    const g = this.game, p = this.player();
    const inPlayIds = g.allInPlay(p).map(x => x.cardId);
    // 進化元が場にある進化ポケモン
    const evo = p.deck.find(d => { const c = this._card(d); return c && c.category === 'Pokemon' && c.stage !== 'Basic' && inPlayIds.includes(c.evolvesFrom); });
    if (evo) return evo;
    // 2進化（アメ用）で1段目が場にある
    if (p.bench.length < 4) return p.deck.find(d => { const c = this._card(d); return c && c.category === 'Pokemon' && c.stage === 'Basic'; });
    return null;
  }

  // ふしぎなアメ：場のたね→手札の2進化
  _useRareCandy() {
    const g = this.game, p = this.player();
    let guard = 6;
    while (guard-- > 0) {
      const id = this._idByName('ふしぎなアメ'); if (!id) break;
      const stage2s = p.hand.filter(h => { const c = this._card(h); return c && c.category === 'Pokemon' && c.stage === 'Stage2'; });
      let used = false;
      for (const inst of g.allInPlay(p)) {
        if (inst.card.stage !== 'Basic' || inst.placedTurn === g.turnCount) continue;
        const s2 = stage2s.find(s => { const c = this._card(s); const s1 = c.evolvesFrom ? this._card(c.evolvesFrom) : null; return s1 && s1.evolvesFrom === inst.cardId; });
        if (s2 && g.rareCandyEvolve(s2, inst.uid).ok) { g.consumeTrainerById(id); used = true; break; }
      }
      if (!used) break;
    }
  }

  // ---- サポート（1枚） ----
  _useSupporter() {
    const g = this.game, p = this.player();
    if (g.supporterPlayed) return;
    if (g.turnCount === 1 && g.turnPlayer === g.firstPlayer) return;

    // 1) ボスの指令：相手ベンチに、自分のアクティブで倒せそうな的がいれば引きずり出す
    const boss = this._idByName('ボスの指令');
    if (boss) {
      const dmg = this._activeBestDamage();
      const opp = this.opp();
      const idx = opp.bench.findIndex(b => b.currentHp <= dmg && dmg > 0);
      if (idx >= 0) { g.gustOpponent(idx); g.consumeTrainerById(boss); return; }
    }
    // 2) ドロー/サーチ系サポート
    const hikari = this._idByName('ヒカリ');
    if (hikari) {
      const ids = [];
      const pick = (f) => { const d = p.deck.find(x => f(this._card(x)) && !ids.includes(x)); if (d) ids.push(d); };
      pick(c => c && c.category === 'Pokemon' && c.stage === 'Basic');
      pick(c => c && c.category === 'Pokemon' && c.stage === 'Stage1');
      pick(c => c && c.category === 'Pokemon' && c.stage === 'Stage2');
      if (ids.length) { g.searchDeckToHand(ids); g.consumeTrainerById(hikari); return; }
    }
    const touko = this._idByName('トウコ');
    if (touko) {
      const ids = [];
      const evo = p.deck.find(x => { const c = this._card(x); return c && c.category === 'Pokemon' && c.stage !== 'Basic'; });
      const ene = p.deck.find(x => { const c = this._card(x); return c && c.category === 'Energy'; });
      if (evo) ids.push(evo); if (ene) ids.push(ene);
      if (ids.length) { g.searchDeckToHand(ids); g.consumeTrainerById(touko); return; }
    }
    // 3) 博士の研究（プレースホルダー）：手札が細いとき
    if (p.hand.length <= 4) { const i = p.hand.indexOf('professor'); if (i >= 0) { g.playTrainer(i); return; } }
    // 4) スイレンのお世話：トラッシュ回収
    const suiren = this._idByName('スイレンのお世話');
    if (suiren) {
      const picks = p.discard.map((d, i) => ({ d, i })).filter(x => { const c = this._card(x.d); return c && (c.category === 'Pokemon' || (c.category === 'Energy' && c.basic)); }).slice(0, 3).map(x => x.i);
      if (picks.length) { g.moveDiscardToHand(picks); g.consumeTrainerById(suiren); return; }
    }
    // 5) ビワ：相手の手札のグッズを落とす
    const biwa = this._idByName('ビワ');
    if (biwa) {
      const opp = this.opp();
      const idxs = opp.hand.map((d, i) => ({ d, i })).filter(x => { const c = this._card(x.d); return c && c.category === 'Trainer' && c.trainerType === 'Item'; }).slice(0, 2).map(x => x.i);
      if (idxs.length) { g.opponentDiscardFromHand(idxs); g.consumeTrainerById(biwa); return; }
    }
  }

  // ---- スタジアム ----
  _useStadium() {
    const g = this.game, p = this.player();
    if (g.stadiumPlayed) return;
    const i = p.hand.findIndex(id => { const c = this._card(id); return c && c.category === 'Trainer' && c.trainerType === 'Stadium'; });
    if (i < 0) return;
    const c = this._card(p.hand[i]);
    // 自分が出していない（場が空 or 相手の/別名）なら出す
    if (!g.stadium || (getCard(g.stadium.id).name !== c.name)) g.playStadium(i);
  }

  _attachEnergy() {
    const g = this.game, p = this.player();
    if (g.energyAttached || !p.active) return;
    const ei = p.hand.findIndex(id => { const c = this._card(id); return c && c.category === 'Energy'; });
    if (ei < 0) return;
    g.attachEnergy(ei, p.active.uid);
  }

  _activeBestDamage() {
    const b = this._bestAttack(this.player().active);
    return b ? (b.atk.damage || 0) : 0;
  }

  _bestAttack(inst) {
    const g = this.game;
    if (!inst || !inst.card.attacks) return null;
    let best = null, bestDmg = -1;
    inst.card.attacks.forEach((atk, idx) => {
      if (!g.canUseAttack(inst, atk)) return;
      const dmg = atk.damage || 0;
      if (dmg > bestDmg) { bestDmg = dmg; best = { idx, atk }; }
    });
    return best;
  }

  _attackOrPass() {
    const g = this.game, p = this.player();
    if (!p.active) return;
    if (g.turnCount === 1 && g.turnPlayer === g.firstPlayer) return;
    if (p.active.status.has('asleep') || p.active.status.has('paralyzed')) return;

    const best = this._bestAttack(p.active);
    if (best) { g.useAttack(best.idx); return; }

    const candidate = p.bench.map((b, i) => ({ b, i, atk: this._bestAttack(b) })).filter(x => x.atk);
    if (candidate.length && !g.retreatedThisTurn) {
      const cost = p.active.card.retreat || 0;
      if (p.active.energy.length >= cost) {
        candidate.sort((a, b) => (b.atk.atk.damage || 0) - (a.atk.atk.damage || 0));
        g.retreat(candidate[0].i);
        const nb = this._bestAttack(p.active);
        if (nb) g.useAttack(nb.idx);
      }
    }
  }
}
