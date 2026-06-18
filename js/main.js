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

// 効果を実装済みの実カードトレーナーズ（名前ベース・版番号に依存しない）
const NAMED_TRAINERS = {
  'ボスの指令': 1, '改造ハンマー': 1, 'なかよしポフィン': 1, 'ポケパッド': 1,
  'せいなるはい': 1, 'スイレンのお世話': 1, '夜のタンカ': 1, 'トウコ': 1,
  'ヒカリ': 1, 'ビワ': 1, 'ワンダーパッチ': 1, 'ふしぎなアメ': 1,
};

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
    ctx.actionsHtml = `<span class="hint">手札やバトルポケモンをクリックして操作（エネ・進化はポケモンに、たねはベンチにドラッグ）</span>`;
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
      const can = !g.isFirstTurnForCurrent() && g.allInPlay(p).some(x => x.cardId === c.evolvesFrom && x.placedTurn !== g.turnCount && x.evolvedTurn !== g.turnCount);
      btns += `<button data-act="a-evolve" class="btn ${can ? 'primary' : 'disabled'}">進化させる</button>`;
      if (g.isFirstTurnForCurrent()) btns += `<span class="hint">最初の番は進化できません</span>`;
    } else if (c.category === 'Energy') {
      btns += `<button data-act="a-attach" class="btn ${g.energyAttached ? 'disabled' : 'primary'}">ポケモンにつける</button>`;
    } else if (c.category === 'Trainer' && c.trainerType === 'Stadium') {
      const sameOut = g.stadium && getCard(g.stadium.id).name === c.name;
      const blocked = g.stadiumPlayed || sameOut;
      btns += `<button data-act="a-stadium" class="btn ${blocked ? 'disabled' : 'primary'}">スタジアムを出す</button>`;
      btns += `<span class="hint">${sameOut ? '同名のスタジアムが出ています' : (c.text || '')}</span>`;
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
    const inst = g._findInPlay(p, this.pokeMenu); if (!inst) return '';
    const isActive = p.active && p.active.uid === inst.uid;
    let btns = `<span class="hint">${inst.card.name}：</span>`;
    if (isActive) {
      (inst.card.attacks || []).forEach((atk, idx) => {
        const can = g.canUseAttack(inst, atk)
          && !(g.turnCount === 1 && g.turnPlayer === g.firstPlayer)
          && !inst.status.has('asleep') && !inst.status.has('paralyzed');
        const cost = Object.entries(atk.cost).map(([t, n]) => `${t}×${n}`).join(' ');
        btns += `<button data-act="a-attack" data-idx="${idx}" class="btn ${can ? 'danger' : 'disabled'}">${atk.name}${atk.damage ? ' ' + atk.damage : ''} <small>[${cost}]</small></button>`;
      });
      const cost = inst.card.retreat || 0;
      const canRetreat = !g.retreatedThisTurn && p.bench.length > 0 && inst.energy.length >= cost
        && !inst.status.has('asleep') && !inst.status.has('paralyzed');
      btns += `<button data-act="a-retreat" class="btn ${canRetreat ? '' : 'disabled'}">にげる <small>[エネ${cost}]</small></button>`;
    }
    // 起動特性
    if (g.isActivatedAbility(inst.card)) {
      const ok = g.canUseAbility(inst).ok;
      btns += `<button data-act="a-ability" class="btn ${ok ? 'primary' : 'disabled'}">特性「${inst.card.ability.name}」</button>`;
    }
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
    u.on('a-stadium', () => this.act(this.game.playStadium(this.sel.hand)));
    u.on('a-attack', (d) => this.onAttack(+d.idx));
    u.on('a-retreat', () => this.enterRetreatTarget());
    u.on('energy-drop', (d) => this.onEnergyDrop(d.i, d.uid));
    u.on('evolve-drop', (d) => this.onEvolveDrop(d.i, d.uid));
    u.on('bench-drop', (d) => this.onBenchDrop(d.i));
    u.on('view-trash', (d) => {
      const side = +d.side;
      this.ui.showViewer(`${this.game.players[side].name} のトラッシュ`, this.game.players[side].discard);
    });
    u.on('a-ability', () => {
      const res = this.game.useAbility(this.pokeMenu);
      if (!res.ok) { this.flash = res.error; this.render(); return; }
      this.pokeMenu = null; this.sel.hand = null; this.render();
    });
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
    if (this._busy()) return;   // 対話中は新しい手札操作を受け付けない
    this.pokeMenu = null;
    this.sel.hand = (this.sel.hand === i) ? null : i;
    this.render();
  }

  // エネルギーをドラッグ&ドロップで付ける
  onEnergyDrop(handIndex, uid) {
    const g = this.game;
    if (g.turnPlayer !== HUMAN || g.phase !== 'main') { this.flash = '今は操作できません'; this.render(); return; }
    if (this._busy()) return;
    this.attachEnergyAt(handIndex, uid);
  }

  // エネルギーを付け、特殊エネの「つけたとき」効果を解決
  attachEnergyAt(handIndex, uid) {
    const g = this.game, p = g.players[HUMAN];
    const energyId = p.hand[handIndex];
    const res = g.attachEnergy(handIndex, uid);
    if (!res.ok) { this.flash = res.error; this.render(); return false; }
    this.sel.hand = null; this.pokeMenu = null; this.targetMode = null;
    this.afterAttach(energyId);
    this.render();
    return true;
  }

  // 特殊エネルギーの「手札からつけたとき」効果
  afterAttach(energyId) {
    const g = this.game, p = g.players[HUMAN];
    const c = getCard(energyId);
    if (c.category !== 'Energy' || !c.special) return;
    if (c.name === 'リッチエネルギー') {
      g.effectDraw(4, c.name);
    } else if (c.name === 'テレパス超エネルギー') {
      const type = c.energyType;
      const space = 5 - p.bench.length;
      const items = this.deckItems(cc => cc.category === 'Pokemon' && cc.stage === 'Basic' && cc.type === type);
      if (!items.length || space <= 0) return;
      this.ui.showPicker({ title: `テレパス超エネルギー：${type}のたねを2枚までベンチに`, items, min: 0, max: Math.min(2, space), optional: true },
        (keys) => { if (keys.length) g.searchDeckToBench(keys); this.render(); }, () => this.render());
    }
  }

  // たねポケモンをベンチ領域へドラッグ&ドロップで展開
  onBenchDrop(handIndex) {
    const g = this.game;
    if (g.turnPlayer !== HUMAN || g.phase !== 'main') { this.flash = '今は操作できません'; this.render(); return; }
    if (this._busy()) return;
    const res = g.playBasicToBench(handIndex);
    if (!res.ok) { this.flash = res.error; this.render(); return; }
    this.sel.hand = null; this.pokeMenu = null; this.targetMode = null;
    this.render();
  }

  // 進化カードをドラッグ&ドロップで対象に進化
  onEvolveDrop(handIndex, uid) {
    const g = this.game;
    if (g.turnPlayer !== HUMAN || g.phase !== 'main') { this.flash = '今は操作できません'; this.render(); return; }
    if (this._busy()) return;
    const res = g.evolve(handIndex, uid);
    if (!res.ok) { this.flash = res.error; this.render(); return; }
    this.sel.hand = null; this.pokeMenu = null; this.targetMode = null;
    this.render();
  }

  // ワザ使用（対象選択が要るワザは相手ポケモンを選んでから解決）
  onAttack(idx) {
    const g = this.game, p = g.players[HUMAN];
    if (this._busy()) return;
    const atk = p.active && p.active.card.attacks[idx];
    if (!atk) return;
    if (g.attackNeedsTarget(atk)) {
      const opp = g.players[1];
      const uids = new Set(g.allInPlay(opp).map(x => x.uid));
      if (!uids.size) { this.flash = '対象がいません'; this.render(); return; }
      this.targetMode = {
        uids, prompt: 'ダメージを与える相手ポケモンを選んでください',
        pick: (uid) => { this.pokeMenu = null; this.act(g.useAttack(idx, { targetUid: uid }), true); },
      };
      this.render();
    } else {
      this.act(g.useAttack(idx), true);
    }
  }

  // ポケモンクリック
  onPoke(uid, side) {
    const g = this.game;
    if (this.targetMode && this.targetMode.uids.has(uid)) { this.targetMode.pick(uid); return; }
    if (g.turnPlayer !== HUMAN || g.phase !== 'main') return;
    // 自分のポケモン（アクティブ/ベンチ）→ 行動メニュー（ワザ・にげる・特性）
    if (side === '0' && g._findInPlay(g.players[HUMAN], uid)) {
      this.sel.hand = null;
      this.pokeMenu = (this.pokeMenu === uid) ? null : uid;
      this.render();
    }
  }

  // 対話中（カード選択モーダル表示中、または対象選択待ち）か
  _busy() { return !!(this.ui._picker || this.targetMode); }

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
    if (g.isFirstTurnForCurrent()) { this.flash = 'おたがいの最初の番は進化できません'; this.render(); return; }
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
    this.targetMode = { uids, prompt: 'エネルギーをつけるポケモンを選んでください', pick: (uid) => this.attachEnergyAt(i, uid) };
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
    if (this._busy()) return;   // 対話中（別カードの選択待ち）は新たに使えない
    const g = this.game, p = g.players[HUMAN], i = this.sel.hand;
    const c = getCard(p.hand[i]);
    // 名前ベースで実装済みの実カードトレーナー
    if (NAMED_TRAINERS[c.name]) {
      const v = g.canPlayTrainer(c);
      if (!v.ok) { this.flash = v.error; this.render(); return; }
      this.runNamedTrainer(c);
      return;
    }
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

  // ---- 実カードのトレーナーズ効果（オーケストレーション） ----
  _sub(c) {
    if (c.category === 'Pokemon') return `${c.stage} HP${c.hp}`;
    if (c.category === 'Energy') return c.basic ? '基本エネ' : '特殊エネ';
    return c.trainerType || 'トレーナー';
  }
  deckItems(filter) {
    const p = this.game.players[HUMAN]; const out = [];
    p.deck.forEach(id => { const c = getCard(id); if (filter(c)) out.push({ key: id, label: c.name, sublabel: this._sub(c), imageUrl: c.imageUrl, cardId: id }); });
    return out;
  }
  discardItems(filter) {
    const p = this.game.players[HUMAN]; const out = [];
    p.discard.forEach((id, idx) => { const c = getCard(id); if (filter(c)) out.push({ key: idx, label: c.name, sublabel: this._sub(c), imageUrl: c.imageUrl, cardId: id }); });
    return out;
  }
  finishTrainer() { this.sel.hand = null; this.targetMode = null; this.pokeMenu = null; this.render(); }

  runNamedTrainer(card) {
    const g = this.game, p = g.players[HUMAN], opp = g.players[1];
    const consume = () => { g.consumeTrainerById(card.id); this.finishTrainer(); };
    const isPoke = c => c.category === 'Pokemon';
    const isBasicEnergy = c => c.category === 'Energy' && c.basic;

    switch (card.name) {
      case 'ボスの指令': {
        if (opp.bench.length === 0) { this.flash = '相手のベンチにポケモンがいません'; this.render(); return; }
        this.targetMode = { uids: new Set(opp.bench.map(b => b.uid)), prompt: '相手のベンチから1匹選んでバトル場に', pick: (uid) => { g.gustOpponent(opp.bench.findIndex(b => b.uid === uid)); consume(); } };
        this.render(); break;
      }
      case '改造ハンマー': {
        const targets = g.allInPlay(opp).filter(x => x.energy.some(eid => getCard(eid).special));
        if (!targets.length) { this.flash = '相手に特殊エネルギーがついたポケモンがいません'; this.render(); return; }
        this.targetMode = { uids: new Set(targets.map(t => t.uid)), prompt: '特殊エネをトラッシュする相手ポケモンを選ぶ', pick: (uid) => { g.discardSpecialEnergy(uid); consume(); } };
        this.render(); break;
      }
      case 'なかよしポフィン': {
        const space = 5 - p.bench.length;
        if (space <= 0) { this.flash = 'ベンチがいっぱいです'; this.render(); return; }
        this.ui.showPicker({ title: 'なかよしポフィン：HP70以下のたねを2枚までベンチに', items: this.deckItems(c => isPoke(c) && c.stage === 'Basic' && c.hp <= 70), min: 0, max: Math.min(2, space), optional: true },
          (keys) => { if (keys.length) g.searchDeckToBench(keys); consume(); }, () => this.finishTrainer());
        break;
      }
      case 'ポケパッド': {
        this.ui.showPicker({ title: 'ポケパッド：ポケモンを1枚手札に', items: this.deckItems(isPoke), min: 1, max: 1 },
          (keys) => { g.searchDeckToHand(keys); consume(); }, () => this.finishTrainer());
        break;
      }
      case 'せいなるはい': {
        this.ui.showPicker({ title: 'せいなるはい：トラッシュのポケモンを5枚まで山札へ', items: this.discardItems(isPoke), min: 0, max: 5, optional: true },
          (keys) => { if (keys.length) g.moveDiscardToDeck(keys); consume(); }, () => this.finishTrainer());
        break;
      }
      case 'スイレンのお世話': {
        this.ui.showPicker({ title: 'スイレンのお世話：トラッシュのポケモン/基本エネを3枚まで手札に', items: this.discardItems(c => isPoke(c) || isBasicEnergy(c)), min: 0, max: 3, optional: true },
          (keys) => { if (keys.length) g.moveDiscardToHand(keys); consume(); }, () => this.finishTrainer());
        break;
      }
      case '夜のタンカ': {
        this.ui.showPicker({ title: '夜のタンカ：トラッシュのポケモン/基本エネを1枚手札に', items: this.discardItems(c => isPoke(c) || isBasicEnergy(c)), min: 1, max: 1 },
          (keys) => { g.moveDiscardToHand(keys); consume(); }, () => this.finishTrainer());
        break;
      }
      case 'トウコ': {
        this.ui.showPicker({ title: 'トウコ①：進化ポケモンを1枚', items: this.deckItems(c => isPoke(c) && c.stage !== 'Basic'), min: 0, max: 1, optional: true },
          (k1) => {
            this.ui.showPicker({ title: 'トウコ②：エネルギーを1枚', items: this.deckItems(c => c.category === 'Energy'), min: 0, max: 1, optional: true },
              (k2) => { const ids = [...k1, ...k2]; if (ids.length) g.searchDeckToHand(ids); consume(); }, () => this.finishTrainer());
          }, () => this.finishTrainer());
        break;
      }
      case 'ヒカリ': {
        this.ui.showPicker({ title: 'ヒカリ①：たねポケモンを1枚', items: this.deckItems(c => isPoke(c) && c.stage === 'Basic'), min: 0, max: 1, optional: true },
          (k1) => this.ui.showPicker({ title: 'ヒカリ②：1進化ポケモンを1枚', items: this.deckItems(c => isPoke(c) && c.stage === 'Stage1'), min: 0, max: 1, optional: true },
            (k2) => this.ui.showPicker({ title: 'ヒカリ③：2進化ポケモンを1枚', items: this.deckItems(c => isPoke(c) && c.stage === 'Stage2'), min: 0, max: 1, optional: true },
              (k3) => { const ids = [...k1, ...k2, ...k3]; if (ids.length) g.searchDeckToHand(ids); consume(); }, () => this.finishTrainer()),
            () => this.finishTrainer()),
          () => this.finishTrainer());
        break;
      }
      case 'ビワ': {
        const items = opp.hand.map((id, idx) => ({ id, idx })).filter(x => { const c = getCard(x.id); return c.category === 'Trainer' && c.trainerType === 'Item'; })
          .map(x => ({ key: x.idx, label: getCard(x.id).name, sublabel: 'グッズ', imageUrl: getCard(x.id).imageUrl, cardId: x.id }));
        this.ui.showPicker({ title: 'ビワ：相手の手札のグッズを2枚までトラッシュ', items, min: 0, max: 2, optional: true },
          (keys) => { if (keys.length) g.opponentDiscardFromHand(keys); consume(); }, () => this.finishTrainer());
        break;
      }
      case 'ワンダーパッチ': {
        const items = this.discardItems(isBasicEnergy);
        if (!items.length) { this.flash = 'トラッシュに基本エネルギーがありません'; this.render(); return; }
        if (p.bench.length === 0) { this.flash = 'ベンチにポケモンがいません'; this.render(); return; }
        this.ui.showPicker({ title: 'ワンダーパッチ：トラッシュの基本エネを選ぶ', items, min: 1, max: 1 }, (keys) => {
          const di = keys[0];
          this.targetMode = { uids: new Set(p.bench.map(b => b.uid)), prompt: 'エネルギーをつけるベンチポケモンを選ぶ', pick: (uid) => { g.attachEnergyFromDiscard(di, uid); consume(); } };
          this.render();
        }, () => this.finishTrainer());
        break;
      }
      case 'ふしぎなアメ': {
        if (g.isFirstTurnForCurrent()) { this.flash = 'おたがいの最初の番は進化できません'; this.render(); return; }
        const stage2InHand = p.hand.filter(id => { const c = getCard(id); return c.category === 'Pokemon' && c.stage === 'Stage2'; });
        const matches = (inst, s2id) => { const s1 = getCard(s2id).evolvesFrom ? getCard(getCard(s2id).evolvesFrom) : null; return s1 && s1.evolvesFrom === inst.cardId; };
        const candidates = g.allInPlay(p).filter(inst => inst.card.stage === 'Basic' && inst.placedTurn !== g.turnCount && stage2InHand.some(s2 => matches(inst, s2)));
        if (!candidates.length) { this.flash = '対象がいません（対応する2進化が手札に必要）'; this.render(); return; }
        this.targetMode = { uids: new Set(candidates.map(x => x.uid)), prompt: 'ふしぎなアメで進化させるたねを選ぶ', pick: (uid) => {
          const inst = g._findInPlay(p, uid);
          const s2s = stage2InHand.filter(s2 => matches(inst, s2));
          this.targetMode = null;
          this.ui.showPicker({ title: 'のせる2進化ポケモンを選ぶ', items: s2s.map(id => ({ key: id, label: getCard(id).name, sublabel: '2進化', imageUrl: getCard(id).imageUrl, cardId: id })), min: 1, max: 1 },
            (keys) => { g.rareCandyEvolve(keys[0], uid); consume(); }, () => this.finishTrainer());
        } };
        this.render(); break;
      }
      default: { this.flash = 'このカードは未対応です'; this.render(); }
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

// デッキ選択肢を再構築（自分用・あいて用とも）。defaults={human, ai}
function populateDeckSelect(decks, defaults = {}) {
  const opts = Object.entries(decks).map(([k, d]) => `<option value="${k}">${d.name}</option>`).join('');
  const setSel = (id, def) => {
    const sel = document.getElementById(id); if (!sel) return;
    sel.innerHTML = opts;
    if (def && decks[def]) sel.value = def;
  };
  setSel('deck-select', defaults.human);
  setSel('ai-deck-select', defaults.ai);
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
    // 既定: 自分=取り込み(あれば)、あいて=相手デッキ(あれば)→無ければ取り込みミラー→無ければ別の組込デッキ
    const dk = ctrl.decks;
    const humanDef = dk.imported ? 'imported' : (dk.mydeck ? 'mydeck' : 'fire');
    const aiDef = dk.imported2 ? 'imported2' : (dk.imported ? 'imported' : 'water');
    populateDeckSelect(dk, { human: humanDef, ai: aiDef });
  })();

  document.getElementById('start-btn').addEventListener('click', () => {
    const keys = Object.keys(ctrl.decks);
    const human = document.getElementById('deck-select').value || keys[0];
    const ai = document.getElementById('ai-deck-select').value || (keys.find(k => k !== human)) || human;
    document.getElementById('menu').style.display = 'none';
    document.getElementById('game').style.display = 'flex';
    ctrl.startGame(human, ai);
  });
});
