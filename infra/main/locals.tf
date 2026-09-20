data "aws_caller_identity" "current" {}

locals {
  account_id            = data.aws_caller_identity.current.account_id
  app_url               = "https://${var.domain_name}"
  ssm_prefix            = "/${var.project}"
  lambda_names          = ["poller", "api", "tg-webhook", "pre-signup"]
  cognito_domain_prefix = "${var.project}-${local.account_id}"
  poller_arn            = "arn:aws:lambda:${var.region}:${local.account_id}:function:${var.project}-poller"
}
