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
    const g = this.game, p = this.player();
    if (p.bench.length === 0) return;
    const oppActive = this.opp().active;
    // 評価: 今すぐ殴れる＞与えられる実効ダメージ＞HP
    const score = (b) => {
      const atk = this._bestAttack(b);
      const dmg = atk ? this._maxEffective(b, oppActive) : 0;
      return (atk ? 100000 : 0) + dmg * 100 + b.currentHp;
    };
    let best = 0, bestScore = -1;
    p.bench.forEach((b, i) => { const s = score(b); if (s > bestScore) { bestScore = s; best = i; } });
    g.promote(this.me, best);
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
        // 乱用は自滅（山札・盤面・エネを失う）。手札が尽きかけ＆山札に余裕＆エネ未装着のベンチのみ。
        if (onBench && inst.energy.length === 0 && p.active && p.bench.length >= 2 && p.hand.length <= 2 && p.deck.length > 8)
          g.useAbility(inst.uid);
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

    // 1) ボスの指令：自分のアクティブでKOできる相手ベンチを引きずり出す（弱点込みの実効ダメージで判定）
    const boss = this._idByName('ボスの指令');
    if (boss && p.active) {
      const opp = this.opp();
      let pick = -1, pickHp = Infinity;
      opp.bench.forEach((b, i) => {
        const eff = this._maxEffective(p.active, b);
        if (eff > 0 && eff >= b.currentHp && b.currentHp < pickHp) { pick = i; pickHp = b.currentHp; }
      });
      if (pick >= 0) { g.gustOpponent(pick); g.consumeTrainerById(boss); return; }
    }
    // 2) ドロー/サーチ系サポート（手札が十分なら山札温存のため使わない）
    const wantResources = p.hand.length <= 5;
    const hikari = wantResources && this._idByName('ヒカリ');
    if (hikari) {
      const ids = [];
      const pick = (f) => { const d = p.deck.find(x => f(this._card(x)) && !ids.includes(x)); if (d) ids.push(d); };
      pick(c => c && c.category === 'Pokemon' && c.stage === 'Basic');
      pick(c => c && c.category === 'Pokemon' && c.stage === 'Stage1');
      pick(c => c && c.category === 'Pokemon' && c.stage === 'Stage2');
      if (ids.length) { g.searchDeckToHand(ids); g.consumeTrainerById(hikari); return; }
    }
    const touko = wantResources && this._idByName('トウコ');
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
    const energyIdx = p.hand.map((id, i) => ({ id, i })).filter(x => { const c = this._card(x.id); return c && c.category === 'Energy'; });
    if (!energyIdx.length) return;

    // 候補（アクティブ優先、次にベンチ）について、付けると「新たにワザが撃てるようになる」組合せを探す
    const targets = [p.active, ...p.bench].filter(Boolean);
    const enables = (target, eid) => {
      target.energy.push(eid);
      const ok = (target.card.attacks || []).some(a => g.canUseAttack(target, a));
      target.energy.pop();
      return ok;
    };
    for (const target of targets) {
      const alreadyAttacks = (target.card.attacks || []).some(a => g.canUseAttack(target, a));
      if (alreadyAttacks) continue;            // 既に撃てるなら回さない
      for (const e of energyIdx) {
        if (enables(target, e.id)) { this._attach(e.i, target.uid); return; }
      }
    }
    // 撃てる相手を増やせないなら、アクティブの必要タイプを優先して育てる
    const need = new Set();
    (p.active.card.attacks || []).forEach(a => Object.keys(a.cost || {}).forEach(t => { if (t !== 'Colorless') need.add(t); }));
    let pick = energyIdx.find(e => need.has(this._card(e.id).energyType)) || energyIdx[0];
    this._attach(pick.i, p.active.uid);
  }

  // エネルギーを付け、特殊エネの「つけたとき」効果を自動解決
  _attach(idx, uid) {
    const g = this.game, p = this.player();
    const id = p.hand[idx];
    if (!g.attachEnergy(idx, uid).ok) return false;
    const c = this._card(id);
    if (c && c.special && c.name === 'リッチエネルギー') g.effectDraw(4, c.name);
    else if (c && c.special && c.name === 'テレパス超エネルギー') {
      const space = 5 - p.bench.length;
      if (space > 0) {
        const picks = p.deck.filter(d => { const cc = this._card(d); return cc && cc.category === 'Pokemon' && cc.stage === 'Basic' && cc.type === c.energyType; }).slice(0, Math.min(2, space));
        if (picks.length) g.searchDeckToBench(picks);
      }
    }
    return true;
  }

  // 使えるワザのうち素ダメージ最大（同一ポケモンの中での選択）
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
  // defender に対する実効ダメージ最大（弱点/抵抗込み）
  _bestAttackVs(inst, defender) {
    const g = this.game;
    if (!inst || !inst.card.attacks) return null;
    let best = null, bestEff = -1;
    inst.card.attacks.forEach((atk, idx) => {
      if (!g.canUseAttack(inst, atk)) return;
      const eff = g.estimateDamage(inst, atk, defender);
      if (eff > bestEff) { bestEff = eff; best = { idx, atk, eff }; }
    });
    return best;
  }
  _maxEffective(inst, defender) {
    const b = this._bestAttackVs(inst, defender);
    return b ? b.eff : 0;
  }
  // 対象選択ワザ：相手アクティブをKOできるならそれ、次にKOできるベンチ(最大HP)、無ければアクティブ
  _pickFreeTarget(atk) {
    const g = this.game, opp = this.opp(), active = this.player().active;
    const raw = g.estimateDamage(active, atk, null);               // ベンチへの素点
    if (opp.active && g.estimateDamage(active, atk, opp.active) >= opp.active.currentHp) return opp.active.uid;
    let best = null, bestHp = -1;
    opp.bench.forEach(b => { if (raw >= b.currentHp && b.currentHp > bestHp) { bestHp = b.currentHp; best = b; } });
    if (best) return best.uid;
    return opp.active ? opp.active.uid : (opp.bench[0] && opp.bench[0].uid);
  }
  _doAttack(best) {
    const g = this.game;
    const opts = g.attackNeedsTarget(best.atk) ? { targetUid: this._pickFreeTarget(best.atk) } : {};
    g.useAttack(best.idx, opts);
  }

  _attackOrPass() {
    const g = this.game, p = this.player();
    if (!p.active) return;
    if (g.turnCount === 1 && g.turnPlayer === g.firstPlayer) return;
    if (p.active.status.has('asleep') || p.active.status.has('paralyzed')) return;
    const oppActive = this.opp().active;

    // アクティブで殴れるなら、相手アクティブに最大実効ダメージのワザを撃つ
    const best = this._bestAttackVs(p.active, oppActive);
    if (best) {
      // ベンチに「もっと有効な＝相手をKOできて、今のアクティブではKOできない」アタッカーがいて、
      // にげるコストを払えるなら入れ替えてから殴る
      const koNow = oppActive && best.eff >= oppActive.currentHp;
      if (!koNow && oppActive && !g.retreatedThisTurn) {
        const cost = p.active.card.retreat || 0;
        if (p.active.energy.length >= cost) {
          const better = p.bench.map((b, i) => ({ i, eff: this._maxEffective(b, oppActive) }))
            .filter(x => x.eff >= oppActive.currentHp && x.eff > best.eff)
            .sort((a, b) => b.eff - a.eff)[0];
          if (better) { g.retreat(better.i); const nb = this._bestAttackVs(p.active, this.opp().active); if (nb) this._doAttack(nb); return; }
        }
      }
      this._doAttack(best); return;
    }

    // アクティブで殴れない：殴れるベンチに入れ替える（相手への実効ダメージ最大）
    const candidate = p.bench.map((b, i) => ({ b, i, eff: this._maxEffective(b, oppActive) })).filter(x => this._bestAttack(x.b));
    if (candidate.length && !g.retreatedThisTurn) {
      const cost = p.active.card.retreat || 0;
      if (p.active.energy.length >= cost) {
        candidate.sort((a, b) => b.eff - a.eff);
        g.retreat(candidate[0].i);
        const nb = this._bestAttackVs(p.active, this.opp().active);
        if (nb) this._doAttack(nb);
      }
    }
  }
}
