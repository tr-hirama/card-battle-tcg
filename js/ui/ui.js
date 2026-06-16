// ============================================================
//  UI レンダラ
//  ゲーム状態を受け取りDOMを描画。クリックは data-* 属性 + 委譲で
//  コントローラ(main.js)に通知する。
// ============================================================

import { getCard, TYPE_COLORS, TYPE_ICONS } from '../data/cards.js';
import { statusLabel } from '../engine/effects.js';

const STATUS_ICON = { asleep: '💤', paralyzed: '⚡', confused: '😵', poisoned: '☠️', burned: '🔥' };

export class UI {
  constructor(root) {
    this.root = root;
    this.handlers = {};
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const act = el.dataset.act;
      const h = this.handlers[act];
      if (h) h(el.dataset, e);
    });
  }

  on(act, fn) { this.handlers[act] = fn; }

  // ctx: { selHand, targets:Set<uid>, banner, attackable:bool, viewer:0 }
  render(game, ctx = {}) {
    const targets = ctx.targets || new Set();
    const me = game.players[0];
    const opp = game.players[1];

    this.root.innerHTML = `
      <div class="board">
        ${this._sideStrip(opp, true)}
        ${this._fieldRow(game, opp, 1, targets, true)}
        <div class="midline">
          <span class="turn-info">ターン ${game.turnCount}・${game.players[game.turnPlayer].name}の番</span>
        </div>
        ${this._fieldRow(game, me, 0, targets, false)}
        ${this._sideStrip(me, false)}
        ${this._handRow(game, me, ctx)}
      </div>
      ${this._actionBar(game, ctx)}
      ${ctx.banner ? `<div class="banner">${ctx.banner}</div>` : ''}
    `;
  }

  _sideStrip(p, isOpp) {
    return `<div class="side-strip ${isOpp ? 'opp' : 'me'}">
      <span class="pill">🂠 山札 ${p.deck.length}</span>
      <span class="pill">🗑 トラッシュ ${p.discard.length}</span>
      <span class="pill prize">🏅 サイド ${p.prizes.length}</span>
      <span class="pill">✋ 手札 ${p.hand.length}</span>
    </div>`;
  }

  _fieldRow(game, p, side, targets, isOpp) {
    const bench = p.bench.map((b, i) => this._pokemonCard(b, side, targets, false, i)).join('');
    const active = p.active ? this._pokemonCard(p.active, side, targets, true) : `<div class="poke empty">バトル場</div>`;
    return `<div class="field ${isOpp ? 'opp' : 'me'}">
      <div class="active-slot">${active}</div>
      <div class="bench">${bench || '<div class="poke empty small">ベンチ</div>'}</div>
    </div>`;
  }

  _pokemonCard(inst, side, targets, isActive, benchIndex) {
    const c = inst.card;
    const color = TYPE_COLORS[c.type] || '#999';
    const hpPct = Math.max(0, Math.round((inst.currentHp / inst.maxHp) * 100));
    const sel = targets.has(inst.uid) ? 'target' : '';
    const status = [...inst.status].map(s => `<span class="status" title="${statusLabel(s)}">${STATUS_ICON[s] || ''}</span>`).join('');
    const energy = inst.energy.map(eid => {
      const e = getCard(eid);
      return `<span class="energy-dot" style="background:${TYPE_COLORS[e.energyType]}" title="${e.name}">${TYPE_ICONS[e.energyType] || ''}</span>`;
    }).join('');
    return `<div class="poke ${isActive ? 'active' : 'bench-poke'} ${sel}"
      data-act="poke" data-uid="${inst.uid}" data-side="${side}" data-bench="${benchIndex == null ? '' : benchIndex}"
      style="border-color:${color}">
      <div class="poke-head">
        <span class="ptype" style="background:${color}">${TYPE_ICONS[c.type] || ''}</span>
        <span class="pname">${c.name}</span>
      </div>
      <div class="hp-row">
        <div class="hp-bar"><div class="hp-fill" style="width:${hpPct}%;background:${hpPct > 50 ? '#4caf50' : hpPct > 25 ? '#ff9800' : '#f44336'}"></div></div>
        <span class="hp-text">${inst.currentHp}/${inst.maxHp}</span>
      </div>
      <div class="energy-row">${energy}</div>
      <div class="status-row">${status}</div>
    </div>`;
  }

  _handRow(game, p, ctx) {
    const multi = ctx.selHandMulti || null;
    const cards = p.hand.map((id, i) => {
      const c = getCard(id);
      const color = c.category === 'Pokemon' ? (TYPE_COLORS[c.type] || '#999')
        : c.category === 'Energy' ? (TYPE_COLORS[c.energyType] || '#999') : '#7e57c2';
      let sel = ctx.selHand === i ? 'sel' : '';
      let badge = '';
      if (multi && multi.has(i)) {
        sel = 'sel';
        // セットアップ：先頭がバトル場
        const order = [...multi];
        badge = order[0] === i ? '<span class="hc-badge active">バトル場</span>' : '<span class="hc-badge">ベンチ</span>';
      }
      const sub = c.category === 'Pokemon' ? `${c.stage} HP${c.hp}`
        : c.category === 'Energy' ? 'エネルギー'
        : c.trainerType === 'Supporter' ? 'サポート' : 'グッズ';
      return `<div class="hand-card ${sel}" data-act="hand" data-i="${i}" style="border-top:4px solid ${color}">
        ${badge}
        <div class="hc-name">${c.name}</div>
        <div class="hc-sub">${sub}</div>
      </div>`;
    }).join('');
    return `<div class="hand">${cards || '<span class="muted">手札なし</span>'}</div>`;
  }

  _actionBar(game, ctx) {
    if (game.winner != null) {
      return `<div class="action-bar gameover">
        <button data-act="newgame" class="btn primary">もう一度</button>
      </div>`;
    }
    return `<div class="action-bar">
      <div class="actions">${ctx.actionsHtml || ''}</div>
      <div class="spacer"></div>
      <button data-act="endturn" class="btn ${ctx.canEnd ? 'primary' : 'disabled'}">ターン終了</button>
    </div>`;
  }

  // ログ描画（別要素）
  renderLog(logEl, log) {
    logEl.innerHTML = log.slice(-200).map(l => `<div class="log-line">${l}</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }
}
