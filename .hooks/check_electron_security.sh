#!/usr/bin/env bash
# Pre-commit / CI gate: the Electron security baseline must not regress.
#
# Blocks, anywhere in electron/ and src/:
#   nodeIntegration: true        renderer gets Node
#   contextIsolation: false      preload and page share a JS world
#   sandbox: false               renderer runs unsandboxed
#   webSecurity: false           same-origin policy off
#   allowRunningInsecureContent  mixed content allowed
#   enableRemoteModule           legacy remote module
#   ipcRenderer exposed directly via contextBridge
#
# See docs/SECURITY_AUDIT.md and docs/adr/0004.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

hits=$(grep -rnE \
  'nodeIntegration\s*:\s*true|contextIsolation\s*:\s*false|sandbox\s*:\s*false|webSecurity\s*:\s*false|allowRunningInsecureContent|enableRemoteModule|exposeInMainWorld\([^)]*ipcRenderer' \
  electron src --include='*.ts' --include='*.tsx' --include='*.js' 2>/dev/null)

if [ -n "$hits" ]; then
  echo "Electron security gate: forbidden setting found"
  echo "$hits"
  exit 1
fi
exit 0
