// ============================================================
//  AI対戦相手（シンプルなルールベース）
//  方針：場を整えて、最大ダメージを出せるワザを選んで攻撃する。
//  各操作は engine のメソッドを呼ぶだけ。少し間を置きながら進める。
// ============================================================

import { getCard } from '../data/cards.js';

export class AI {
  constructor(game, playerIndex) {
    this.game = game;
    this.me = playerIndex;
  }

  player() { return this.game.players[this.me]; }

  // 1ターンを最後まで実行（同期的に状態変更、ログは逐次emit）
  takeTurn() {
    const g = this.game;
    if (g.winner != null) return;

    // 昇格が必要なら最初に
    if (g.needsPromotion(this.me)) this._promoteBest();
    if (g.turnPlayer !== this.me || g.phase !== 'main') return;

    const p = this.player();

    // 1) ベンチを増やす（たねを最大2匹まで出す）
    let basicsToPlay = 2;
    for (let i = p.hand.length - 1; i >= 0 && basicsToPlay > 0; i--) {
      const c = getCard(p.hand[i]);
      if (c.category === 'Pokemon' && c.stage === 'Basic' && p.bench.length < 5) {
        if (g.playBasicToBench(i).ok) basicsToPlay--;
      }
    }

    // 2) 進化できるものは進化（アクティブ優先）
    this._evolveAll();

    // 3) サポート/アイテムを使う（博士・ボール・つけかえ）
    this._useTrainers();

    // 4) エネルギーをつける（アクティブ優先、足りなければベンチのアタッカー）
    this._attachEnergy();

    // 5) 攻撃（最大ダメージのワザ）。撃てないなら入れ替え検討して終了
    this._attackOrPass();

    // 6) ターン終了
    if (g.phase === 'main' && g.turnPlayer === this.me) {
      if (g.needsPromotion(this.me)) this._promoteBest();
      g.endTurn();
    }
  }

  _promoteBest() {
    const p = this.player();
    if (p.bench.length === 0) return;
    // HP最大を昇格
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
        const c = getCard(p.hand[i]);
        if (c.category !== 'Pokemon' || c.stage === 'Basic') continue;
        const target = g.allInPlay(p).find(inst =>
          inst.cardId === c.evolvesFrom && inst.placedTurn !== g.turnCount && inst.evolvedTurn !== g.turnCount);
        if (target && g.evolve(i, target.uid).ok) { changed = true; break; }
      }
    }
  }

  _useTrainers() {
    const g = this.game, p = this.player();
    // 手札が少なければ博士の研究
    if (p.hand.length <= 4 && !g.supporterPlayed) {
      const i = p.hand.findIndex(id => id === 'professor');
      if (i >= 0 && !(g.turnCount === 1 && g.turnPlayer === g.firstPlayer)) g.playTrainer(i);
    }
    // 傷ついたアクティブにキズぐすり
    if (p.active && p.active.damage >= 30) {
      const i = p.hand.findIndex(id => id === 'potion');
      if (i >= 0) g.playTrainer(i, { targetUid: p.active.uid });
    }
    // ベンチが少なければボール
    if (p.bench.length < 2) {
      const i = p.hand.findIndex(id => id === 'poke-ball');
      if (i >= 0) {
        if (g.playTrainer(i).ok) {
          // 引いたたねをベンチに
          for (let h = p.hand.length - 1; h >= 0 && p.bench.length < 5; h--) {
            const c = getCard(p.hand[h]);
            if (c.category === 'Pokemon' && c.stage === 'Basic') { g.playBasicToBench(h); break; }
          }
        }
      }
    }
  }

  _attachEnergy() {
    const g = this.game, p = this.player();
    if (g.energyAttached || !p.active) return;
    const ei = p.hand.findIndex(id => getCard(id).category === 'Energy');
    if (ei < 0) return;
    // アクティブが攻撃に必要なら優先、十分なら一番育てたいベンチへ
    g.attachEnergy(ei, p.active.uid);
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
    // 先攻1ターン目は攻撃不可
    if (g.turnCount === 1 && g.turnPlayer === g.firstPlayer) return;
    if (p.active.status.has('asleep') || p.active.status.has('paralyzed')) return;

    const best = this._bestAttack(p.active);
    if (best) { g.useAttack(best.idx); return; }

    // 攻撃できない：エネがついた強いベンチがいれば、にげて交代
    const candidate = p.bench
      .map((b, i) => ({ b, i, atk: this._bestAttack(b) }))
      .filter(x => x.atk);
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
