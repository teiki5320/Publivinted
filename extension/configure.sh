#!/bin/sh
# Indique à l'extension l'adresse de l'appli Publivinted (pour le pont appli ↔ extension).
# Usage : ./extension/configure.sh https://publivinted.MONCOMPTE.workers.dev
set -e
URL="${1%/}"
case "$URL" in https://*) ;; *) echo "Donne l'adresse complète en https://"; exit 1 ;; esac
DIR="$(cd "$(dirname "$0")" && pwd)"
python3 - "$DIR/manifest.json" "$URL" <<'EOF'
import json, sys
path, url = sys.argv[1], sys.argv[2]
m = json.load(open(path))
for cs in m["content_scripts"]:
    if "bridge.js" in cs["js"]:
        cs["matches"] = [url + "/*", "http://localhost:8787/*"]
json.dump(m, open(path, "w"), ensure_ascii=False, indent=2)
print("Extension reliée à", url, "— recharge-la dans chrome://extensions")
EOF
