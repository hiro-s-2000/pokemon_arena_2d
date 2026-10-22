# 9体＋メガシンカ・キョダイマックスの8方向確認

現行の入口はワークスペースの`確認用画像/pokeSprite-smooth-review/index.html`。
通常9体、メガフシギバナ・メガリザードンX/Y・メガカメックスの4形態、
キョダイマックスのフシギバナ・リザードン・カメックスの3形態、計16種類。
通常色のみ。ゲームのpokeAnimや元のpokeSpriteは変更しない。

```sh
node tools/build-eight-direction-roster.js
node tools/build-eight-direction-roster.js --resume
node tools/build-eight-direction-roster.js --id 0006_charizard-gmax
node tools/build-eight-direction-roster.js --publish-only
```

`--resume`は同じバージョンで生成済みの個体を飛ばす。素材や生成処理を変えた場合は、
対象の`--id`または通常の全体生成を使う。`--publish-only`は完成済みの全16件から
カタログ、一覧画像、表示ページを更新する。依存は既存のNode標準ライブラリのみ。

## 素材と方法

1. `pokeData/index.json`の図鑑番号1〜9を抽出し、各形態の実際のpokeSpriteパスを解決する。
2. 各形態のfront/back PNGを読んで配色を得る。正面・背面GIFもコピーして比較画面に表示。
3. `reference-study`の通常色8方向シートを土台にする。通常9体とメガリザードンXは専用絵。
   他の6形態は、以前の制作でpokeSpriteを参照して作った基本種＋形態パーツを使用する。
   形態の専用絵を新たに描き起こしたとは扱わない。
4. OKLabで色・明暗・彩度を比較し、輪郭と白を保ってpokeSpriteパレットへ対応付けする。
5. 確認済みフシギダネのScale2x＋局所変形補間を`eight-direction-engine.js`で共通化する。
   フシギダネ自体は承認された試作のPNGをそのまま複写し、画素が変わらないようにする。
6. 288×288セル、8行。待機60、歩行48、攻撃36、被弾24、倒れる48コマ。
   サイズは通常／メガ／キョダイマックスと全動作の余白を考慮して決める。
   実際の体格比やゲーム内サイズを定義する作業ではない。

Faint元素材が1行の種類は、各方向の待機から共通の倒れ姿勢へ移行する。
8方向が全て異なる最終姿勢とは主張しない。元から8行でも最終姿勢が共通の場合がある。
コマ数は独立した描き起こしポーズ数ではなく、静止保持や変形補間を含む。

## 出力と旧版

各IDフォルダーに5シート、元GIF/PNG、方向一覧、動作一覧、サムネイル、manifest、検査結果、
クレジット・素材来歴を保存する。フォルダー内index.htmlもメインページの該当個体へ移動できる。
元の9体GIF拡大版は`previous-gif-review/`に退避。`bulbasaur-eight-directions/`の比較も残す。
旧`build-hires-review.js`は旧方式の出力先を使うため、現行版の再生成には使わない。

## 検証

生成時は全コマの非空・余白、Idleの8方向相違、入力SHA-256不変を検査する。
ブラウザーテストは`test-eight-direction-roster.js`（PlaywrightとChromeが必要）。
全16種類×5動作×8方向×3時点、各フィルター、最終コマ保持、コマ送り、file://、
旧比較ページ、モバイル幅を確認する。大きなPNGは選択中の1シートだけをキャッシュする。

Pokémon © Nintendo / Creatures / GAME FREAK. PMD画像の元作者・取得履歴は各出力の
credits.txt / provenance.jsonを参照。
