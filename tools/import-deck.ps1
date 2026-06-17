<#
  pokemon-card.com のデッキコードからデッキを取り込む。
  - デッキページの隠しinput(deck_pke等)から「番号_枚数」を、PCGDECK配列から名前・画像URLを取得。
  - ポケモンは詳細ページから戦闘データ(HP/タイプ/ワザ/弱点/抵抗/にげる/進化元)を取得。
  - トレーナー/エネルギーは名前・画像・分類のみ（複雑な効果は未実装＝ゲーム上はダメージ等の基本のみ）。
  - 生成物 cards.local.js / decks.local.js はローカル専用（.gitignore）。公開リポには含めない。

  使い方:
    powershell -ExecutionPolicy Bypass -File tools\import-deck.ps1 -DeckCode ppRySR-eJ2k2F-p3ypXS
#>
param(
  [Parameter(Mandatory=$true)][string]$DeckCode,
  [string]$OutCards = "js\data\cards.local.js",
  [string]$OutDecks = "js\data\decks.local.js",
  [string]$DeckName = "取り込みデッキ",
  [string]$DeckKey  = "imported"
)
$ErrorActionPreference = "Stop"
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
$origin = "https://www.pokemon-card.com"

$iconType = @{ grass='Grass'; fire='Fire'; water='Water'; lightning='Lightning';
  psychic='Psychic'; fighting='Fighting'; darkness='Darkness'; dark='Darkness'; metal='Metal';
  dragon='Dragon'; fairy='Fairy'; none='Colorless' }
$stageMap = @{ 'たね'='Basic'; '1進化'='Stage1'; '2進化'='Stage2' }
$typeWord = [ordered]@{ '草'='Grass'; '炎'='Fire'; '水'='Water'; '雷'='Lightning';
  '超'='Psychic'; '闘'='Fighting'; '悪'='Darkness'; '鋼'='Metal'; '妖'='Fairy'; 'ドラゴン'='Dragon' }
# セクション → カテゴリ
$sectionCat = [ordered]@{ deck_pke='Pokemon'; deck_gds='Item'; deck_tool='Tool';
  deck_tech='Item'; deck_sup='Supporter'; deck_sta='Stadium'; deck_ene='Energy'; deck_ajs='Item' }

function StripTags([string]$s) { ($s -replace '<[^>]+>','') -replace '&nbsp;',' ' }
function Clean([string]$s) { (StripTags $s).Trim() }
function InferType([string]$name) { foreach ($k in $typeWord.Keys) { if ($name -like "*$k*") { return $typeWord[$k] } } return 'Colorless' }

# ---- 1) デッキページ取得 ----
$deckUrl = "$origin/deck/confirm.html/deckID/$DeckCode/"
Write-Host "fetch deck $DeckCode ..."
$html = (Invoke-WebRequest -Uri $deckUrl -UserAgent $ua -TimeoutSec 30).Content

# ---- 2) 名前・画像URL（PCGDECK） ----
$pict = @{}; $nameAlt = @{}; $nameFull = @{}
foreach ($m in [regex]::Matches($html, "PCGDECK\.searchItemCardPict\[(\d+)\]='([^']+)'")) { $pict[$m.Groups[1].Value] = $origin + $m.Groups[2].Value }
foreach ($m in [regex]::Matches($html, "PCGDECK\.searchItemNameAlt\[(\d+)\]='([^']*)'")) { $nameAlt[$m.Groups[1].Value] = $m.Groups[2].Value }
foreach ($m in [regex]::Matches($html, "PCGDECK\.searchItemName\[(\d+)\]='([^']*)'")) { $nameFull[$m.Groups[1].Value] = $m.Groups[2].Value }
function CardName([string]$num) {
  if ($nameAlt[$num]) { return $nameAlt[$num] }
  $n = $nameFull[$num]; if ($n) { return ($n -replace '\s*\([^)]*\)\s*$','') }
  return "card$num"
}

# ---- 3) セクションから 番号_枚数 を抽出 ----
$entries = @()  # @{num,count,cat}
foreach ($sec in $sectionCat.Keys) {
  $sm = [regex]::Match($html, "name=`"$sec`"[^>]*value=`"([^`"]*)`"")
  if (-not $sm.Success) { continue }
  $val = $sm.Groups[1].Value
  if (-not $val) { continue }
  foreach ($part in $val.Split('-')) {
    $f = $part.Split('_')
    if ($f.Count -ge 2) { $entries += @{ num=$f[0]; count=[int]$f[1]; cat=$sectionCat[$sec] } }
  }
}
Write-Host "  cards: $($entries.Count) 種 / $(@($entries | ForEach-Object { $_.count }) | Measure-Object -Sum | Select-Object -ExpandProperty Sum) 枚"

# ---- 4) カードごとに定義を作成 ----
$byNumber = [ordered]@{}
$evoNameOf = @{}   # num -> 進化元の名前（後で番号に解決）

foreach ($e in $entries) {
  $num = $e.num
  if ($byNumber.Contains($num)) { continue }
  $img = $pict[$num]; $name = CardName $num

  if ($e.cat -eq 'Pokemon') {
    Write-Host "  pokemon $num $name ..."
    try { $ph = (Invoke-WebRequest -Uri "$origin/card-search/details.php/card/$num/" -UserAgent $ua -TimeoutSec 30).Content }
    catch { Write-Warning "    詳細取得失敗: $($_.Exception.Message)"; continue }

    $hp = 0; $mm = [regex]::Match($ph, '<span class="hp-num">\s*(\d+)\s*</span>'); if ($mm.Success) { $hp = [int]$mm.Groups[1].Value }
    $stage = 'Basic'; $mm = [regex]::Match($ph, '<span class="type">\s*([^<]+?)\s*</span>')
    if ($mm.Success) { $st = (Clean $mm.Groups[1].Value) -replace '\s',''; if ($stageMap.Contains($st)) { $stage = $stageMap[$st] } }
    $type = 'Colorless'; $mm = [regex]::Match($ph, 'タイプ</span>\s*<span class="icon-([a-z]+) icon">'); if ($mm.Success) { $type = $iconType[$mm.Groups[1].Value] }

    # 特性
    $ability = $null
    $mm = [regex]::Match($ph, '(?s)<h2[^>]*>特性</h2>(.*?)(?=<h2|<table)')
    if ($mm.Success) { $am = [regex]::Match($mm.Groups[1].Value, '(?s)<h4>\s*(.*?)\s*</h4>\s*<p>(.*?)</p>'); if ($am.Success) { $ability = [ordered]@{ name=(Clean $am.Groups[1].Value); text=(Clean $am.Groups[2].Value) } } }

    # ワザ
    $attacks = @()
    $mm = [regex]::Match($ph, '(?s)<h2[^>]*>ワザ</h2>(.*?)<table')
    if ($mm.Success) {
      foreach ($wm in [regex]::Matches($mm.Groups[1].Value, '(?s)<h4>(.*?)</h4>\s*<p>(.*?)</p>')) {
        $inner = $wm.Groups[1].Value
        $cost = [ordered]@{}
        foreach ($im in [regex]::Matches($inner, 'icon-([a-z]+) icon')) { $t = $iconType[$im.Groups[1].Value]; if ($t) { if ($cost.Contains($t)) { $cost[$t]++ } else { $cost[$t]=1 } } }
        $dmg = 0; $dm = [regex]::Match($inner, 'f_right[^"]*">\s*([0-9]+)[+\-×xX]*\s*<'); if ($dm.Success) { $dmg = [int]$dm.Groups[1].Value }
        $nameOnly = Clean ([regex]::Replace($inner, '(?s)<span class="f_right[^"]*">.*?</span>', ''))
        $eff = Clean $wm.Groups[2].Value
        $atk = [ordered]@{ name=$nameOnly; cost=$cost; damage=$dmg }
        if ($eff) { $atk['effectText'] = $eff }
        $attacks += $atk
      }
    }

    # 弱点・抵抗・にげる
    $weak=$null; $resist=$null; $retreat=0
    $tm = [regex]::Match($ph, '(?s)<th>弱点</th>.*?<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td class="escape">(.*?)</td>')
    if ($tm.Success) {
      $wi=[regex]::Match($tm.Groups[1].Value,'icon-([a-z]+) icon'); $wx=[regex]::Match($tm.Groups[1].Value,'×(\d+)')
      if ($wi.Success) { $weak=[ordered]@{ type=$iconType[$wi.Groups[1].Value]; mult=([int]$(if($wx.Success){$wx.Groups[1].Value}else{2})) } }
      $ri=[regex]::Match($tm.Groups[2].Value,'icon-([a-z]+) icon'); $rn=[regex]::Match($tm.Groups[2].Value,'[-－](\d+)')
      if ($ri.Success) { $resist=[ordered]@{ type=$iconType[$ri.Groups[1].Value]; minus=([int]$(if($rn.Success){$rn.Groups[1].Value}else{30})) } }
      $retreat = ([regex]::Matches($tm.Groups[3].Value,'icon-none icon')).Count
    }

    # 進化元（ev_on の直後の evolution ev_off の名前）
    $evm = [regex]::Match($ph, '(?s)class="evolution ev_on">.*?<div class="evolution ev_off"><a[^>]*>([^<]+)</a>')
    if ($evm.Success) { $evoNameOf[$num] = (Clean $evm.Groups[1].Value) }

    $card = [ordered]@{ id="$num"; number="$num"; name=$name; category='Pokemon'; type=$type; hp=$hp; stage=$stage; retreat=$retreat; attacks=$attacks; imageUrl=$img }
    if ($ability) { $card['ability']=$ability }
    if ($weak)    { $card['weakness']=$weak }
    if ($resist)  { $card['resistance']=$resist }
    $byNumber[$num] = $card
  }
  elseif ($e.cat -eq 'Energy') {
    $basic = ($name -like '基本*')
    $card = [ordered]@{ id="$num"; number="$num"; name=$name; category='Energy'; energyType=(InferType $name); basic=$basic; imageUrl=$img }
    if (-not $basic) { $card['special']=$true }
    $byNumber[$num] = $card
  }
  else {
    # トレーナー（Item/Supporter/Stadium/Tool）：効果は未実装
    $card = [ordered]@{ id="$num"; number="$num"; name=$name; category='Trainer'; trainerType=$e.cat; imageUrl=$img; effect=@{ kind='unimplemented' } }
    $byNumber[$num] = $card
  }
}

# ---- 5) 進化元の名前を番号に解決 ----
$numByName = @{}
foreach ($k in $byNumber.Keys) { $numByName[$byNumber[$k].name] = $k }
foreach ($num in $evoNameOf.Keys) {
  $bn = $evoNameOf[$num]
  if ($numByName.ContainsKey($bn)) { $byNumber[$num]['evolvesFrom'] = $numByName[$bn] }
  else { $byNumber[$num]['evolvesFromName'] = $bn }  # デッキ外なら名前だけ残す
}

# ---- 6) デッキ展開（番号×枚数） ----
$deckList = @()
foreach ($e in $entries) { for ($i=0; $i -lt $e.count; $i++) { $deckList += "$($e.num)" } }
# fill: 基本エネがあればその番号、無ければ最初のエネ、無ければ超
$fill = $null
foreach ($e in $entries) { if ($e.cat -eq 'Energy' -and $byNumber["$($e.num)"].basic) { $fill = "$($e.num)"; break } }
if (-not $fill) { foreach ($e in $entries) { if ($e.cat -eq 'Energy') { $fill = "$($e.num)"; break } } }
if (-not $fill) { $fill = 'energy-psychic' }

# ---- 出力 ----
$cardsJson = $byNumber | ConvertTo-Json -Depth 12
$cardsJs = @"
// 自動生成（tools/import-deck.ps1, deck=$DeckCode）— ローカル専用・公開リポジトリに含めない
window.__LOCAL_CARDS = { byNumber: $cardsJson };
"@
$deckObj = [ordered]@{ $DeckKey = [ordered]@{ name=$DeckName; list=$deckList; fill=$fill } }
$decksJson = $deckObj | ConvertTo-Json -Depth 6
$decksJs = @"
// 自動生成（tools/import-deck.ps1, deck=$DeckCode）— ローカル専用・公開リポジトリに含めない
window.__LOCAL_DECKS = $decksJson;
"@

[System.IO.File]::WriteAllText($OutCards, $cardsJs, (New-Object System.Text.UTF8Encoding $false))
[System.IO.File]::WriteAllText($OutDecks, $decksJs, (New-Object System.Text.UTF8Encoding $false))
Write-Host "wrote $OutCards ($($byNumber.Count) cards) / $OutDecks ($($deckList.Count) 枚)"
