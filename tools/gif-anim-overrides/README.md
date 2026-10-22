# gif-anim-overrides

`tools/build-gif-anim.js` が pokeSprite の GIF から pokeAnim シートを作るときの、1 体ごとの調整。
GIF の全コマは最初に `tools/pixelize.js` で PMD 風ドット絵（PMD の体高・約 12 色・黒い 1px 輪郭）に変換され、
動き（踏み込みなど）はその変換後の絵の上で組み立てられる。**px の値（lungePx / hopPx / lunge）はすべて変換後の PMD ドット単位**
（以前の GIF 単位の値は倍率を掛けて換算済み。各ファイルの `_units` 参照）。
`*.json` をファイル名順に読み、同じ id は後のファイルが上書き（`anims` の中身はマージ）。`_` で始まるキーは無視。
`zz-calm-idle.json` は最後に読まれ、技のエフェクトが描き込まれた 19 / 20 コマの GIF（第6世代以降の形式。19 コマは 3〜8 が口元・
12〜16 が手元のエフェクト、20 コマは 4〜9 と 13〜17、11〜12・18〜19 に羽ばたきの線）の Idle を、エフェクトの無いコマだけ
（19 コマ: 0,1,2,10,11,17,18 / 20 コマ: 0,1,2,3,2,1 の往復）にしている。エフェクトのコマは各ファイルで技に使う。

複数の `--only` を同時に走らせないこと（どれも manifest.json 全体を読んで書き戻すので、後に終わった方が先の結果を消す）。

## 確認と再生成

```sh
# 1 体だけ作り直す（manifest.json / manifest.js / CREDITS.md も更新）
node tools/build-gif-anim.js --only 0006_charizard-gmax
# コマ選び用コンタクトシートも出す（<dir>/<id>.png）
node tools/build-gif-anim.js --only 0006_charizard-gmax --review /path/to/review
# ドット絵の確認シート（基本種の PMD 待機 S・変換後の待機 S/E/N・元 GIF の 0 コマ目 ×2・パレット・全アニメの S 行、×4）
node tools/build-gif-anim.js --only 0006_charizard-gmax --pixel-review /path/to/pixel-review
# 全部（PMD 側も含めた通常ビルドでも自動で走る）
node tools/build-anim.js
```

コンタクトシートの見方: 上が front.gif の全コマ（番号＝下の書式で使うコマ番号。色付きの番号は自動で選ばれた
ポーズ: 緑 rest / 黄 mid / 青 crouch / 赤 reach。赤背景のコマは idleRange の外）。その下に 8 方向の向き確認、
続いて各アニメの S 行（`GIF FR` は使った GIF コマ、`TICKS` は 1/60 秒単位、赤背景がヒットのコマ）。

## SCHEMA

```jsonc
{
  "<ロスターid>": {
    "skip": false,              // true: GIF 由来シートを作らない（manifest から外れ、旧 GIF 表示に戻る）
    "idleRange": [0, 40],       // Idle に使う front.gif のコマ範囲（両端含む）。ポーズの自動選択もこの範囲内
    "idleFrames": [0, 1, 2, 10, 11, 17, 18],
                                // Idle のコマを列挙（飛び飛び・往復も可。idleRange より優先）。tick は各コマの GIF の
                                // delay から。anims.Idle.ticks で上書きできる。体の高さ（画面上の大きさの基準）もこのコマで測る
    "lungePx": 6,               // 踏み込み量の基準 px（変換後の PMD ドット単位）。既定 = 体高×0.24（3〜14）
    "hopPx": 2,                 // Walk の上下ホップ px（PMD ドット単位）。既定 = 体高 40 以上で 2、未満で 1

    // --- ドット絵変換（tools/pixelize.js）。manifest の "pixel" に実際の値が残る ---
    "pixelHeight": 30,          // 変換後の体高（px、輪郭込み）。既定: 基本種に PMD の絵があれば その PMD 体高 × 描画サイズ比
                                // （= 基本種と同じ画素密度。キョダイは大きくなる）、無ければ PMD 全体の「体高 ∝ 高さ^0.27」回帰
    "colors": 12,               // パレットの色数（輪郭の黒は別）。全コマ・全 GIF 共通で 1 回だけ k-means（OKLab）
    "paletteFrom": "0006_charizard",
                                // この PMD シートの色に近い色（OKLab 距離 0.075 以内）をその色に揃える。
                                // 既定 = 基本種（PMD がある場合）。null で無効
    "outline": "black",         // "black"（PMD と同じ真っ黒）| "dark"（内側の色の暗い影色）| "none"
    "outlineOutside": true,     // true: シルエットの外側に 1px 足す（細い手足・目が塗りつぶされない）/ false: 縁の画素を暗くする
    "outlineInner": false,      // true: 強く色の違う領域の境目にも暗い線を足す
    "innerLines": 0.34,         // 面積のこの割合以上が元 GIF の濃い線で覆われた画素を内側の線（黒）にする。0 で無効
    "lineWeight": 0.6,          // 色を決める多数決で元 GIF の線の画素が持つ重み
    "alphaThreshold": 0.45,     // この被覆率以上の画素を不透明に（細い角・尾の稜線は 0.2 以上でも残す）
    "keepDetail": 3,            // （outlineOutside:false のとき）この大きさまでの高コントラストの塊（目など）は輪郭で潰さない
    "speckSize": 3, "speckContrast": 0.16,
                                // この大きさまでの塊で周りと色が近い（OKLab 距離 < speckContrast）ものは周りに吸収（ノイズ除去）
    "darkLift": 0.32,           // 面積の 5% 以上を占めるほぼ黒の色をこの明るさ（OKLab L）に上げ、黒い輪郭と区別できるようにする

    "poses": { "rest": 0, "crouch": 18, "reach": 14, "mid": 16 },
                                // 自動ポーズの差し替え（レシピの "rest" などがこのコマになる）
    "walkFrames": [0, 4, 8, 12, 16, 20, 24, 28],    // Walk のコマ（既定: Idle 範囲から等間隔に 8 枚）
    "attackFrames": [...], "strikeFrames": [...], "shootFrames": [...], "spAttackFrames": [...],
    "chargeFrames": [...], "hurtFrames": [...], "faintFrames": [...],
                                // 各アクションのステップごとの GIF コマ。足りない分は先頭から繰り返す
    "hitFrame": 2,              // Attack のヒットのステップ番号（0 始まり）
    "anims": {                  // アニメ別の細かい指定（上の省略形と同じ意味で、こちらが優先）
      "Strike": { "frames": [...], "hit": 4, "ticks": [6, 3, 1, 1, 2, 6, 2, 2, 2, 2], "lunge": 12 }
    }
  }
}
```

- コマ番号はすべて **front.gif のコマ番号**。他の向き（front-reverse / back / back-reverse）はループ内の同じ時刻のコマが使われる
- ステップ数と既定値（ポーズ・tick・動き）はレシピで決まる:

| アニメ | ステップ（ポーズ） | 動き | 既定 hit |
|---|---|---|---|
| Attack | rest, crouch, crouch, reach, reach, reach, mid, rest, rest | 溜め→向いている方へ踏み込み→戻る | 4 |
| Strike | crouch, crouch, reach, reach, reach, reach, mid, mid, rest, rest | 大きく速い踏み込み＋横ずれの溜め（斬り） | 4 |
| Shoot | crouch, reach, reach, reach, mid, rest, rest | 発射で後ろへ反動 | 2 |
| SpAttack | crouch, reach, reach, reach, reach, reach, mid, rest, rest | 浮き上がって保持 | 3 |
| Charge | crouch ×8, mid, rest | 小刻みに震えて沈む＋白く脈打つ | 5 |
| Hurt | crouch, crouch, mid | 後ろへノックバック | 0 |
| Faint | crouch ×7 | 後ろへ跳ね、地面に沈んで保持 | 0 |

- 絵は変形しない（PMD サイズへの一律の縮小とドット絵化以外、回転・歪みなし）。使える効果はコマ選び・タイミング・整数 px の平行移動・地面での切り取り・白フラッシュだけ
- ドット絵化の手順（tools/pixelize.js）: ① 全 GIF・全コマの元の色から k-means でパレット ② 体高から決めた倍率で、足元と左右中央を
  基準にした格子に面積で縮小。各画素の色は覆う面積の多数決（元の濃い線は lineWeight 倍）、不透明度は被覆率 ③ 元の線が多く
  掛かる画素は内側の線に ④ 孤立画素の削除・1px の穴埋め・色の近い小さな塊の吸収（高コントラストの目などは残す）⑤ 外側に黒い輪郭
- 同じ見た目が続くコマは自動で 1 枚にまとめる（tick は合算）。hit / rush / ret はまとめた後の番号に直して manifest に入る
