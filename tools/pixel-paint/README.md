# pixel-paint — GIF 由来シートの手描き修正レイヤー

`tools/build-gif-anim.js` は pokeSprite の GIF を `tools/pixelize.js` で PMD 風ドット絵に変換してからアニメを組み立てる。
自動変換の出来が悪い体は、このフォルダに **テキストのドット絵（グリッド）** を置くと、ビルド時に変換結果の代わりに
その画素がそのまま使われる（再ビルドしても消えない）。体高 bodyH / anchorY は手描き後の絵で測られ、manifest の
`pixel.painted = true`（`pixel.paintedFrames` = 差し替えたコマ数）が付く。

## コマンド

```sh
node tools/pixel-paint.js export  <id> [--keys N] [--all] [--force]   # 現在の変換結果から下絵を書き出す
node tools/pixel-paint.js check   <id>                                # 形式チェック + 未塗りの使用コマ一覧 + 空ビルド
node tools/pixel-paint.js preview <id> [--out ファイル.png|ディレクトリ]  # 確認画像（pokeAnim / manifest は触らない）
node tools/build-gif-anim.js --only <id>                              # 本番に反映（pokeAnim と manifest を書く）
```

- `export` は既にグリッドがあると拒否する（塗った絵を守るため）。作り直すときだけ `--force`。
- `--keys N`: 1 ビューあたりのキー絵の上限（既定 10）。`--all`: キーにまとめず、使われる変換コマを全部（同一コマは重複排除）書き出す。
- `preview` の既定の出力先: `/private/tmp/claude-501/-Users-honmahiroshi-Desktop-claude-workspace/51c3ddde-de40-48ed-918d-f3b3748b824d/scratchpad/paint/preview/<id>.png`。
  一時ファイル + rename で書くので、何体ぶん同時に走らせても安全。内容: 塗ったグリッド ×8（薄いマス目、余白 4px は点線気味）、
  ビルドと同じ合成による待機 S/E/N ×4、基本種の PMD 待機 S、体格の近い PMD 2 体 ×4、各アニメの S 行 ×4。
- `build-gif-anim.js --only` は manifest 全体を書き戻すので、**複数を同時に走らせないこと**（preview / check は何も書かないので並行 OK）。

## フォルダの中身（`tools/pixel-paint/<id>/`）

| ファイル | 内容 |
|---|---|
| `palette.txt` | 1 行 1 色: `<文字> <rrggbb>`。`.` = 透明、`#` = 輪郭の黒 000000、`0-9 a-z A-Z` = その体の色（明るさ順）。`//` 以降はコメント。**新しい色は自由に追加してよい**（空白以外の未使用の 1 文字なら何でも。例 `P ff80c0`） |
| `<view>_<key>.txt` | グリッド。例 `front_k3.txt`。行 = 画素の行、1 文字 = 1 画素。全ファイル同じビューなら同じ幅×高さ（`meta.json` の w×h） |
| `<view>_f<iii>.txt` | （任意）1 コマだけの差し替え。例 `back_f012.txt` は back.gif の 12 コマ目。キーより優先 |
| `map.json` | どの GIF コマをどのキー絵で描くか: `views.<view>.keys.<key> = { "src": 下絵にしたコマ, "frames": [そのキーで描く全コマ] }`。`poses` は技のポーズ（rest/crouch/reach/mid、front.gif のコマ番号）を固定する |
| `meta.json` | 書き出し時の情報（変換キャンバスの W×H、グリッドの原点 x0,y0 と w×h、余白、`derive` = 鏡像で作るビュー、鏡像チェック結果）。**編集しない** |

### ビュー

- `front` = front.gif（S, W, SW 行）、`back` = back.gif（NE 行）。
- `frontR`（SE, E）/ `backR`（N, NW）は、11 体すべて front-reverse.gif / back-reverse.gif が front / back の左右反転だと
  確認済み（`meta.json` の `mirrorCheck`。carkol / coalossal-gmax は縁の陰影が少し違うだけ、carkol と garbodor-gmax は
  コマ数が違うが同じ絵の間引き）なので、**塗った front / back を反転して作る**。塗るのは 2 ビューだけ。

### グリッドの決まり

- 変換後の全コマを囲む箱 + **上下左右 4px の余白**。余白に描き足して体を太く・広くしてよい（はみ出しはできないので、
  足りなければ塗った絵を退避してから `export --force` で余白を取り直す。`tools/pixel-paint.js` の MARGIN で余白幅を変えられる）。
- 画面上の足元 = そのビューの全コマを合わせた一番下の不透明画素。全キーで足元の行を揃えること（揃っていないと跳ねる）。
- 行数・各行の文字数は `meta.json` の h・w と完全に一致させる（`check` が検査）。

## 作業の流れ

1. `node tools/pixel-paint.js preview <id>` で現状を見る（PMD の参考 2 体と並ぶ）。
2. `front_k*.txt` / `back_k*.txt` を 1 画素ずつ直す。必要なら `palette.txt` に色を足す。
   PMD 基準: 体 25〜40px、1px の黒輪郭、平塗り 10〜15 色 + 1〜2 段の影、目・顔ははっきり大きく、塊はすっきり。
3. キー絵を減らしたい／振り分けを変えたいときは `map.json` の `frames` を書き換える（例: 待機は k0〜k3 だけ使う）。
   使わなくなったキーは `frames` を他のキーへ移して、その .txt を消す。全コマがどこかのキーに入っていること
   （入っていない使用コマは変換のままになり、`check` が warn を出す）。
4. `node tools/pixel-paint.js check <id>` → `preview <id>` で確認を繰り返す。
5. 反映: `node tools/build-gif-anim.js --only <id>`（1 つずつ順番に）。

### 既定のキー割り当て（export）

使われるコマ（全アニメ・全行）から、まず技のポーズ（rest / crouch / reach / mid）、次に互いに一番違うコマを順に選んで
最大 10 枚をキーにし、GIF の全コマ（使われないコマも。足元・箱の計算に効くため）を一番近いキーに割り当てる。
待機が 3 種以上の絵を持つ GIF では、待機に必ず 3 キー以上が残るようにしている。
同じキーに割り当てられた連続コマはビルドで 1 コマにまとめられる。

## ビルド側の仕組み（tools/build-gif-anim.js）

`buildEntry` で pixelize の直後に `PixelPaint.apply(id, px.gifs)` を呼ぶ。`meta.json` があれば、各ビューの各コマを
グリッドで置き換え（キャンバスはグリッドの余白ぶん広げる）、`derive` のビューを反転で作り、`map.json` の `poses` を
自動ポーズ選択より優先する（`gif-anim-overrides` の `poses` はさらに優先）。このフォルダを消せば元の自動変換に戻る。
