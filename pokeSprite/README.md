# Pokémon sprite layout

Sprites are organized by the Pokémon's debut generation, then by Pokémon, form,
and image role.

```text
pokeSprite/
├── gen1/
│   └── 0006_charizard/
│       ├── normal/
│       │   ├── front.png
│       │   ├── front.gif
│       │   ├── front-reverse.gif
│       │   ├── back.png
│       │   ├── back.gif
│       │   └── back-reverse.gif
│       ├── mega/
│       │   ├── charizard-mega-x/
│       │   └── charizard-mega-y/
│       └── gigantamax/
│           └── charizard-gmax/
├── gen2/ … gen9/
├── items/
├── manifest.json
└── manifest.js
```

- `manifest.json` is the canonical machine-readable inventory. During the
  copy-and-verify phase it temporarily carries the old-to-new audit map; the
  completed migration removes those obsolete paths.
- `manifest.js` is the browser-safe version. The game opens directly through a
  `file://` URL, so it is loaded as a classic script instead of being fetched.
- Regional forms are stored below `regional/<form-slug>/`.
- `front-reverse.gif` and `back-reverse.gif` are explicit manifest entries; the
  game does not need to infer their paths from file names.

The migration and integrity checker is `../tools/migrate-sprites.js`.

```bash
node gameImpCore/tools/migrate-sprites.js verify
```
