#!/usr/bin/env bash
# Deploys infra/template.yaml with the AWS CLI alone (CloudFormation applies the SAM transform).
# Two passes: the Function URL host is only known after the first, and is then pinned in ALLOWED_HOSTS.
#
#   STACK=scaffold REGION=us-east-1 BUDGET_EMAIL=you@example.com scripts/deploy-aws.sh
#
# Every resource is tagged Project=$STACK. The stack includes a monthly cost cap (BudgetLimitUsd,
# default 20) that throttles the function to zero when actual spend reaches it.
#
# Teardown: aws cloudformation delete-stack --stack-name "$STACK" --region "$REGION"
set -euo pipefail
cd "$(dirname "$0")/.."

STACK="${STACK:-scaffold}"
REGION="${REGION:-us-east-1}"
BUDGET_EMAIL="${BUDGET_EMAIL:-}"
ACCOUNT="$(aws sts get-caller-identity --region "$REGION" --query Account --output text)"
BUCKET="${BUCKET:-$STACK-deploy-$ACCOUNT-$REGION}"
SECRET_FILE="${SECRET_FILE:-data/.aws-token-secret}"

# The HMAC secret for demo-sandbox tokens is generated once and kept out of the repo (data/ is ignored).
mkdir -p data
[ -s "$SECRET_FILE" ] || (umask 077 && openssl rand -hex 32 > "$SECRET_FILE")

aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null ||
  if [ "$REGION" = us-east-1 ]; then aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  else aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null; fi
aws s3api put-public-access-block --bucket "$BUCKET" --region "$REGION" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

scripts/package-lambda.sh
aws cloudformation package --region "$REGION" --template-file infra/template.yaml \
  --s3-bucket "$BUCKET" --output-template-file build/packaged.yaml >/dev/null

deploy() {
  aws cloudformation deploy --region "$REGION" --stack-name "$STACK" --template-file build/packaged.yaml \
    --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --no-fail-on-empty-changeset --tags "Project=$STACK" \
    --parameter-overrides "TokenSecret=$(cat "$SECRET_FILE")" "BudgetEmail=$BUDGET_EMAIL" "AllowedHosts=$1"
}
url() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text
}

deploy ""
HOST="$(url | sed -E 's#^https://([^/]+)/?$#\1#')"
deploy "$HOST"
echo "Deployed: $(url)"
