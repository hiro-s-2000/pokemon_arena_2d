# pokeSprite高解像度・補間アニメーション確認

この文書は旧GIF方式の記録です。現行の16種類・8方向版は
[README-eight-direction-roster.md](README-eight-direction-roster.md)を参照してください。
旧出力は`pokeSprite-smooth-review/previous-gif-review/`へ保存されています。

対象は通常色の図鑑0001〜0009。元の`front.gif` / `back.gif`を既存の
`build-gif-anim.js`でデコードし、元色を残したまま最近傍で拡大・変形する。
画像生成APIや外部通信は使わない。

```sh
node tools/build-hires-review.js
```

出力はワークスペースの`確認用画像/pokeSprite-smooth-review/`。
`index.html`を直接開けば再生できる。サーバー不要。
`overview.png`は9体の代表ポーズ、各IDの`contact.png`は動作別の代表コマ。
`Idle.png`等は全コマ・全行の透過PNG。`manifest.json`に寸法・時間・出典を保存する。
元のpokeSprite、pokeAnim、前回の確認画像は更新しない。

| 動作 | コマ数 | 再生時間 | 終端 |
| --- | ---: | ---: | --- |
| Idle | 60 | 2秒 | ループ |
| Walk | 48 | 0.8秒 | ループ |
| Attack | 36 | 0.6秒 | 待機姿勢へ復帰 |
| Hurt | 24 | 0.4秒 | 待機姿勢へ復帰 |
| Faint | 48 | 0.8秒 | 倒れたコマで保持 |

セルは192×192px。全前後GIFの不透明領域の最大幅／高さを基準に長辺96pxへ
揃える。元GIFの顔の画素・色を保ち、15色制限や従来の低解像度化は使わない。
元の絵より細部が増えるわけではなく、元画素の拡大である。

WalkではGIFのコマを時間で選び、下部32%に連続的な踏み替え変形を加える。
Attackでは予備動作・突進・復帰を、Hurtでは反動・復帰をsmoothstepで補間する。
Faintは回転・圧縮で倒れる動きを作る。顔を描き直さないため目は元画像のまま。
元GIFは歩行／攻撃専用の素材ではなく、これらは変形による近似である。
端点や静止区間で同一画素のコマが生じる。独立した画素数はvalidation.jsonに記録。

8行の順序はS,SE,E,NE,N,NW,W,SWで既存builderに合わせる。ただし正面・背面と
その反転のみを使う互換配置であり、独立した8方向の絵ではない。
プレビューでは重複をまとめた4種類を選択できる。

生成時に全コマの非空・余白・元素材SHA-256不変を検査する。
ブラウザー検証は`node tools/test-hires-review.js`（Playwrightが必要）。
9体×5動作×4素材方向の表示、コマ送り、Faintの最終保持、モバイル幅、
file://での読み込みを確認し、browser-validation.jsonを出力する。

元素材の権利表記: Pokémon © Nintendo / Creatures / GAME FREAK.
