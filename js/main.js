// ============================================================
//  コントローラ（人間の操作・セットアップ・AIターン進行の配線）
// ============================================================

import { Game } from './engine/game.js';
import { AI } from './ai/ai.js';
import { UI, setImagesEnabled } from './ui/ui.js';
import { DECKS, getCard, registerLocalCards, buildAutoDeck } from './data/cards.js';
import { checkUnlocked } from './auth.js';

const HUMAN = 0;
const AI_IDX = 1;

class Controller {
  constructor() {
    this.boardEl = document.getElementById('board');
    this.logEl = document.getElementById('log');
    this.ui = new UI(this.boardEl);
    this.bindHandlers();
    this.reset();
  }

  reset() {
    this.sel = { hand: null };     // 選択中の手札index
    this.pokeMenu = null;          // 攻撃メニューを開いているアクティブのuid
    this.targetMode = null;        // { uids:Set, pick:(uid)=>void, prompt }
    this.setupSel = [];            // セットアップで選んだ手札index（先頭=バトル場）
    this.flash = '';               // 一時メッセージ
    this.aiRunning = false;
  }

  startGame(deckHumanKey = 'fire', deckAiKey = 'water') {
    this.reset();
    const decks = this.decks || DECKS;
    const g = new Game(decks[deckHumanKey] || DECKS.fire, decks[deckAiKey] || DECKS.water);
    this.game = g;
    this.ai = new AI(g, AI_IDX);
    g.onChange = () => this.render();
    g.start();
    g.autoSetup(AI_IDX);   // AIのセットアップは自動
    this.render();
  }

  // ---- 描画 ----
  render() {
    const ctx = this.buildCtx();
    this.ui.render(this.game, ctx);
    this.ui.renderLog(this.logEl, this.game.log);
    this.flash = '';
  }

  buildCtx() {
    const g = this.game;
    const ctx = { selHand: this.sel.hand, targets: new Set(), banner: this.flash, actionsHtml: '', canEnd: false };
    if (!g) return ctx;
    if (g.winner != null) {
      ctx.banner = `🏆 ${g.players[g.winner].name} の勝ち！（${g.winReason}）`;
      return ctx;
    }

    // セットアップ
    if (g.phase === 'setup' && !g.players[HUMAN].setupDone) {
      ctx.banner = this.flash || 'バトル場に出すたねポケモンを手札から選び、「決定」を押してください（最初に選んだ1匹がバトル場、残りはベンチ）。';
      this.setupSel.forEach((i, k) => {}); // 選択は手札のsel表示で
      const ok = this.setupSel.length >= 1;
      const names = this.setupSel.map((i, k) => `${k === 0 ? '★' : '・'}${getCard(g.players[HUMAN].hand[i]).name}`).join(' ');
      ctx.actionsHtml = `<span class="hint">${names || '（未選択）'}</span>
        <button data-act="setup-ok" class="btn ${ok ? 'primary' : 'disabled'}">決定</button>
        <button data-act="setup-clear" class="btn">クリア</button>`;
      ctx.selHandMulti = new Set(this.setupSel);
      return ctx;
    }

    // 相手の番
    if (g.turnPlayer === AI_IDX) {
      ctx.banner = 'あいての番…';
      return ctx;
    }

    // 自分の昇格が必要
    if (g.needsPromotion(HUMAN)) {
      ctx.banner = 'バトルポケモンがいません。ベンチから1匹を選んでバトル場に出してください。';
      ctx.targets = new Set(g.players[HUMAN].bench.map(b => b.uid));
      this.targetMode = {
        uids: ctx.targets,
        pick: (uid) => {
          const idx = g.players[HUMAN].bench.findIndex(b => b.uid === uid);
          g.promote(HUMAN, idx);
          this.targetMode = null;
          this.afterHumanAction();
        },
      };
      return ctx;
    }

    // 通常メイン
    ctx.canEnd = true;
    if (this.targetMode) {
      ctx.targets = this.targetMode.uids;
      ctx.banner = this.targetMode.prompt || '対象を選んでください';
      ctx.actionsHtml = `<button data-act="cancel" class="btn">やめる</button>`;
      return ctx;
    }
    if (this.pokeMenu) {
      ctx.actionsHtml = this.attackMenuHtml();
      return ctx;
    }
    if (this.sel.hand != null) {
      ctx.actionsHtml = this.handActionsHtml(this.sel.hand);
      return ctx;
    }
    ctx.actionsHtml = `<span class="hint">手札やバトルポケモンをクリックして操作</span>`;
    return ctx;
  }

  handActionsHtml(i) {
    const g = this.game, p = g.players[HUMAN];
    const id = p.hand[i]; if (!id) return '';
    const c = getCard(id);
    let btns = '';
    if (c.category === 'Pokemon' && c.stage === 'Basic') {
      const full = p.bench.length >= 5;
      btns += `<button data-act="a-bench" class="btn ${full ? 'disabled' : 'primary'}">ベンチに出す</button>`;
    } else if (c.category === 'Pokemon') {
      const can = g.allInPlay(p).some(x => x.cardId === c.evolvesFrom && x.placedTurn !== g.turnCount && x.evolvedTurn !== g.turnCount);
      btns += `<button data-act="a-evolve" class="btn ${can ? 'primary' : 'disabled'}">進化させる</button>`;
    } else if (c.category === 'Energy') {
      btns += `<button data-act="a-attach" class="btn ${g.energyAttached ? 'disabled' : 'primary'}">ポケモンにつける</button>`;
    } else if (c.category === 'Trainer') {
      const blocked = c.trainerType === 'Supporter' && (g.supporterPlayed || (g.turnCount === 1 && g.turnPlayer === g.firstPlayer));
      btns += `<button data-act="a-trainer" class="btn ${blocked ? 'disabled' : 'primary'}">使う</button>`;
      btns += `<span class="hint">${c.text || ''}</span>`;
    }
    btns += `<button data-act="cancel" class="btn">やめる</button>`;
    return btns;
  }

  attackMenuHtml() {
    const g = this.game, p = g.players[HUMAN];
    const a = p.active; if (!a) return '';
    let btns = `<span class="hint">${a.card.name}：</span>`;
    (a.card.attacks || []).forEach((atk, idx) => {
      const can = g.canUseAttack(a, atk)
        && !(g.turnCount === 1 && g.turnPlayer === g.firstPlayer)
        && !a.status.has('asleep') && !a.status.has('paralyzed');
      const cost = Object.entries(atk.cost).map(([t, n]) => `${t}×${n}`).join(' ');
      btns += `<button data-act="a-attack" data-idx="${idx}" class="btn ${can ? 'danger' : 'disabled'}">${atk.name}${atk.damage ? ' ' + atk.damage : ''} <small>[${cost}]</small></button>`;
    });
    const cost = a.card.retreat || 0;
    const canRetreat = !g.retreatedThisTurn && p.bench.length > 0 && a.energy.length >= cost
      && !a.status.has('asleep') && !a.status.has('paralyzed');
    btns += `<button data-act="a-retreat" class="btn ${canRetreat ? '' : 'disabled'}">にげる <small>[エネ${cost}]</small></button>`;
    btns += `<button data-act="cancel" class="btn">やめる</button>`;
    return btns;
  }

  // ---- 操作ハンドラ登録 ----
  bindHandlers() {
    const u = this.ui;
    u.on('newgame', () => this.startGame());
    u.on('hand', (d) => this.onHand(+d.i));
    u.on('poke', (d) => this.onPoke(d.uid, d.side, d.bench));
    u.on('cancel', () => { this.sel.hand = null; this.pokeMenu = null; this.targetMode = null; this.render(); });
    u.on('endturn', () => this.onEndTurn());
    u.on('setup-ok', () => this.onSetupConfirm());
    u.on('setup-clear', () => { this.setupSel = []; this.render(); });
    u.on('a-bench', () => this.act(this.game.playBasicToBench(this.sel.hand)));
    u.on('a-evolve', () => this.enterEvolveTarget());
    u.on('a-attach', () => this.enterAttachTarget());
    u.on('a-trainer', () => this.onTrainer());
    u.on('a-attack', (d) => this.act(this.game.useAttack(+d.idx), true));
    u.on('a-retreat', () => this.enterRetreatTarget());
  }

  // 手札クリック
  onHand(i) {
    const g = this.game;
    if (g.phase === 'setup' && !g.players[HUMAN].setupDone) {
      const c = getCard(g.players[HUMAN].hand[i]);
      if (c.category !== 'Pokemon' || c.stage !== 'Basic') { this.flash = 'たねポケモンのみ選べます'; this.render(); return; }
      const at = this.setupSel.indexOf(i);
      if (at >= 0) this.setupSel.splice(at, 1); else this.setupSel.push(i);
      this.render();
      return;
    }
    if (g.turnPlayer !== HUMAN || g.phase !== 'main') return;
    if (this.targetMode) return;
    this.pokeMenu = null;
    this.sel.hand = (this.sel.hand === i) ? null : i;
    this.render();
  }

  // ポケモンクリック
  onPoke(uid, side) {
    const g = this.game;
    if (this.targetMode && this.targetMode.uids.has(uid)) { this.targetMode.pick(uid); return; }
    if (g.turnPlayer !== HUMAN || g.phase !== 'main') return;
    if (side === '0' && g.players[HUMAN].active && g.players[HUMAN].active.uid === uid) {
      // 自分のアクティブ → 攻撃メニュー
      this.sel.hand = null;
      this.pokeMenu = (this.pokeMenu === uid) ? null : uid;
      this.render();
    }
  }

  // ---- 各アクション ----
  act(res, mayEndTurn = false) {
    if (!res.ok) { this.flash = res.error || '実行できません'; this.render(); return false; }
    this.sel.hand = null;
    this.targetMode = null;
    if (mayEndTurn) this.pokeMenu = null;
    this.render();
    // 攻撃するとそのターンの行動は終わり → 自動でターン終了に進む
    if (mayEndTurn && !this.game.hasAttacked) { /* こんらん自滅以外 */ }
    if (mayEndTurn) this.onEndTurn();
    return true;
  }

  enterEvolveTarget() {
    const g = this.game, p = g.players[HUMAN], i = this.sel.hand;
    const c = getCard(p.hand[i]);
    const uids = new Set(g.allInPlay(p)
      .filter(x => x.cardId === c.evolvesFrom && x.placedTurn !== g.turnCount && x.evolvedTurn !== g.turnCount)
      .map(x => x.uid));
    if (uids.size === 0) { this.flash = '進化できる対象がいません'; this.render(); return; }
    this.targetMode = { uids, prompt: '進化させるポケモンを選んでください', pick: (uid) => this.act(g.evolve(i, uid)) };
    this.render();
  }

  enterAttachTarget() {
    const g = this.game, p = g.players[HUMAN], i = this.sel.hand;
    if (g.energyAttached) { this.flash = 'このターンはもうつけました'; this.render(); return; }
    const uids = new Set(g.allInPlay(p).map(x => x.uid));
    if (uids.size === 0) { this.flash = '対象がいません'; this.render(); return; }
    this.targetMode = { uids, prompt: 'エネルギーをつけるポケモンを選んでください', pick: (uid) => this.act(g.attachEnergy(i, uid)) };
    this.render();
  }

  enterRetreatTarget() {
    const g = this.game, p = g.players[HUMAN];
    const uids = new Set(p.bench.map(b => b.uid));
    if (uids.size === 0) { this.flash = 'ベンチにポケモンがいません'; this.render(); return; }
    this.targetMode = {
      uids, prompt: 'にげて入れ替えるベンチポケモンを選んでください',
      pick: (uid) => {
        const idx = p.bench.findIndex(b => b.uid === uid);
        const res = g.retreat(idx);
        this.pokeMenu = null;
        this.act(res);
      },
    };
    this.render();
  }

  onTrainer() {
    const g = this.game, p = g.players[HUMAN], i = this.sel.hand;
    const c = getCard(p.hand[i]);
    const res = g.playTrainer(i);
    if (res.ok) { this.act(res); return; }
    if (res.needTarget === 'ownPokemon') {
      const uids = new Set(g.allInPlay(p).filter(x => x.damage > 0).map(x => x.uid));
      if (uids.size === 0) { this.flash = '対象がいません'; this.render(); return; }
      this.targetMode = { uids, prompt: c.text || '対象を選んでください', pick: (uid) => this.act(g.playTrainer(i, { targetUid: uid })) };
      this.render();
    } else if (res.needTarget === 'ownBench') {
      const uids = new Set(p.bench.map(b => b.uid));
      if (uids.size === 0) { this.flash = 'ベンチにポケモンがいません'; this.render(); return; }
      this.targetMode = {
        uids, prompt: '入れ替え先を選んでください',
        pick: (uid) => { const idx = p.bench.findIndex(b => b.uid === uid); this.act(g.playTrainer(i, { benchIndex: idx })); },
      };
      this.render();
    } else {
      this.flash = res.error || '使えません';
      this.render();
    }
  }

  onSetupConfirm() {
    const g = this.game;
    if (this.setupSel.length < 1) { this.flash = 'たねを1匹以上選んでください'; this.render(); return; }
    const res = g.doSetup(HUMAN, this.setupSel[0], this.setupSel.slice(1));
    if (!res.ok) { this.flash = res.error; this.render(); return; }
    this.setupSel = [];
    this.render();
    this.maybeRunAI();
  }

  onEndTurn() {
    const g = this.game;
    if (g.turnPlayer !== HUMAN) return;
    if (g.needsPromotion(HUMAN)) { this.flash = '先にバトルポケモンを出してください'; this.render(); return; }
    const res = g.endTurn();
    if (!res.ok) { this.flash = res.error; this.render(); return; }
    this.sel.hand = null; this.pokeMenu = null; this.targetMode = null;
    this.render();
    this.maybeRunAI();
  }

  afterHumanAction() {
    this.render();
    this.maybeRunAI();
  }

  // AIの番なら実行（少し間を置く）
  maybeRunAI() {
    const g = this.game;
    if (g.winner != null) return;
    if (g.turnPlayer !== AI_IDX || this.aiRunning) return;
    this.aiRunning = true;
    this.render();
    setTimeout(() => {
      try { this.ai.takeTurn(); } finally { this.aiRunning = false; }
      this.render();
    }, 700);
  }
}

// デッキ選択肢を再構築
function populateDeckSelect(decks) {
  const sel = document.getElementById('deck-select');
  sel.innerHTML = Object.entries(decks)
    .map(([k, d]) => `<option value="${k}">${d.name}</option>`).join('');
}

// 起動
window.addEventListener('DOMContentLoaded', () => {
  const ctrl = new Controller();
  window.__ctrl = ctrl; // デバッグ用フック
  ctrl.decks = { ...DECKS };

  // ローカル・アンロック判定（パスワード一致時のみ実カード＋画像を有効化）
  (async () => {
    const unlocked = await checkUnlocked();
    if (unlocked && window.__LOCAL_CARDS && window.__LOCAL_CARDS.byNumber) {
      registerLocalCards(window.__LOCAL_CARDS.byNumber, window.__LOCAL_DECKS || null);
      setImagesEnabled(true);
      if (window.__LOCAL_DECKS) {
        ctrl.decks = { ...ctrl.decks, ...window.__LOCAL_DECKS };
      } else {
        const nums = Object.keys(window.__LOCAL_CARDS.byNumber);
        if (nums.length) ctrl.decks = { ...ctrl.decks, mydeck: buildAutoDeck(nums, getCard) };
      }
      const badge = document.getElementById('unlock-badge');
      if (badge) badge.style.display = 'inline';
    }
    populateDeckSelect(ctrl.decks);
  })();

  document.getElementById('start-btn').addEventListener('click', () => {
    const keys = Object.keys(ctrl.decks);
    const human = document.getElementById('deck-select').value || keys[0];
    const ai = (keys.find(k => k !== human)) || human;
    document.getElementById('menu').style.display = 'none';
    document.getElementById('game').style.display = 'flex';
    ctrl.startGame(human, ai);
  });
});
