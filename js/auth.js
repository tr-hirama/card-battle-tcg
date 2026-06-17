// ============================================================
//  ローカル・アンロック判定（起動時に一度だけ確認）
//  - ローカル専用ファイル key.local.js が window.__CARD_KEY に平文パスワードを設定する。
//  - その SHA-256 が config の IMAGE_UNLOCK_HASH と一致すれば「アンロック」。
//  - 公開サイトには key.local.js が存在しない → 常にロック（=実カード/画像を出さない）。
// ============================================================

import { IMAGE_UNLOCK_HASH } from './config.js';

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// 起動時に1回呼ぶ。一致すれば true。
export async function checkUnlocked() {
  try {
    const key = (typeof window !== 'undefined' && window.__CARD_KEY) || '';
    if (!key) return false;
    if (!('crypto' in window) || !crypto.subtle) return false; // http(非https)等
    const hex = await sha256Hex(String(key));
    return hex === IMAGE_UNLOCK_HASH;
  } catch {
    return false;
  }
}
