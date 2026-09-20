#!/usr/bin/env bash
# Syncs the built SPA (or the placeholder) to the web bucket and invalidates CloudFront.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:-apps/web/dist}"
[ -d "$SRC" ] || SRC="apps/web/public"
BUCKET=$(cd infra/main && terraform output -raw web_bucket)
DIST=$(cd infra/main && terraform output -raw cloudfront_distribution_id)
aws s3 sync "$SRC" "s3://$BUCKET" --delete --profile yevhenii
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" --profile yevhenii >/dev/null
echo "deployed $SRC → $(cd infra/main && terraform output -raw app_url)"
