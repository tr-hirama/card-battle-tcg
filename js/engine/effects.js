// ============================================================
//  エフェクト解釈
//  カードに書かれた effect 記述を解釈して状態を変更する。
//  ここを拡張すれば新しいワザ/トレーナー効果を足せる。
// ============================================================

import { getCard } from '../data/cards.js';

// 「自分の手札の枚数×N個ぶんのダメカンをのせる」系の係数N（machine effect か effectText から）
export function parseHandCounters(attack) {
  if (attack && attack.handCounters) return attack.handCounters;
  const m = (attack && attack.effectText || '').match(/手札の枚数×(\d+)個ぶんのダメカン/);
  return m ? parseInt(m[1], 10) : 0;
}

// ---- ワザの効果 ----
// game, attackerPlayer, defenderPlayer, attackerInst, attack
export function applyAttackEffect(game, atkPlayer, defPlayer, inst, attack) {
  const type = inst.card.type;
  let damage = attack.damage || 0;
  const eff = attack.effect || {};

  // ダメージ加算：ついているエネルギー数ぶん
  if (eff.plusPerEnergy) {
    const n = inst.energyCount(eff.plusPerEnergy.type);
    damage += n * eff.plusPerEnergy.damage;
  }

  // コイン依存効果
  let coinResult = null;
  if (eff.coinFlip) {
    coinResult = game.flip();
    game.emit(`コインは${coinResult === 'heads' ? 'オモテ' : 'ウラ'}。`);
  }

  // 本体ダメージ（弱点/抵抗込み）
  if (damage > 0) game.dealDamageToActive(inst, defPlayer, damage, type);

  // 手札枚数ぶんのダメカン（弱点・抵抗は無視）
  const hc = parseHandCounters(attack);
  if (hc && defPlayer.active) {
    const counters = atkPlayer.hand.length * hc;
    defPlayer.active.damage += counters * 10;
    game.emit(`手札${atkPlayer.hand.length}枚ぶん：ダメカン${counters}個（${counters * 10}ダメージ）。`);
  }

  // 状態異常付与（直接 or コインオモテ時）
  const applyStatus = (s) => {
    if (!defPlayer.active || !s) return;
    // 特殊状態の排他ルール（ねむり/マヒ/こんらんは1つだけ）
    if (['asleep', 'paralyzed', 'confused'].includes(s)) {
      defPlayer.active.status.delete('asleep');
      defPlayer.active.status.delete('paralyzed');
      defPlayer.active.status.delete('confused');
    }
    defPlayer.active.status.add(s);
    game.emit(`${defPlayer.active.card.name} は${statusLabel(s)}になった。`);
  };

  if (eff.status && !eff.coinFlip) applyStatus(eff.status);
  if (eff.coinFlip && coinResult === 'heads' && eff.coinFlip.onHeads) {
    if (eff.coinFlip.onHeads.status) applyStatus(eff.coinFlip.onHeads.status);
    if (eff.coinFlip.onHeads.bonusDamage && defPlayer.active)
      game.dealRawDamage(defPlayer.active, eff.coinFlip.onHeads.bonusDamage);
  }

  // 自分を回復
  if (eff.heal) {
    inst.damage = Math.max(0, inst.damage - eff.heal);
    game.emit(`${inst.card.name} のHPを${eff.heal}回復。`);
  }

  // ベンチ全体に自傷（自分の効果なのでスタジアムでは防がれない）
  if (eff.benchDamageSelf) {
    const oi = game.players.indexOf(atkPlayer);
    for (const b of atkPlayer.bench) game.placeBenchDamage(oi, b, eff.benchDamageSelf, oi);
    game.emit(`自分のベンチに${eff.benchDamageSelf}ダメージ。`);
  }

  // 相手のベンチ全体にダメージ（相手の場へ＝バトルコロシアムで防がれる）
  if (eff.benchDamageOpponent) {
    const oi = game.players.indexOf(defPlayer); const si = game.players.indexOf(atkPlayer);
    for (const b of defPlayer.bench) game.placeBenchDamage(oi, b, eff.benchDamageOpponent, si);
    game.emit(`相手のベンチに${eff.benchDamageOpponent}ダメージ。`);
  }

  // 自分のエネルギーをトラッシュ
  if (eff.discardEnergy) {
    let count = eff.discardEnergy.count || 1;
    for (let i = inst.energy.length - 1; i >= 0 && count > 0; i--) {
      if (!eff.discardEnergy.type || getCard(inst.energy[i]).energyType === eff.discardEnergy.type) {
        atkPlayer.discard.push(inst.energy.splice(i, 1)[0]);
        count--;
      }
    }
    game.emit(`エネルギーをトラッシュした。`);
  }
  if (eff.discardAllEnergy) {
    atkPlayer.discard.push(...inst.energy);
    inst.energy = [];
    game.emit(`ついていたエネルギーをすべてトラッシュ。`);
  }
}

// ---- トレーナーの効果 ----
// opts: UIからの追加指定（対象uid等）
export function applyTrainerEffect(game, player, card, opts = {}) {
  const e = card.effect || {};
  switch (e.kind) {
    case 'healTarget': {
      const target = findOwn(game, player, opts.targetUid);
      if (!target) return { ok: false, error: '回復する対象を選んでください', needTarget: 'ownPokemon' };
      if (target.damage === 0) return { ok: false, error: 'そのポケモンは無傷です' };
      target.damage = Math.max(0, target.damage - e.amount);
      return { ok: true };
    }
    case 'discardHandDraw': {
      // 自分（このカードを除く手札）をトラッシュして引く
      const rest = player.hand.filter(id => id !== card.id);
      // 1枚だけ除外（同名複数対策）
      const idx = player.hand.indexOf(card.id);
      const toDiscard = player.hand.slice();
      toDiscard.splice(idx, 1);
      player.discard.push(...toDiscard);
      player.hand = [card.id]; // playTrainer 側でこの1枚を除去＆トラッシュ
      game._draw(game.players.indexOf(player), e.draw);
      return { ok: true };
    }
    case 'searchBasic': {
      const i = player.deck.findIndex(id => {
        const c = getCard(id); return c.category === 'Pokemon' && c.stage === 'Basic';
      });
      if (i < 0) return { ok: false, error: '山札にたねポケモンがいません' };
      player.hand.push(player.deck.splice(i, 1)[0]);
      shuffleDeck(game, player);
      return { ok: true };
    }
    case 'searchEnergy': {
      const i = player.deck.findIndex(id => { const c = getCard(id); return c.category === 'Energy' && c.basic; });
      if (i < 0) return { ok: false, error: '山札に基本エネルギーがありません' };
      player.hand.push(player.deck.splice(i, 1)[0]);
      shuffleDeck(game, player);
      return { ok: true };
    }
    case 'switchActive': {
      if (player.bench.length === 0) return { ok: false, error: 'ベンチにポケモンがいません' };
      if (opts.benchIndex == null) return { ok: false, error: '入れ替え先を選んでください', needTarget: 'ownBench' };
      return game.forceSwitch(game.players.indexOf(player), opts.benchIndex);
    }
    case 'unimplemented':
      // 取り込んだ実カードのトレーナーズ（複雑な効果は未実装）。出せるが効果なし。
      return { ok: true, note: '（このカードの効果は未実装です）' };
    default:
      return { ok: false, error: '未対応のトレーナー効果' };
  }
}

function findOwn(game, player, uid) {
  if (!uid) return null;
  if (player.active && player.active.uid === uid) return player.active;
  return player.bench.find(b => b.uid === uid) || null;
}

function shuffleDeck(game, player) {
  const a = player.deck;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(game.rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

export function statusLabel(s) {
  return ({ asleep: 'ねむり', paralyzed: 'マヒ', confused: 'こんらん', poisoned: 'どく', burned: 'やけど' })[s] || s;
}
