# Allowlist for the Cognito pre-sign-up trigger. Edited later with `aws ssm put-parameter --overwrite`;
# Terraform ignores value drift so operators can add people without a plan/apply.
resource "aws_ssm_parameter" "allowed_emails" {
  name  = "${local.ssm_prefix}/auth/allowed-emails"
  type  = "SecureString"
  value = join(",", var.allowed_emails)
  lifecycle { ignore_changes = [value] }
}
