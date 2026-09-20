variable "project" {
  type    = string
  default = "gighunter"
}
variable "aws_profile" {
  type    = string
  default = "yevhenii"
}
variable "region" {
  type    = string
  default = "us-east-1"
}
variable "domain_name" {
  type    = string
  default = "gighunter.onlytools.click"
}
variable "hosted_zone_name" {
  type    = string
  default = "onlytools.click"
}
variable "lambda_dist_dir" {
  type    = string
  default = "../../apps/lambdas/dist"
}
variable "dev_origins" {
  type    = list(string)
  default = ["http://localhost:5173"]
}

variable "google_client_id" {
  type = string
}
variable "google_client_secret" {
  type      = string
  sensitive = true
}
variable "alarm_email" {
  type = string
}
variable "allowed_emails" {
  type        = list(string)
  description = "Emails allowed to sign up (Cognito pre-sign-up allowlist)"
}
