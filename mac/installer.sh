#!/bin/sh
# Publivinted — lance le programme du Mac en continu (au démarrage de la session, relancé s'il s'arrête).
# Usage : ./mac/installer.sh            installe ou met à jour
#         ./mac/installer.sh --retirer  arrête et retire
# Journal : ~/Library/Logs/publivinted.log
set -e
LABEL="com.teiki.publivinted"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")" && pwd)"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "$1" = "--retirer" ]; then
  rm -f "$PLIST"
  echo "Programme Publivinted arrêté et retiré."
  exit 0
fi

NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Node.js introuvable : installe-le (https://nodejs.org) puis relance."; exit 1; }
[ -f "$DIR/.env" ] || { echo "Crée d'abord $DIR/.env avec la ligne PV_TOKEN=<code d'accès de l'appli>."; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$DIR/agent.mjs</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/publivinted.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/publivinted.log</string>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Programme Publivinted lancé. Journal : ~/Library/Logs/publivinted.log"
