#!/bin/sh
set -eu
build=$(mktemp -d .benchmark-replay.XXXXXX)
trap 'rm -rf "$build"' EXIT
pnpm exec tsc --target ES2022 --module NodeNext --strict --skipLibCheck --rootDir . --outDir "$build" tests/eval/replay-cli.ts
node "$build/tests/eval/replay-cli.js" "$@"
