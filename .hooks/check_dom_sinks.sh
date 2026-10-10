#!/usr/bin/env bash
# Pre-commit / CI gate: no raw HTML or code-eval sinks in app code.
#
# Blocks innerHTML / outerHTML / insertAdjacentHTML / document.write,
# dangerouslySetInnerHTML, eval( and new Function( in src/ and electron/.
# Render through React instead. ESLint's no-restricted-syntax covers some of
# this too; the gate exists so an eslint-disable can't hide it.
#
# A justified exception carries the marker on the same line:
#     el.innerHTML = trusted;  // sink-allowed: <reason>
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

hits=$(grep -rnE \
  '\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML|(^|[^.a-zA-Z_])eval\(|new Function\(' \
  src electron --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v 'sink-allowed:')

if [ -n "$hits" ]; then
  echo "DOM sink gate: raw HTML / eval sink found (render through React, or mark '// sink-allowed: <reason>')"
  echo "$hits"
  exit 1
fi
exit 0
