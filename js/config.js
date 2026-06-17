// ============================================================
//  設定（公開リポジトリに含めてよい安全な値のみ）
// ============================================================

// 画像＆実カードデータのアンロック用パスワードの SHA-256 ハッシュ。
// 実際のパスワードは公開しない。ローカルの key.local.js に平文を置き、
// 起動時にこのハッシュと一致したときだけ実カード/画像を読み込む。
//
// ハッシュの作り方（PowerShell）:
//   $pw="あなたのパスワード"; $s=[Security.Cryptography.SHA256]::Create();
//   (($s.ComputeHash([Text.Encoding]::UTF8.GetBytes($pw))|%{$_.ToString("x2")}) -join "")
//
// 既定パスワード: "tropius-local-2026"（必ず自分のものに変更してください）
export const IMAGE_UNLOCK_HASH = '47ac85981ee22852441fc41188d6d44fa20fc3f5781c375e6620fe5fd86640de';

// 公式カード画像のベースURL（番号→画像URLは実カードデータ側に保持）
export const CARD_IMAGE_ORIGIN = 'https://www.pokemon-card.com';
