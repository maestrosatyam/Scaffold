#!/usr/bin/env bash
# Builds a self-contained Lambda bundle in build/lambda (compiled JS + web/app assets + prod deps).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
npx tsc -p tsconfig.build.json
rm -rf build/lambda && mkdir -p build/lambda
cp -r dist build/lambda/dist
cp package.json package-lock.json build/lambda/
(cd build/lambda && npm ci --omit=dev --no-audit --no-fund --ignore-scripts)
du -sh build/lambda
echo "Bundle ready. Deploy with: sam deploy --guided --template-file infra/template.yaml"
