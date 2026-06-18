<#
  pokemon-card.com のデッキコードからデッキを取り込む（最大2デッキ＝自分用/相手用）。
  - デッキページの隠しinput(deck_pke等)から「番号_枚数」を、PCGDECK配列から名前・画像URLを取得。
  - ポケモンは詳細ページから戦闘データ(HP/タイプ/ワザ/弱点/抵抗/にげる/進化元)を取得。
  - トレーナー/エネルギーは名前・画像・分類のみ（複雑な効果は名前ベースで一部実装）。
  - 生成物 cards.local.js / decks.local.js はローカル専用（.gitignore）。公開リポには含めない。

  使い方:
    # 自分用デッキのみ
    powershell -ExecutionPolicy Bypass -File tools\import-deck.ps1 -DeckCode ppRySR-eJ2k2F-p3ypXS
    # 自分用＋相手(AI)用
    powershell -ExecutionPolicy Bypass -File tools\import-deck.ps1 -DeckCode <自分> -DeckCode2 <相手>
#>
param(
  [Parameter(Mandatory=$true)][string]$DeckCode,
  [string]$DeckCode2 = "",
  [string]$DeckName  = "取り込みデッキ",
  [string]$DeckName2 = "相手デッキ",
  [string]$OutCards  = "js\data\cards.local.js",
  [string]$OutDecks  = "js\data\decks.local.js"
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
$sectionCat = [ordered]@{ deck_pke='Pokemon'; deck_gds='Item'; deck_tool='Tool';
  deck_tech='Item'; deck_sup='Supporter'; deck_sta='Stadium'; deck_ene='Energy'; deck_ajs='Item' }

function StripTags([string]$s) { ($s -replace '<[^>]+>','') -replace '&nbsp;',' ' }
function Clean([string]$s) { (StripTags $s).Trim() }
function InferType([string]$name) { foreach ($k in $typeWord.Keys) { if ($name -like "*$k*") { return $typeWord[$k] } } return 'Colorless' }

# 1デッキ分を取り込み、@{ byNumber; list; fill } を返す（evolvesFromはデッキ内で解決済み）
function Import-OneDeck([string]$code) {
  $deckUrl = "$origin/deck/confirm.html/deckID/$code/"
  Write-Host "fetch deck $code ..."
  $html = (Invoke-WebRequest -Uri $deckUrl -UserAgent $ua -TimeoutSec 30).Content

  $pict = @{}; $nameAlt = @{}; $nameFull = @{}
  foreach ($m in [regex]::Matches($html, "PCGDECK\.searchItemCardPict\[(\d+)\]='([^']+)'")) { $pict[$m.Groups[1].Value] = $origin + $m.Groups[2].Value }
  foreach ($m in [regex]::Matches($html, "PCGDECK\.searchItemNameAlt\[(\d+)\]='([^']*)'")) { $nameAlt[$m.Groups[1].Value] = $m.Groups[2].Value }
  foreach ($m in [regex]::Matches($html, "PCGDECK\.searchItemName\[(\d+)\]='([^']*)'")) { $nameFull[$m.Groups[1].Value] = $m.Groups[2].Value }
  $cardName = {
    param($num)
    if ($nameAlt[$num]) { return $nameAlt[$num] }
    $n = $nameFull[$num]; if ($n) { return ($n -replace '\s*\([^)]*\)\s*$','') }
    return "card$num"
  }

  $entries = @()
  foreach ($sec in $sectionCat.Keys) {
    $sm = [regex]::Match($html, "name=`"$sec`"[^>]*value=`"([^`"]*)`"")
    if (-not $sm.Success -or -not $sm.Groups[1].Value) { continue }
    foreach ($part in $sm.Groups[1].Value.Split('-')) {
      $f = $part.Split('_')
      if ($f.Count -ge 2) { $entries += @{ num=$f[0]; count=[int]$f[1]; cat=$sectionCat[$sec] } }
    }
  }
  Write-Host "  cards: $($entries.Count) 種 / $(@($entries | ForEach-Object { $_.count }) | Measure-Object -Sum | Select-Object -ExpandProperty Sum) 枚"

  $byNumber = [ordered]@{}
  $evoNameOf = @{}
  foreach ($e in $entries) {
    $num = $e.num
    if ($byNumber.Contains($num)) { continue }
    $img = $pict[$num]; $name = & $cardName $num

    if ($e.cat -eq 'Pokemon') {
      Write-Host "  pokemon $num $name ..."
      try { $ph = (Invoke-WebRequest -Uri "$origin/card-search/details.php/card/$num/" -UserAgent $ua -TimeoutSec 30).Content }
      catch { Write-Warning "    詳細取得失敗: $($_.Exception.Message)"; continue }

      $hp = 0; $mm = [regex]::Match($ph, '<span class="hp-num">\s*(\d+)\s*</span>'); if ($mm.Success) { $hp = [int]$mm.Groups[1].Value }
      $stage = 'Basic'; $mm = [regex]::Match($ph, '<span class="type">\s*([^<]+?)\s*</span>')
      if ($mm.Success) { $st = (Clean $mm.Groups[1].Value) -replace '\s',''; if ($stageMap.Contains($st)) { $stage = $stageMap[$st] } }
      $type = 'Colorless'; $mm = [regex]::Match($ph, 'タイプ</span>\s*<span class="icon-([a-z]+) icon">'); if ($mm.Success) { $type = $iconType[$mm.Groups[1].Value] }

      $ability = $null
      $mm = [regex]::Match($ph, '(?s)<h2[^>]*>特性</h2>(.*?)(?=<h2|<table)')
      if ($mm.Success) { $am = [regex]::Match($mm.Groups[1].Value, '(?s)<h4>\s*(.*?)\s*</h4>\s*<p>(.*?)</p>'); if ($am.Success) { $ability = [ordered]@{ name=(Clean $am.Groups[1].Value); text=(Clean $am.Groups[2].Value) } } }

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

      $weak=$null; $resist=$null; $retreat=0
      $tm = [regex]::Match($ph, '(?s)<th>弱点</th>.*?<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td class="escape">(.*?)</td>')
      if ($tm.Success) {
        $wi=[regex]::Match($tm.Groups[1].Value,'icon-([a-z]+) icon'); $wx=[regex]::Match($tm.Groups[1].Value,'×(\d+)')
        if ($wi.Success) { $weak=[ordered]@{ type=$iconType[$wi.Groups[1].Value]; mult=([int]$(if($wx.Success){$wx.Groups[1].Value}else{2})) } }
        $ri=[regex]::Match($tm.Groups[2].Value,'icon-([a-z]+) icon'); $rn=[regex]::Match($tm.Groups[2].Value,'[-－](\d+)')
        if ($ri.Success) { $resist=[ordered]@{ type=$iconType[$ri.Groups[1].Value]; minus=([int]$(if($rn.Success){$rn.Groups[1].Value}else{30})) } }
        $retreat = ([regex]::Matches($tm.Groups[3].Value,'icon-none icon')).Count
      }

      $onM = [regex]::Match($ph, 'class="evolution ev_on"')
      if ($onM.Success) { $after = $ph.Substring($onM.Index); $evm = [regex]::Match($after, '<div class="evolution ev_off"><a[^>]*>([^<]+)</a>') }
      else { $evm = [regex]::Match($ph, '<div class="evolution ev_off"><a[^>]*>([^<]+)</a>') }
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
      $card = [ordered]@{ id="$num"; number="$num"; name=$name; category='Trainer'; trainerType=$e.cat; imageUrl=$img; effect=@{ kind='unimplemented' } }
      $byNumber[$num] = $card
    }
  }

  # 進化元の名前→番号（このデッキ内で解決）
  $numByName = @{}
  foreach ($k in $byNumber.Keys) { $numByName[$byNumber[$k].name] = $k }
  foreach ($num in $evoNameOf.Keys) {
    $bn = $evoNameOf[$num]
    if ($numByName.ContainsKey($bn)) { $byNumber[$num]['evolvesFrom'] = $numByName[$bn] }
    else { $byNumber[$num]['evolvesFromName'] = $bn }
  }

  # デッキ展開（番号×枚数）と fill
  $deckList = @()
  foreach ($e in $entries) { for ($i=0; $i -lt $e.count; $i++) { $deckList += "$($e.num)" } }
  $fill = $null
  foreach ($e in $entries) { if ($e.cat -eq 'Energy' -and $byNumber["$($e.num)"].basic) { $fill = "$($e.num)"; break } }
  if (-not $fill) { foreach ($e in $entries) { if ($e.cat -eq 'Energy') { $fill = "$($e.num)"; break } } }
  if (-not $fill) { $fill = 'energy-psychic' }

  return @{ byNumber=$byNumber; list=$deckList; fill=$fill }
}

# ---- 取り込み（自分／相手）----
$merged = [ordered]@{}
$decks  = [ordered]@{}

$d1 = Import-OneDeck $DeckCode
foreach ($k in $d1.byNumber.Keys) { $merged[$k] = $d1.byNumber[$k] }
$decks['imported'] = [ordered]@{ name=$DeckName; list=$d1.list; fill=$d1.fill }

if ($DeckCode2) {
  $d2 = Import-OneDeck $DeckCode2
  foreach ($k in $d2.byNumber.Keys) { if (-not $merged.Contains($k)) { $merged[$k] = $d2.byNumber[$k] } }
  $decks['imported2'] = [ordered]@{ name=$DeckName2; list=$d2.list; fill=$d2.fill }
}

# ---- 出力 ----
$srcLabel = if ($DeckCode2) { "$DeckCode + $DeckCode2" } else { $DeckCode }
$cardsJs = @"
// 自動生成（tools/import-deck.ps1, deck=$srcLabel）— ローカル専用・公開リポジトリに含めない
window.__LOCAL_CARDS = { byNumber: $($merged | ConvertTo-Json -Depth 12) };
"@
$decksJs = @"
// 自動生成（tools/import-deck.ps1, deck=$srcLabel）— ローカル専用・公開リポジトリに含めない
window.__LOCAL_DECKS = $($decks | ConvertTo-Json -Depth 6);
"@
[System.IO.File]::WriteAllText($OutCards, $cardsJs, (New-Object System.Text.UTF8Encoding $false))
[System.IO.File]::WriteAllText($OutDecks, $decksJs, (New-Object System.Text.UTF8Encoding $false))
Write-Host "wrote $OutCards ($($merged.Count) cards) / $OutDecks ($($decks.Count) decks)"
