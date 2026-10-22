# フシギダネ8方向の比較試作

```sh
node tools/build-bulbasaur-eight-review.js
```

出力：`確認用画像/pokeSprite-smooth-review/bulbasaur-eight-directions/`。
`index.html`を直接開く。前回の9体プレビューにも入口を追加済み。

## 元素材と加工

- 対象は通常色のフシギダネ1体。残り8体とゲームへの展開は、この比較の後に行う。
- 方向別の形と主要ポーズは`reference-study/gen1/0001_bulbasaur/normal`の
  PMDシートを使用。前回のfront/backの行複製とは異なる。
- 元画像の2倍画素をnativeへ戻し、pokeSpriteの体・つぼみ・目の色へ明示的に対応付け。
  Scale2xの輪郭処理後、nativeの4倍で書き出す。新たな顔の画素を描く処理ではない。
- 1セル288×288、足元180。元のフレーム位置は保ち、動作中の前進・反動を残す。
- 隣接ポーズ間は3×3パッチの局所マッチングと平滑化した移動場で変形する。
  透明度のクロスフェードは使わない。途中で近い側の原画へ切り替えるため、
  形状や遮蔽の大きな変化は完全には滑らかにならない。
- 待機60、歩行48、攻撃36、被弾24、倒れる48コマ。
  静止区間・終端には同一画素の保持がある。新規ポーズ数と同じ意味ではない。
- Faintは元の各方向列を使用するが、元素材の最終姿勢は複数方向で共通。
  Idleの8方向が全て異なることを検証する一方、Faintの全コマが8種類とは主張しない。

## 比較で判断すること

前回版はpokeSpriteの顔の細部を保持するが、方向は正面・背面と反転のみ。
今回版は実際の正面・横・背面と動作専用ポーズを持つが、顔の細かさはPMD素材に制限される。
形・顔・方向の読みやすさを確認してから、他のポケモンへ展開する。

## 検証と権利表記

生成時：非空・余白・8方向Idleの相違・素材SHA-256不変を検査。
`test-bulbasaur-eight-review.js`（Playwright）は8方向×5動作×3時点を表示し、
方向ボタン、コマ送り、Faint最終保持、file://読み込み、スマートフォン幅を確認する。
結果は`validation.json`と`browser-validation.json`。

PMD素材の出典・作者情報を`provenance.json`と`credits.txt`へそのまま複写。
Pokémon © Nintendo / Creatures / GAME FREAK.
