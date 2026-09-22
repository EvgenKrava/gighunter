data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

locals {
  table_arns    = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
  ssm_users_arn = "arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.ssm_prefix}/users/*"
  ssm_auth_arn  = "arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.ssm_prefix}/auth/*"
  bedrock_arns = [
    "arn:aws:bedrock:*::foundation-model/anthropic.*",
    "arn:aws:bedrock:*:${local.account_id}:inference-profile/*anthropic*",
  ]
  ddb_rw = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:BatchGetItem"]
}

data "aws_iam_policy_document" "poller" {
  statement {
    actions   = local.ddb_rw
    resources = local.table_arns
  }
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [local.ssm_users_arn]
  }
  statement {
    actions   = ["bedrock:InvokeModel"]
    resources = local.bedrock_arns
  }
}

data "aws_iam_policy_document" "api" {
  statement {
    actions   = concat(local.ddb_rw, ["dynamodb:DeleteItem", "dynamodb:BatchWriteItem"])
    resources = local.table_arns
  }

  statement {
    actions   = ["ssm:GetParameter", "ssm:PutParameter", "ssm:DeleteParameter"]
    resources = [local.ssm_users_arn]
  }
  statement {
    actions   = ["bedrock:InvokeModel"]
    resources = local.bedrock_arns
  }
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [local.poller_arn]
  }
}

data "aws_iam_policy_document" "tg_webhook" {
  statement {
    actions   = local.ddb_rw
    resources = local.table_arns
  }
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [local.ssm_users_arn]
  }
}

data "aws_iam_policy_document" "pre_signup" {
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [local.ssm_auth_arn]
  }
}

locals {
  roles = {
    poller     = data.aws_iam_policy_document.poller.json
    api        = data.aws_iam_policy_document.api.json
    tg_webhook = data.aws_iam_policy_document.tg_webhook.json
    pre_signup = data.aws_iam_policy_document.pre_signup.json
  }
}

resource "aws_iam_role" "fn" {
  for_each           = local.roles
  name               = "${var.project}-${replace(each.key, "_", "-")}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "fn_logs" {
  for_each   = local.roles
  role       = aws_iam_role.fn[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "fn" {
  for_each = local.roles
  name     = "inline"
  role     = aws_iam_role.fn[each.key].id
  policy   = each.value
}

# Self-serve account deletion: DELETE /me looks the caller up by sub and removes the Cognito user. A separate
# policy rather than a statement in `api`: the pool depends on the pre-signup Lambda, whose role comes from the
# same `local.roles` map as the API's, so referencing the pool ARN from there is a cycle.
data "aws_iam_policy_document" "api_cognito" {
  statement {
    actions   = ["cognito-idp:ListUsers", "cognito-idp:AdminDeleteUser"]
    resources = [aws_cognito_user_pool.main.arn]
  }
}

resource "aws_iam_role_policy" "api_cognito" {
  name   = "cognito"
  role   = aws_iam_role.fn["api"].id
  policy = data.aws_iam_policy_document.api_cognito.json
}
