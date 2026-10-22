#!/bin/zsh
set -eu
cd "${0:A:h}/.."
if ! command -v node >/dev/null 2>&1; then
  if [[ -x "$HOME/.nodebrew/current/bin/node" ]]; then
    export PATH="$HOME/.nodebrew/current/bin:$PATH"
  else
    print 'Node.js が見つかりません。ターミナルから node tools/pmd-workshop.js build workshop/charizard-mega-x を実行してください。'
    read '?Enterで閉じる'
    exit 1
  fi
fi
node tools/pmd-workshop.js build workshop/charizard-mega-x
open workshop/charizard-mega-x/build/preview.html
