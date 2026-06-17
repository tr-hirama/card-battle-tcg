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

    // ---- ドラッグ&ドロップ（手札→自分の場）: エネルギー付け / 進化 / ベンチ展開 ----
    // ドラッグ中の情報は this._drag に保持（dragover中は getData が読めないブラウザがあるため）
    root.addEventListener('dragstart', (e) => {
      const el = e.target.closest('[data-act="hand"][data-drag]');
      if (!el) { e.preventDefault(); return; }
      this._drag = { kind: el.dataset.drag, i: parseInt(el.dataset.i, 10) };
      e.dataTransfer.setData('text/plain', el.dataset.i);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    root.addEventListener('dragend', () => {
      this._drag = null;
      root.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging'));
      root.querySelectorAll('.drop-hover').forEach(x => x.classList.remove('drop-hover'));
    });
    const dropTargetFor = (kind, target) =>
      kind === 'bench' ? target.closest('[data-dropzone="bench"]') : target.closest('.poke[data-side="0"]');
    root.addEventListener('dragover', (e) => {
      const d = this._drag; if (!d) return;
      const z = dropTargetFor(d.kind, e.target);
      if (z) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; z.classList.add('drop-hover'); }
    });
    root.addEventListener('dragleave', (e) => {
      const z = e.target.closest('[data-dropzone="bench"], .poke[data-side="0"]');
      if (z) z.classList.remove('drop-hover');
    });
    root.addEventListener('drop', (e) => {
      const d = this._drag; if (!d) return;
      const z = dropTargetFor(d.kind, e.target);
      if (!z) return;
      e.preventDefault(); z.classList.remove('drop-hover');
      if (d.kind === 'bench') { const h = this.handlers['bench-drop']; if (h) h({ i: d.i }); }
      else { const h = this.handlers[d.kind === 'evolve' ? 'evolve-drop' : 'energy-drop']; if (h) h({ i: d.i, uid: z.dataset.uid }); }
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
          ${game.stadium ? (() => {
            const sc = getCard(game.stadium.id); const si = cardImage(sc);
            const ic = si ? `<span class="stadium-thumb" style="background-image:url('${si}')"></span>` : '🏟';
            return `<span class="stadium-chip">${ic} ${sc.name}<small>（${game.players[game.stadium.owner].name}）</small></span>`;
          })() : ''}
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
      <span class="pill clickable" data-act="view-trash" data-side="${isOpp ? 1 : 0}">🗑 トラッシュ ${p.discard.length}</span>
      <span class="pill prize">🏅 サイド ${p.prizes.length}</span>
      <span class="pill">✋ 手札 ${p.hand.length}</span>
    </div>`;
  }

  _fieldRow(game, p, side, targets, isOpp) {
    const bench = p.bench.map((b, i) => this._pokemonCard(b, side, targets, false, i)).join('');
    const active = p.active ? this._pokemonCard(p.active, side, targets, true) : `<div class="poke empty">バトル場</div>`;
    const dz = isOpp ? '' : 'data-dropzone="bench"';
    return `<div class="field ${isOpp ? 'opp' : 'me'}">
      <div class="active-slot">${active}</div>
      <div class="bench" ${dz}>${bench || '<div class="poke empty small">ベンチ</div>'}</div>
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
        : c.category === 'Energy' ? (c.basic ? '基本エネ' : 'エネルギー')
        : c.trainerType === 'Supporter' ? 'サポート'
        : c.trainerType === 'Stadium' ? 'スタジアム'
        : c.trainerType === 'Tool' ? 'どうぐ' : 'グッズ';
      const img = cardImage(c);
      const ico = c.category === 'Pokemon' ? (TYPE_ICONS[c.type] || '⭐')
        : c.category === 'Energy' ? (TYPE_ICONS[c.energyType] || '⭐')
        : (c.trainerType === 'Supporter' ? '🧑' : c.trainerType === 'Stadium' ? '🏟' : c.trainerType === 'Tool' ? '🔧' : '🎒');
      const artStyle = img ? `background-image:url('${img}')` : `background:linear-gradient(160deg, ${color}, rgba(0,0,0,.35))`;
      const artInner = img ? '' : `<span class="hc-ico">${ico}</span>`;
      const dragKind = c.category === 'Energy' ? 'energy'
        : (c.category === 'Pokemon' && c.stage !== 'Basic') ? 'evolve'
        : (c.category === 'Pokemon' && c.stage === 'Basic') ? 'bench' : '';
      const drag = dragKind ? `draggable="true" data-drag="${dragKind}"` : '';
      return `<div class="hand-card ${sel} ${dragKind ? 'draggable-card' : ''}" data-act="hand" data-i="${i}" ${drag} style="border-top:4px solid ${color}">
        ${badge}
        <div class="hc-art" style="${artStyle}">${artInner}</div>
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

  // カードid → 表示用アイテム（画像はアンロック時のみ）
  _cardItem(id) {
    const c = getCard(id);
    const ico = c.category === 'Pokemon' ? (TYPE_ICONS[c.type] || '⭐')
      : c.category === 'Energy' ? (TYPE_ICONS[c.energyType] || '⭐')
      : (c.trainerType === 'Supporter' ? '🧑' : c.trainerType === 'Stadium' ? '🏟' : c.trainerType === 'Tool' ? '🔧' : '🎒');
    const sub = c.category === 'Pokemon' ? `${c.stage} HP${c.hp}`
      : c.category === 'Energy' ? (c.basic ? '基本エネ' : 'エネ')
      : (c.trainerType === 'Supporter' ? 'サポート' : c.trainerType === 'Stadium' ? 'スタジアム' : c.trainerType === 'Tool' ? 'どうぐ' : 'グッズ');
    return { label: c.name, sublabel: sub, imageUrl: cardImage(c), ico };
  }

  // 読み取り専用ビューア（トラッシュ確認など）
  showViewer(title, cardIds) {
    this.closePicker();
    const items = cardIds.map(id => this._cardItem(id));
    const ov = document.createElement('div');
    ov.className = 'picker-overlay';
    ov.innerHTML = `
      <div class="picker">
        <div class="picker-head">${title}<span class="picker-count">（${items.length}枚）</span></div>
        <div class="picker-list">
          ${items.length ? items.map(it => `
            <div class="picker-card view">
              <div class="pc-art${it.imageUrl ? '' : ' noimg'}" ${it.imageUrl ? `style="background-image:url('${it.imageUrl}')"` : ''}>${it.imageUrl ? '' : it.ico}</div>
              <div class="pc-name">${it.label}</div>
              <div class="pc-sub">${it.sublabel}</div>
            </div>`).join('') : '<div class="picker-empty">トラッシュは空です</div>'}
        </div>
        <div class="picker-actions"><button class="btn primary close-v">閉じる</button></div>
      </div>`;
    document.body.appendChild(ov);
    this._picker = ov;
    ov.querySelector('.close-v').addEventListener('click', () => this.closePicker());
    ov.addEventListener('click', (e) => { if (e.target === ov) this.closePicker(); });
  }

  // ログ描画（別要素）
  renderLog(logEl, log) {
    logEl.innerHTML = log.slice(-200).map(l => `<div class="log-line">${l}</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }
}
