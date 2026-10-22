# PMDスプライト制作環境

2026-10-27整備。pokeSpriteをデザイン資料として使い、PMDの方向別・技別ポーズを下地にして制作する。
Node.jsとPython標準ライブラリで動作。PNG・GIFの処理は既存のプロジェクト内ツールを使う。
インターネットが必要なのは素材の追加取得時だけ。比較ビューは画像を埋め込んだHTMLなので単独で開ける。

## 用意した作業場所

- `charizard-mega-x/`: SpriteCollabのメガリザードンXをネイティブ解像度で読み込んだ教材・編集プロジェクト。
  8アニメ、560セル。元のゲームの7シートに加えて、Attack由来のStrikeを含む。
  今回取得した元素材と、以前からゲーム内にあるIdleの変更版は区別する。
- `charizard-mega-y-parts/`: 既存のパーツ・配色変換ツールを実行した出力。
- `charizard-mega-y/`: 上記出力を各方向・各技・各コマの編集形式へ取り込んだ制作下地。
  9アニメ、584セル。現時点の形は基本種のままなので、メガYの角・翼・腕などの描き直しが必要。
  この下地をメガYの完成品として扱わない。

## 開く・編集する

`PMD制作ビュー.command` をダブルクリックすると、メガXプロジェクトを再ビルドして比較ビューを開く。
コマ送り、0.25/0.5/1倍再生、1/2/4倍表示、背景色、前コマの重ね表示に対応。
左は読み込み時の絵、右が編集結果。上部には対象のpokeSprite front/backを表示する。

各プロジェクトには次のファイルがある。

| ファイル | 役割 |
|---|---|
| `project.json` | 色文字→RGBの共通パレット、出力倍率、セル寸法、各コマの時間、ヒット位置 |
| `pixels/Attack/SE-005.txt` など | 方向・技・コマごとの編集可能なドット絵。`.`は透明、他の1文字が1画素 |
| `reference/` | 読み込み時のPNGとpokeSprite資料。比較基準として保持 |
| `credits.txt` / `LICENSE.md` | 配布元の作者情報・利用条件 |
| `build/*.png` | 整数倍で出力したシート |
| `build/manifest-fragment.json` | 作業用メタデータ。ゲーム用manifestへの自動登録はしない |
| `build/validation.json` | 寸法、色数、空コマ、境界画素、元の絵との差分の検査結果 |
| `build/preview.html` | 単独で動く比較再生ビュー |

編集はCodexからテキストグリッドを変更する方式。ビュー自体はペイント用UIではない。
8方向は独立しており、従来のfront/backの2ビュー方式の制約がない。
グリッドの幅・高さは `project.json` のセル寸法に一致させ、コマ内の余白と移動量を保持する。
パレットの色を変えると同じ文字を使う全コマへ反映される。

プロジェクトルート `pokemon_arena_2d` から:

```sh
node tools/pmd-workshop.js build workshop/charizard-mega-x
node tools/pmd-workshop.js build workshop/charizard-mega-y
```

## 新しい対象を作る

元素材を必要なフォルダだけ取得する。全リポジトリの一括生成は不要。

```sh
python3 tools/fetch-pmd-reference.py 0006 0006/0001
node tools/pmd-workshop.js init workshop/new-project 0006/0001 0006_charizard-mega-x
```

取得元は https://github.com/PMDCollab/SpriteCollab 。取得リビジョンは
`334639a66c5c70bccfe4e32fbb7d9b7c5043bae9` に固定。各ファイルのGit blob SHAとSHA-256を記録し、
同じパスに異なる内容があれば上書きを拒否する。`--revision`で明示的に別リビジョンを指定できるが、
既存キャッシュが異なる場合は別途退避が必要。元絵の利用条件・作者名は取得した資料に従う。

基本種の絵にpokeSprite由来の配色やパーツを反映してから編集したい場合:

```sh
node tools/build-mega-parts.js --id 0006_charizard-mega-y --base 0006_charizard --sc 0006 --review workshop/new-parts
node tools/pmd-workshop.js init workshop/new-edits 0006 0006_charizard-mega-y workshop/new-parts
```

既存の `tools/recolor-maps/<id>.json` と `tools/recolor-parts/<id>.json` による部位編集も利用できる。
その後、グリッドで方向別の隠れ方、技ごとの姿勢、炎・角の形を調整する。
review取り込みでは整数倍の画素配置が崩れている画像を拒否し、勝手に縮小して画質を落とさない。
各コマのキャンバスを変える場合は全グリッドと寸法を一貫して変更する必要がある。

## 検証済みの範囲

```sh
node tools/test-pmd-workshop.js
```

- メガXの560セルについて、全RGBA画素をネイティブ元画像と比較し、整数倍の完全一致を確認。
- 1画素だけ変更した場合、そのアニメだけに差分が出ることを確認。
- グリッド寸法不正、未知の色文字、0以下の再生時間を拒否。
- 実ブラウザで8アニメ×8方向の描画、前後コマ送り、拡大、背景、前コマ重ね表示を検証。
- Hurtの6画素がセル外周に触れる警告は取得元から存在するもの。新規の切れと区別して目視する。

ブラウザ検証は任意。`tools/test-pmd-workshop-browser.js` はPlaywrightとChromiumを利用し、
Playwrightの場所を `NODE_PATH`、Chromium実行ファイルを第1引数で指定する。
通常の制作・ビルド・比較ビュー閲覧にはPlaywrightのインストールは不要。

構造検査に合格しても画質の合格を意味しない。`visualApproval` は自動的にtrueにならない。
制作では8方向での形態の識別、翼・角・尾の可読性、技ポーズの成立、足元の不要な揺れ、
ヒットのタイミングを比較する。ゲーム組み込み前には現行描画処理での再確認が必要。
今回の作業で `pokeAnim` の元画像とゲーム用manifestは変更していない。
