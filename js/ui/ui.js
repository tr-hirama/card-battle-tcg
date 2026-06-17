// ============================================================
//  UI レンダラ
//  ゲーム状態を受け取りDOMを描画。クリックは data-* 属性 + 委譲で
//  コントローラ(main.js)に通知する。
// ============================================================

import { getCard, TYPE_COLORS, TYPE_ICONS } from '../data/cards.js';
import { statusLabel } from '../engine/effects.js';

const STATUS_ICON = { asleep: '💤', paralyzed: '⚡', confused: '😵', poisoned: '☠️', burned: '🔥' };

// ============================================================
//  カード画像（アンロック時のみ・公式URLを参照／リポジトリには保存しない）
//  imagesEnabled は起動時のパスワード照合で true になる。
//  公開サイトでは常に false → 画像を一切読み込まない（転載回避）。
// ============================================================
let _imagesEnabled = false;
export function setImagesEnabled(v) { _imagesEnabled = !!v; }
function cardImage(card) {
  return (_imagesEnabled && card.imageUrl) ? card.imageUrl : null;
}

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
    this._last = { game, ctx };
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
    const img = cardImage(c);
    const head = img
      ? `<span class="pthumb" style="background-image:url('${img}')"></span>`
      : `<span class="ptype" style="background:${color}">${TYPE_ICONS[c.type] || ''}</span>`;
    return `<div class="poke ${isActive ? 'active' : 'bench-poke'} ${sel}"
      data-act="poke" data-uid="${inst.uid}" data-side="${side}" data-bench="${benchIndex == null ? '' : benchIndex}"
      style="border-color:${color}">
      <div class="poke-head">
        ${head}
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
      const img = cardImage(c);
      const art = img ? `<div class="hc-art" style="background-image:url('${img}')"></div>` : '';
      return `<div class="hand-card ${sel} ${img ? 'has-art' : ''}" data-act="hand" data-i="${i}" style="border-top:4px solid ${color}">
        ${badge}
        ${art}
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

  // ============================================================
  //  汎用カード選択モーダル（山札・トラッシュ・手札から選ぶ）
  //  opts: { title, items:[{key,label,sublabel,imageUrl}], min, max, optional, confirmLabel }
  //  onConfirm(selectedKeys[]) / onCancel()
  // ============================================================
  showPicker(opts, onConfirm, onCancel) {
    this.closePicker();
    const { title = '選択', items = [], min = 0, max = 1, optional = false, confirmLabel = '決定' } = opts;
    const sel = new Set();
    const ov = document.createElement('div');
    ov.className = 'picker-overlay';
    ov.innerHTML = `
      <div class="picker">
        <div class="picker-head">${title}<span class="picker-count"></span></div>
        <div class="picker-list">
          ${items.length ? items.map((it, i) => `
            <div class="picker-card" data-i="${i}">
              ${it.imageUrl ? `<div class="pc-art" style="background-image:url('${it.imageUrl}')"></div>` : '<div class="pc-art noimg">🂠</div>'}
              <div class="pc-name">${it.label}</div>
              ${it.sublabel ? `<div class="pc-sub">${it.sublabel}</div>` : ''}
            </div>`).join('') : '<div class="picker-empty">対象がありません</div>'}
        </div>
        <div class="picker-actions">
          <button class="btn cancel-btn">${optional ? 'なし／やめる' : 'やめる'}</button>
          <button class="btn primary ok-btn">${confirmLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    this._picker = ov;

    const countEl = ov.querySelector('.picker-count');
    const okBtn = ov.querySelector('.ok-btn');
    const refresh = () => {
      countEl.textContent = max > 1 ? `（${sel.size} / 最大${max}）` : '';
      const ok = optional ? true : sel.size >= Math.max(1, min);
      okBtn.classList.toggle('disabled', !(ok && sel.size <= max));
    };
    ov.querySelectorAll('.picker-card').forEach(el => {
      el.addEventListener('click', () => {
        const i = +el.dataset.i;
        if (sel.has(i)) { sel.delete(i); el.classList.remove('sel'); }
        else { if (sel.size >= max) return; sel.add(i); el.classList.add('sel'); }
        refresh();
      });
    });
    ov.querySelector('.ok-btn').addEventListener('click', () => {
      if (okBtn.classList.contains('disabled')) return;
      const keys = [...sel].map(i => items[i].key);
      this.closePicker(); onConfirm(keys);
    });
    ov.querySelector('.cancel-btn').addEventListener('click', () => { this.closePicker(); if (onCancel) onCancel(); });
    refresh();
  }
  closePicker() { if (this._picker) { this._picker.remove(); this._picker = null; } }

  // ログ描画（別要素）
  renderLog(logEl, log) {
    logEl.innerHTML = log.slice(-200).map(l => `<div class="log-line">${l}</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }
}
