<#
  pokemon-card.com の詳細ページから「実カードデータ」を取得して
  ローカル専用ファイル js/data/cards.local.js を生成する。

  - 生成物（カード名・テキスト・画像URL）は公開リポジトリに含めないこと（.gitignore済み）。
  - 使い方:
      powershell -ExecutionPolicy Bypass -File tools\scrape-cards.ps1 -Numbers 50220,50221 -Out js\data\cards.local.js
  - 取得できるのは主にポケモンの戦闘データ（HP/タイプ/ワザの必要エネ・ダメージ/弱点/抵抗/にげる/画像URL）。
    複雑な効果テキストは effectText として保持するだけで、ゲーム上は自動적용されない。
#>
param(
  [int[]]$Numbers = @(50220),
  [string]$Out = "js\data\cards.local.js"
)
$ErrorActionPreference = "Stop"
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
$origin = "https://www.pokemon-card.com"

$iconType = @{ grass='Grass'; fire='Fire'; water='Water'; lightning='Lightning';
  psychic='Psychic'; fighting='Fighting'; darkness='Darkness'; metal='Metal';
  dragon='Dragon'; fairy='Fairy'; none='Colorless' }
$stageMap = @{ 'たね'='Basic'; '1進化'='Stage1'; '2進化'='Stage2' }

function StripTags([string]$s) {
  $s = [regex]::Replace($s, '<[^>]+>', '')
  $s = $s -replace '&nbsp;', ' '
  return $s.Trim()
}
function CostFromIcons([string]$h4inner) {
  $cost = [ordered]@{}
  foreach ($m in [regex]::Matches($h4inner, 'icon-([a-z]+) icon')) {
    $t = $iconType[$m.Groups[1].Value]
    if ($t) { if ($cost.Contains($t)) { $cost[$t]++ } else { $cost[$t] = 1 } }
  }
  return $cost
}

$cards = [ordered]@{}
foreach ($num in $Numbers) {
  $url = "$origin/card-search/details.php/card/$num/"
  Write-Host "fetch $num ..."
  try { $html = (Invoke-WebRequest -Uri $url -UserAgent $ua -TimeoutSec 30).Content }
  catch { Write-Warning "  失敗: $($_.Exception.Message)"; continue }

  $name = ''
  $m = [regex]::Match($html, '<h1 class="Heading1[^"]*">\s*([^<]+?)\s*</h1>'); if ($m.Success) { $name = $m.Groups[1].Value.Trim() }
  $img = ''
  $m = [regex]::Match($html, '<img class="fit"\s+src="([^"]+)"'); if ($m.Success) { $img = $origin + $m.Groups[1].Value }

  $hp = 0
  $m = [regex]::Match($html, '<span class="hp-num">\s*(\d+)\s*</span>'); if ($m.Success) { $hp = [int]$m.Groups[1].Value }

  # ポケモン以外（HP無し）は今回スキップ
  if ($hp -eq 0) { Write-Warning "  $num はポケモンではない/HP未検出のためスキップ ($name)"; continue }

  $stage = 'Basic'
  $m = [regex]::Match($html, '<span class="type">\s*([^<]+?)\s*</span>'); if ($m.Success -and $stageMap.Contains($m.Groups[1].Value.Trim())) { $stage = $stageMap[$m.Groups[1].Value.Trim()] }

  $type = 'Colorless'
  $m = [regex]::Match($html, 'タイプ</span>\s*<span class="icon-([a-z]+) icon">'); if ($m.Success) { $type = $iconType[$m.Groups[1].Value] }

  # 特性
  $ability = $null
  $m = [regex]::Match($html, '(?s)<h2[^>]*>特性</h2>(.*?)(?=<h2|<table)')
  if ($m.Success) {
    $sec = $m.Groups[1].Value
    $am = [regex]::Match($sec, '(?s)<h4>\s*(.*?)\s*</h4>\s*<p>(.*?)</p>')
    if ($am.Success) { $ability = [ordered]@{ name = (StripTags $am.Groups[1].Value); text = (StripTags $am.Groups[2].Value) } }
  }

  # ワザ
  $attacks = @()
  $m = [regex]::Match($html, '(?s)<h2[^>]*>ワザ</h2>(.*?)<table')
  if ($m.Success) {
    $sec = $m.Groups[1].Value
    foreach ($wm in [regex]::Matches($sec, '(?s)<h4>(.*?)</h4>\s*<p>(.*?)</p>')) {
      $inner = $wm.Groups[1].Value
      $cost  = CostFromIcons $inner
      $dmg = 0; $dmgRaw = ''
      $dm = [regex]::Match($inner, 'f_right[^"]*">\s*([0-9]+[+\-×xX]*)\s*<')
      if ($dm.Success) { $dmgRaw = $dm.Groups[1].Value; $dmg = [int]([regex]::Match($dmgRaw, '\d+').Value) }
      # ワザ名：spanとf_rightを除いたテキスト
      $nameOnly = [regex]::Replace($inner, '(?s)<span class="f_right[^"]*">.*?</span>', '')
      $nameOnly = StripTags $nameOnly
      $effText = StripTags $wm.Groups[2].Value
      $atk = [ordered]@{ name = $nameOnly; cost = $cost; damage = $dmg }
      if ($dmgRaw -and $dmgRaw -ne "$dmg") { $atk['damageRaw'] = $dmgRaw }
      if ($effText) { $atk['effectText'] = $effText }
      $attacks += $atk
    }
  }

  # 弱点・抵抗力・にげる
  $weakness = $null; $resistance = $null; $retreat = 0
  $tm = [regex]::Match($html, '(?s)<th>弱点</th>.*?<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td class="escape">(.*?)</td>')
  if ($tm.Success) {
    $wkd = $tm.Groups[1].Value; $rsd = $tm.Groups[2].Value; $esc = $tm.Groups[3].Value
    $wi = [regex]::Match($wkd, 'icon-([a-z]+) icon'); $wx = [regex]::Match($wkd, '×(\d+)')
    if ($wi.Success) { $weakness = [ordered]@{ type = $iconType[$wi.Groups[1].Value]; mult = ([int]($(if($wx.Success){$wx.Groups[1].Value}else{2}))) } }
    $ri = [regex]::Match($rsd, 'icon-([a-z]+) icon'); $rn = [regex]::Match($rsd, '-(\d+)')
    if ($ri.Success) { $resistance = [ordered]@{ type = $iconType[$ri.Groups[1].Value]; minus = ([int]($(if($rn.Success){$rn.Groups[1].Value}else{30}))) } }
    $retreat = ([regex]::Matches($esc, 'icon-none icon')).Count
  }

  $card = [ordered]@{
    id = "$num"; number = "$num"; name = $name; category = 'Pokemon';
    type = $type; hp = $hp; stage = $stage; retreat = $retreat;
    attacks = $attacks; imageUrl = $img;
  }
  if ($ability)    { $card['ability'] = $ability }
  if ($weakness)   { $card['weakness'] = $weakness }
  if ($resistance) { $card['resistance'] = $resistance }
  $cards["$num"] = $card
  Write-Host "  OK: $name ($type, HP$hp, $stage, ワザ$($attacks.Count))"
}

# JS出力
$json = $cards | ConvertTo-Json -Depth 12
$js = @"
// 自動生成（tools/scrape-cards.ps1）— ローカル専用・公開リポジトリに含めない
// pokemon-card.com 由来の実カードデータ。転載回避のため .gitignore 済み。
// デッキ(window.__LOCAL_DECKS)を別ファイル js/data/decks.local.js で定義してもよい。
// 未定義なら main.js が手持ちカードから自動でデッキを組む。
window.__LOCAL_CARDS = { byNumber: $json };
"@
$dir = Split-Path $Out -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
[System.IO.File]::WriteAllText($Out, $js, (New-Object System.Text.UTF8Encoding $false))
Write-Host "wrote $Out ($($cards.Count) cards)"
