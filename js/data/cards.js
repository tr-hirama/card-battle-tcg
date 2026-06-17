// ============================================================
//  カードマスタデータ（プレースホルダー / オリジナル）
//  本物のポケモンの名称・画像は使わず、汎用タイプ＋オリジナル名で構成。
//  後から自由に差し替え・追加できるよう、すべて「データ」として定義する。
// ============================================================

// タイプ（公式の全エネルギータイプ）
export const TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless'];

// タイプ別の色（UI用）
export const TYPE_COLORS = {
  Grass:    '#4caf50',
  Fire:     '#f4511e',
  Water:    '#29b6f6',
  Lightning:'#fdd835',
  Psychic:  '#ab47bc',
  Fighting: '#8d6e63',
  Darkness: '#455a64',
  Metal:    '#90a4ae',
  Dragon:   '#c9a227',
  Fairy:    '#ec407a',
  Colorless:'#bdbdbd',
};

// タイプの絵文字（簡易アイコン）
export const TYPE_ICONS = {
  Grass: '🌿', Fire: '🔥', Water: '💧', Lightning: '⚡',
  Psychic: '🔮', Fighting: '👊', Darkness: '🌑', Metal: '⚙️',
  Dragon: '🐉', Fairy: '🧚', Colorless: '⭐',
};

// pokemon-card.com の icon クラス → タイプ名
export const PCG_ICON_TYPE = {
  grass: 'Grass', fire: 'Fire', water: 'Water', lightning: 'Lightning',
  psychic: 'Psychic', fighting: 'Fighting', darkness: 'Darkness', dark: 'Darkness',
  metal: 'Metal', dragon: 'Dragon', fairy: 'Fairy', none: 'Colorless',
};

// ------------------------------------------------------------
//  カード定義
//  category: 'Pokemon' | 'Energy' | 'Trainer'
//
//  Pokemon:
//    type, hp, stage('Basic'|'Stage1'|'Stage2'), evolvesFrom,
//    weakness:{type,mult}, resistance:{type,minus}, retreat(コスト数),
//    attacks:[{ name, cost:{Type:n,...}, damage, text, effect }]
//    ability:{ name, text }   ← v1ではテキスト表示のみ
//
//  Energy:
//    energyType, basic(bool)
//
//  Trainer:
//    trainerType('Item'|'Supporter'), text, effect
//
//  effect: エンジンが解釈する記述オブジェクト（下の engine/effects.js 参照）
// ------------------------------------------------------------

export const CARDS = {
  // ===== 草 =====
  'sprout': {
    id: 'sprout', name: 'スプラウト', category: 'Pokemon', type: 'Grass',
    hp: 60, stage: 'Basic',
    weakness: { type: 'Fire', mult: 2 }, retreat: 1,
    attacks: [
      { name: 'たいあたり', cost: { Colorless: 1 }, damage: 10 },
      { name: 'やどりタネ', cost: { Grass: 1 }, damage: 10, text: '相手をどく状態にする。', effect: { status: 'poisoned' } },
    ],
  },
  'verdan': {
    id: 'verdan', name: 'ヴェルダン', category: 'Pokemon', type: 'Grass',
    hp: 100, stage: 'Stage1', evolvesFrom: 'sprout',
    weakness: { type: 'Fire', mult: 2 }, retreat: 2,
    attacks: [
      { name: 'リーフカッター', cost: { Grass: 1, Colorless: 1 }, damage: 40 },
      { name: 'メガドレイン', cost: { Grass: 2, Colorless: 1 }, damage: 60, text: '自分のHPを20回復する。', effect: { heal: 20 } },
    ],
  },

  // ===== 炎 =====
  'embor': {
    id: 'embor', name: 'エンボル', category: 'Pokemon', type: 'Fire',
    hp: 70, stage: 'Basic',
    weakness: { type: 'Water', mult: 2 }, retreat: 1,
    attacks: [
      { name: 'ひっかく', cost: { Colorless: 1 }, damage: 10 },
      { name: 'ひのこ', cost: { Fire: 1, Colorless: 1 }, damage: 30, text: 'コインを投げてオモテなら相手をやけど状態にする。', effect: { coinFlip: { onHeads: { status: 'burned' } } } },
    ],
  },
  'pyrax': {
    id: 'pyrax', name: 'パイラックス', category: 'Pokemon', type: 'Fire',
    hp: 130, stage: 'Stage1', evolvesFrom: 'embor',
    weakness: { type: 'Water', mult: 2 }, retreat: 2,
    ability: { name: 'ねっぷう', text: '（v1では未実装）' },
    attacks: [
      { name: 'かえんほうしゃ', cost: { Fire: 2, Colorless: 1 }, damage: 90, text: '炎エネルギーを1個トラッシュする。', effect: { discardEnergy: { type: 'Fire', count: 1 } } },
    ],
  },

  // ===== 水 =====
  'aqualet': {
    id: 'aqualet', name: 'アクアレット', category: 'Pokemon', type: 'Water',
    hp: 60, stage: 'Basic',
    weakness: { type: 'Lightning', mult: 2 }, retreat: 1,
    attacks: [
      { name: 'みずでっぽう', cost: { Water: 1 }, damage: 20 },
    ],
  },
  'tidalon': {
    id: 'tidalon', name: 'タイダロン', category: 'Pokemon', type: 'Water',
    hp: 120, stage: 'Stage1', evolvesFrom: 'aqualet',
    weakness: { type: 'Lightning', mult: 2 }, retreat: 2,
    attacks: [
      { name: 'ハイドロポンプ', cost: { Water: 2 }, damage: 50, text: 'このポケモンについている水エネルギーの数×20ダメージ追加。', effect: { plusPerEnergy: { type: 'Water', damage: 20 } } },
      { name: 'なみのり', cost: { Water: 2, Colorless: 1 }, damage: 70 },
    ],
  },

  // ===== 雷 =====
  'voltik': {
    id: 'voltik', name: 'ボルティック', category: 'Pokemon', type: 'Lightning',
    hp: 60, stage: 'Basic',
    weakness: { type: 'Fighting', mult: 2 }, resistance: { type: 'Psychic', minus: 30 }, retreat: 1,
    attacks: [
      { name: 'でんきショック', cost: { Lightning: 1 }, damage: 10, text: 'コインを投げてオモテなら相手をマヒ状態にする。', effect: { coinFlip: { onHeads: { status: 'paralyzed' } } } },
    ],
  },
  'stormvolt': {
    id: 'stormvolt', name: 'ストームボルト', category: 'Pokemon', type: 'Lightning',
    hp: 110, stage: 'Stage1', evolvesFrom: 'voltik',
    weakness: { type: 'Fighting', mult: 2 }, retreat: 1,
    attacks: [
      { name: 'サンダーボルト', cost: { Lightning: 2, Colorless: 1 }, damage: 100, text: 'このポケモンのエネルギーをすべてトラッシュする。', effect: { discardAllEnergy: true } },
    ],
  },

  // ===== 超 =====
  'mindle': {
    id: 'mindle', name: 'マインドル', category: 'Pokemon', type: 'Psychic',
    hp: 70, stage: 'Basic',
    weakness: { type: 'Psychic', mult: 2 }, retreat: 1,
    attacks: [
      { name: 'ねんりき', cost: { Psychic: 1, Colorless: 1 }, damage: 30 },
      { name: 'さいみんじゅつ', cost: { Psychic: 1 }, damage: 0, text: '相手をねむり状態にする。', effect: { status: 'asleep' } },
    ],
  },

  // ===== 闘 =====
  'rocco': {
    id: 'rocco', name: 'ロッコ', category: 'Pokemon', type: 'Fighting',
    hp: 80, stage: 'Basic',
    weakness: { type: 'Psychic', mult: 2 }, retreat: 2,
    attacks: [
      { name: 'なげとばす', cost: { Fighting: 1 }, damage: 20 },
      { name: 'じしん', cost: { Fighting: 2, Colorless: 1 }, damage: 80, text: '自分のベンチポケモンにも10ダメージ。', effect: { benchDamageSelf: 10 } },
    ],
  },

  // ===== 無 =====
  'fluffit': {
    id: 'fluffit', name: 'フラフィット', category: 'Pokemon', type: 'Colorless',
    hp: 70, stage: 'Basic',
    weakness: { type: 'Fighting', mult: 2 }, retreat: 1,
    attacks: [
      { name: 'たいあたり', cost: { Colorless: 2 }, damage: 30 },
    ],
  },

  // ===== エネルギー（基本） =====
  'energy-grass':     { id: 'energy-grass',     name: '草エネルギー',   category: 'Energy', energyType: 'Grass',     basic: true },
  'energy-fire':      { id: 'energy-fire',      name: '炎エネルギー',   category: 'Energy', energyType: 'Fire',      basic: true },
  'energy-water':     { id: 'energy-water',     name: '水エネルギー',   category: 'Energy', energyType: 'Water',     basic: true },
  'energy-lightning': { id: 'energy-lightning', name: '雷エネルギー',   category: 'Energy', energyType: 'Lightning', basic: true },
  'energy-psychic':   { id: 'energy-psychic',   name: '超エネルギー',   category: 'Energy', energyType: 'Psychic',   basic: true },
  'energy-fighting':  { id: 'energy-fighting',  name: '闘エネルギー',   category: 'Energy', energyType: 'Fighting',  basic: true },
  'energy-darkness':  { id: 'energy-darkness',  name: '悪エネルギー',   category: 'Energy', energyType: 'Darkness',  basic: true },
  'energy-metal':     { id: 'energy-metal',     name: '鋼エネルギー',   category: 'Energy', energyType: 'Metal',     basic: true },
  'energy-fairy':     { id: 'energy-fairy',     name: '妖エネルギー',   category: 'Energy', energyType: 'Fairy',     basic: true },

  // ===== トレーナーズ =====
  'potion': {
    id: 'potion', name: 'キズぐすり', category: 'Trainer', trainerType: 'Item',
    text: '自分のポケモン1匹のHPを30回復する。',
    effect: { kind: 'healTarget', amount: 30 },
  },
  'professor': {
    id: 'professor', name: '博士の研究', category: 'Trainer', trainerType: 'Supporter',
    text: '手札をすべてトラッシュし、7枚引く。',
    effect: { kind: 'discardHandDraw', draw: 7 },
  },
  'poke-ball': {
    id: 'poke-ball', name: 'モンスターボール', category: 'Trainer', trainerType: 'Item',
    text: '山札からたねポケモンを1枚手札に加える。',
    effect: { kind: 'searchBasic' },
  },
  'switch': {
    id: 'switch', name: 'いれかえ', category: 'Trainer', trainerType: 'Item',
    text: 'バトルポケモンをベンチポケモンと入れ替える。',
    effect: { kind: 'switchActive' },
  },
  'energy-search': {
    id: 'energy-search', name: 'エネルギーつけかえ', category: 'Trainer', trainerType: 'Item',
    text: '山札から基本エネルギーを1枚手札に加える。',
    effect: { kind: 'searchEnergy' },
  },
};

// ------------------------------------------------------------
//  デッキ定義（カードidの配列。重複OK）
// ------------------------------------------------------------
function repeat(id, n) { return Array(n).fill(id); }

// 炎デッキ（炎＋無：炎エネルギーですべてのワザを支払える）計60
export const DECK_FIRE = [
  ...repeat('embor', 6),   // たね／進化元
  ...repeat('pyrax', 4),   // 1進化アタッカー
  ...repeat('fluffit', 6), // 無色アタッカー
  ...repeat('energy-fire', 22),
  ...repeat('potion', 4),
  ...repeat('professor', 6),
  ...repeat('poke-ball', 6),
  ...repeat('switch', 3),
  ...repeat('energy-search', 3),
];

// 水雷デッキ（水＋雷：それぞれのエネルギーでワザを支払える）計60
export const DECK_WATER = [
  ...repeat('aqualet', 4),
  ...repeat('tidalon', 3),
  ...repeat('voltik', 4),
  ...repeat('stormvolt', 3),
  ...repeat('fluffit', 2),
  ...repeat('energy-water', 12),
  ...repeat('energy-lightning', 10),
  ...repeat('potion', 4),
  ...repeat('professor', 6),
  ...repeat('poke-ball', 6),
  ...repeat('switch', 3),
  ...repeat('energy-search', 3),
];

// 60枚に正規化（多ければ切り詰め、少なければ基本エネルギーで補充）
export function normalizeDeck(ids, fillEnergy = 'energy-fire') {
  let deck = ids.slice(0, 60);
  while (deck.length < 60) deck.push(fillEnergy);
  return deck;
}

export const DECKS = {
  fire:  { name: '炎デッキ', list: normalizeDeck(DECK_FIRE,  'energy-fire'),  fill: 'energy-fire' },
  water: { name: '水雷デッキ', list: normalizeDeck(DECK_WATER, 'energy-water') , fill: 'energy-water'},
};

// タイプ → 基本エネルギーカードid（竜は基本エネ無し→無色扱いで他エネで支払う）
export const TYPE_ENERGY = {
  Grass: 'energy-grass', Fire: 'energy-fire', Water: 'energy-water',
  Lightning: 'energy-lightning', Psychic: 'energy-psychic', Fighting: 'energy-fighting',
  Darkness: 'energy-darkness', Metal: 'energy-metal', Fairy: 'energy-fairy',
};

// 手持ちのカード番号から60枚デッキを自動構築（実カード＋基本エネ＋安全なトレーナー）
export function buildAutoDeck(numbers, cardLookup) {
  const get = cardLookup || getCard;
  const list = [];
  const energyNeed = {};   // type -> 重み
  for (const num of numbers) {
    let c; try { c = get(num); } catch { continue; }
    if (c.category !== 'Pokemon') continue;
    const copies = c.stage === 'Basic' ? 4 : c.stage === 'Stage1' ? 3 : 2;
    for (let i = 0; i < copies; i++) list.push(num);
    // 必要エネルギーを集計
    for (const atk of (c.attacks || [])) {
      for (const [t, n] of Object.entries(atk.cost || {})) {
        if (t === 'Colorless') continue;
        if (TYPE_ENERGY[t]) energyNeed[t] = (energyNeed[t] || 0) + n;
      }
    }
    if (TYPE_ENERGY[c.type]) energyNeed[c.type] = (energyNeed[c.type] || 0) + 1;
  }
  // トレーナー（オリジナル＝安全）
  const trainers = [...Array(4).fill('professor'), ...Array(4).fill('poke-ball'), ...Array(3).fill('potion'), ...Array(2).fill('switch')];
  list.push(...trainers);

  // 残りを基本エネで埋める（必要タイプの比率で配分）
  const types = Object.keys(energyNeed);
  const fillType = types[0] || 'Grass';
  const remaining = Math.max(0, 60 - list.length);
  if (types.length === 0) {
    for (let i = 0; i < remaining; i++) list.push(TYPE_ENERGY[fillType]);
  } else {
    const total = types.reduce((s, t) => s + energyNeed[t], 0);
    let added = 0;
    types.forEach((t, idx) => {
      const n = idx === types.length - 1 ? remaining - added : Math.round(remaining * energyNeed[t] / total);
      for (let i = 0; i < n; i++) list.push(TYPE_ENERGY[t]);
      added += n;
    });
  }
  return { name: 'マイデッキ', list: normalizeDeck(list, TYPE_ENERGY[fillType]), fill: TYPE_ENERGY[fillType] };
}

// ------------------------------------------------------------
//  実カード（pokemon-card.com 由来）はローカル専用ファイルから登録する。
//  リポジトリには含めない（転載回避）。getCard はまずこの登録を見る。
// ------------------------------------------------------------
const LOCAL_CARDS = {};   // number(string) -> card定義
let LOCAL_DECKS = null;   // { key: {name, list:[number...], fill} }

export function registerLocalCards(byNumber = {}, decks = null) {
  Object.assign(LOCAL_CARDS, byNumber);
  if (decks) LOCAL_DECKS = decks;
}
export function getLocalDecks() { return LOCAL_DECKS; }
export function hasLocalCards() { return Object.keys(LOCAL_CARDS).length > 0; }

export function getCard(id) {
  const c = CARDS[id] || LOCAL_CARDS[id];
  if (!c) throw new Error('unknown card: ' + id);
  return c;
}
