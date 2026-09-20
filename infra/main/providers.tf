terraform {
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.7" }
  }
  backend "s3" {
    key          = "main/terraform.tfstate"
    region       = "us-east-1"
    profile      = "yevhenii"
    use_lockfile = true
    # bucket comes from backend.hcl (terraform init -backend-config=backend.hcl)
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile
  default_tags {
    tags = { Project = var.project, ManagedBy = "terraform" }
  }
}
