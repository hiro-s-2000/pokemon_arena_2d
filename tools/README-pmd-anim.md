# pokeSprite → pokeAnim を「ポケモン不思議のダンジョン 赤の救助隊（GBA）」の画風・動きで作る

`tools/build-pmd-anim.js` のノウハウ。ROM（`あまり触らない。/rom_analytics/rom/Pocket Monsters - Fushigi no Dungeon Aka no Kyuujotai (Japan).gba`）を解析して分かったこと、
その画風を pokeSprite の GIF から作り直す手順、ゲームで確認する手順をまとめる。

```sh
node tools/build-pmd-anim.js --id 0006_charizard                       # 確認用に出力（確認用画像/pmd-anim/<id>/）
node tools/build-pmd-anim.js --id 0006_charizard-mega-x --ax 6         # フォームは基本種の ax 番号を指定
node tools/build-pmd-anim.js --id 0003_venusaur-mega --ax 3 --install  # pokeAnim/<src>/ に書き、manifest を更新
```

## 1. ROM の中身（解析結果）

| 項目 | 内容 |
|---|---|
| アーカイブ | `0x514000` に `pksdir0`。`0x514018` から 497 件の `{名前ptr, データptr}`（8 バイト）。ポケモンのアニメは `axNNN`（NNN = 図鑑番号 1〜386、以降はフォーム・特殊）。 |
| コンテナ | 各 `axNNN` は `SIRO` + 本体ポインタ。本体 = `{poseTbl, animTbl, animCount, spriteTbl, positions}` の 5 ポインタ。 |
| ポーズ | `poseTbl[i]` → 最大 8 個の OAM パーツ（10 バイト: sprite id s16, 予備, attr0, attr1, attr2）。GBA の OBJ そのもの（8×8〜64×64、4bpp 32 バイト/タイル、hflip/vflip ビット、x/y は s8）。1 ポーズ = 1 枚の絵。リザードンは 244 ポーズ。 |
| アニメ | `animTbl[slot]` → 8 方向ポインタ（**S, SE, E, NE, N, NW, W, SW** の順。`game/js/sprites.js` の `dirRow` と同じ）→ ステップ列。 |
| ステップ | 12 バイト: `ticks u8`（1/60 秒。0 で終端）, `flags u8`, `pose s16`, `dx s16`, `dy s16`, `shadow dx s16`, `shadow dy s16`。**y は負が上**。 |
| flags | `2` = 技が当たるコマ（ヒット）、`1` = 戻り始め（ヒット区間の終わり）、`3` = 特殊（回転技の頂点）。 |
| スロット | 0 Walk, 1 Attack（突進）, 2 Strike（切り裂き・大技）, 3 Shoot（口から出す）, 4 SpAttack, 5 Sleep（ゲームでは Faint に流用）, 6 Hurt, 7 Idle, 8 回転, 9 横揺れ, 10 ジャンプ, 11 Charge（溜め）, 12〜16 その他。種族により 13〜28 スロット。 |
| 種族パラメータ | `0x0355140` から 72 バイト/種。+8 がパレット番号。パレット本体は `0x16C142C`。 |

### 画風・画質（ROM の実測）

- **体高**: 待機ポーズの不透明な高さは **16〜37 px、中央値 24 px**（フシギダネ 21、リザードン 26、ピカチュウ 25、ギャラドス 37、ラプラス 34、ミュウ 30）。
- **色数**: 4bpp なので **15 色 + 透明**。実際の絵は 9〜15 色。輪郭は **1 px の真っ黒**。
- **向き**: 8 方向を個別に描いている（横向きは OAM の hflip で左右反転も使う）。
- **動きのタイミング**（ticks = 1/60 秒）
  - Idle: 4 コマが基本（15,15,15,15）。まばたき型は `40,2,3,3,3,2` のように長い静止 + 短いコマ。
  - Walk: 4 コマ `8,10,8,10`（遅い種は `12,8,12,8`、速い種は `4,4,4,4`）。足のポーズは絵で表現し、オフセットは 0。
  - Attack: 10〜14 ステップ、ほぼ 2 ticks 刻み。予備動作で `dy = -1〜-6`（しゃがみ・浮き）→ `flags 2` の直前で最大 **19〜28 px** 前進 → 2 ticks ずつ戻る。
  - Shoot / SpAttack: `4,6` の溜めの後、2 ticks 刻みで 5 px 前後の前進を保つ。
  - Hurt: `2,8` で `dy -2, -3`（のけぞり）。Sleep: 2 ポーズを `30,35` で往復。
- **方向ごとの差**: 8 方向とも同じステップ数・同じ ticks。オフセットは各方向の向きに合わせて回転した値が入っている。

## 2. 今のゲームの pokeAnim との関係

- pokeAnim のシートは **PMD の 1x ドット絵を 2 倍（2×2 画素のブロック）** にしたもの。SpriteCollab 由来の絵（1,072 体）も GIF から作った絵（144 体）も同じ密度。
- したがって ROM の体高（1x）を **そのまま 1x の目標体高** にし、最後に 2 倍すれば周りの絵と同じ画素の大きさになる（リザードン: ROM 26 → 52 px。SpriteCollab の絵は 58 px でほぼ同じ）。
- ROM のオフセット（px）も 2 倍してシートに置く。ticks は manifest の `durations` にそのまま入る（ゲームは `d / 60` 秒で再生する）。

## 3. 作り方（`tools/build-pmd-anim.js`）

1. **絵の元**: pokeSprite の `front.gif` の全コマと `back.gif`。横向きは front の左右反転、`back-reverse` は back の反転（`ROW_GIF`: S/W/SW = front、SE/E = front 反転、NE = back、N/NW = back 反転。`build-gif-anim.js` と同じ、コンタクトシートで確認済み）。
2. **ドット絵化**: `tools/pixelize.js` の `pixelizeGifs()`。倍率 = `(ROM 体高 − 2) / front 0 コマ目の体高`。パレットは 12 色（`--colors` で最大 15）を全コマ共通で k-means（OKLab）、基本種に SpriteCollab の絵があればその色に寄せる（`paletteFrom`）。黒 1 px 輪郭、小さなノイズ除去、暗い体の持ち上げなどは pixelize.js の既定値。
3. **ポーズ**: ROM のポーズ id は固有の絵なので再現できない。代わりに GIF のコマから **rest / crouch / mid / reach** をバウンディングボックスで選び（`build-gif-anim.js` の `analyse()` と同じ基準: 一番低い = crouch、一番高く広い = reach）、ステップの役割で割り当てる。
   - Idle: ポーズ id が変わるコマは rest を 1 行つぶした「呼吸」。Walk: 1 行つぶした「踏み」。
   - 攻撃系: ヒット（flags 2）より前で `dy < 0` かつ小さい移動 = crouch、移動量が最大の 60% 以上 = reach、移動中 = mid。
   - Hurt = crouch、Faint = crouch → 2 行つぶし。
4. **シート**: 全 GIF の和の矩形を中央・足そろえで共通キャンバスにし、2 倍にして `fw/fh = キャンバス×2 + (最大オフセット+1)×2 の余白`。`anchorY` は余白 + キャンバス高×2（足の線。ゲームは Idle の `anchorY − fh/2` だけを使う）。ヒットのコマは `flags 2`（無ければ 1）。
5. **manifest**: `{ src, exact: true, source: "pmd-rom", romAx, romBodyH, shadowSize, bodyH, bodyW, pixel, anims }`。`anims[*].file` は `../pokeAnim/<src>/<Anim>.png?v=<版>`（今の gen フォルダ配置）。`--install` で `pokeAnim/manifest.json` と `manifest.js` を書き直す。

## 4. 確認の仕方

- `確認用画像/pmd-anim/<id>/contact.png`: 1 段目が 8 方向の待機、以下 各アニメの S 行（ticks 付き）。右上に ROM から抜いた本物のスプライト（`rom_analytics/fushigi_dan_image/sprites/axNNN_*.png` の 1 コマ目）を並べるので画風を見比べられる。
- `rom-anims.json`: その種族の ROM の全スロット（ゲームが使わないものも含む）。`manifest-fragment.json`: manifest に入る内容。
- ゲームで見る: `--install` してから `ゲーム起動.command`、または `index.html?autostart=<slug>,<slug>&arena=meadow` で対戦を開始する。

## 5. 注意

- `tools/build-anim.js` は pokeAnim を全部作り直す（SpriteCollab のクローン `.cache/SpriteCollab` が無いこの環境では走らせない）。`build-gif-anim.js` / `build-hand-anim.js` は旧配置（`pokeAnim/<id>/`）に書くので、今の gen フォルダ配置とは合わない。`build-pmd-anim.js` は 1 体ずつ gen フォルダ配置に書く。
- 第 4 世代以降・メガ・キョダイマックス・リージョンは ROM に無い。`--ax` で基本種（メガリザードン → `--ax 6`）か、第 4 世代以降なら体型の近い第 1〜3 世代の種（二足の獣型・四足・鳥・蛇など）を指定する。動きの文法は体型で決まっているので、見た目が近い種を選ぶ。
- `--height N` で 1x の体高を上書きできる（周りの SpriteCollab の絵と大きさを合わせたいとき）。
- ROM の読み方は `tools/build-sprite-anim.py`（Python 版、絵をドット絵化せずそのまま貼る旧ツール）と同じ。`build-pmd-anim.js` はそれを Node に移植し、ドット絵化と gen フォルダ配置・manifest 更新を足したもの。

## 6. 品質の高い作り方（基本種の PMD 絵を使う）: `tools/build-mega-parts.js`

`build-pmd-anim.js`（pokeSprite の GIF からドット絵化）は「絵の元が正面・背面の 2 枚しかない」ため、SpriteCollab の本物（8 方向を別々に描き、技ごとに違うポーズ）の質には届かない。
**メガ・キョダイ・リージョンのように基本種に本物の PMD 絵がある形態は、基本種のシートを塗り替えてパーツを足す**方が圧倒的に良い（メガリザードンX は SpriteCollab に本物があったが、メガフシギバナ・メガカメックス・メガミュウツーX は無い）。

```sh
# .cache/SpriteCollab/sprite/<dex>/ に基本種のフォルダが必要（GitHub PMDCollab/SpriteCollab の sprite/<dex>/ を丸ごと: AnimData.xml と *-Anim/-Offsets/-Shadow.png）
node tools/build-mega-parts.js --id 0009_blastoise-mega --base 0009_blastoise --sc 0009            # 確認用画像/pmd_claude/<id>/review.png
node tools/build-mega-parts.js --id 0009_blastoise-mega --base 0009_blastoise --sc 0009 --install  # pokeAnim + manifest
```

- **倍率**: pokeAnim の基本種シートは SpriteCollab の 1x 絵の整数倍（種族により 2 倍または 3 倍。フシギバナ・ミュウツーは 3 倍、カメックス・リザードンは 2 倍）。ツールは manifest の基本種 Idle の幅 ÷ SpriteCollab の幅で自動判定し、同じ倍率で作る（`--scale N` で上書き）。
- **色**: 基本種と対象の pokeSprite GIF を各 8 色に分け、色相と面積の近い組で対応づけて PMD の各色をずらす（`build-recolor-anim.js` と同じ）。足りなければ `tools/recolor-maps/<id>.json` の `map` に `基本種の hex → 新しい hex` を書く（ツールが基本種のパレット一覧と変換後の色を表示する）。
- **パーツ**: `tools/recolor-parts/<id>.json`。書式は `build-recolor-anim.js` の冒頭と同じ（`grow`、`colors`、`parts[].anchor` = head / center / handL / handR、`dirs.S/SE/E/NE/N` の `at` と `px` 文字グリッド。SW/W/NW は鏡像）。位置はツールが出力する「Idle 1 コマ目のアンカー座標」を基準に決め、`review.png` の 2 段目（アンカー印つき）で確認する。`layer: "back"` は体の透明部分にだけ描く。
- **実例**: メガフシギバナ = 額の花（head）、メガカメックス = 背中の大砲（center、`grow 8`）、メガミュウツーX = 角（head）+ 色対応表（白 → 薄紫灰）。
- 確認: `review.png` の 1 段目 = 8 方向、2 段目 = アンカー、3 段目 = Walk / Attack / Shoot / … の S と E。ゲームでは `index.html?autostart=<slug>,<slug>` で確認。
