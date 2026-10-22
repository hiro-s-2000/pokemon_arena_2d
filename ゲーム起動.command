#!/bin/bash
# Serves pokemon_arena_sample over a local http server so the game can decode animated sprites,
# then opens it in the default browser. Close this window (or press Ctrl+C) to stop the server.
cd "$(dirname "$0")" || exit 1
PORT=8765
while lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT + 1)); done
python3 -m http.server "$PORT" --bind 0.0.0.0 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
sleep 1
open "http://127.0.0.1:$PORT/game/index.html"
LAN=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
echo "このパソコン: http://127.0.0.1:$PORT/game/index.html"
if [ -n "$LAN" ]; then
  echo "同じWi-Fiのスマホ: http://$LAN:$PORT/game/index.html"
else
  echo "スマホ用のアドレスは、このMacのWi-Fi IPを確認してください。"
fi
echo "このウィンドウを閉じるとサーバーが止まります。初回はファイアウォールの許可を聞かれたら許可してください。"
wait $SERVER
