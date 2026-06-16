// ============================================================
//  カードマスタデータ（プレースホルダー / オリジナル）
//  本物のポケモンの名称・画像は使わず、汎用タイプ＋オリジナル名で構成。
//  後から自由に差し替え・追加できるよう、すべて「データ」として定義する。
// ============================================================

// タイプ（汎用エレメント）
export const TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Colorless'];

// タイプ別の色（UI用）
export const TYPE_COLORS = {
  Grass:    '#4caf50',
  Fire:     '#f4511e',
  Water:    '#29b6f6',
  Lightning:'#fdd835',
  Psychic:  '#ab47bc',
  Fighting: '#8d6e63',
  Colorless:'#bdbdbd',
};

// タイプの絵文字（簡易アイコン）
export const TYPE_ICONS = {
  Grass: '🌿', Fire: '🔥', Water: '💧', Lightning: '⚡',
  Psychic: '🔮', Fighting: '👊', Colorless: '⭐',
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

export function getCard(id) {
  const c = CARDS[id];
  if (!c) throw new Error('unknown card: ' + id);
  return c;
}
