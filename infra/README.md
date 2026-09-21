# Infrastructure

Two Terraform roots, AWS profile `yevhenii`, region `us-east-1`.

## 1. Bootstrap (once)

Creates the S3 bucket that holds the main state.

```bash
cd infra/bootstrap
terraform init
terraform apply
# note the `state_bucket` output
```

Then write `infra/main/backend.hcl`:

```hcl
bucket = "gighunter-tfstate-<ACCOUNT_ID>"
```

## 2. Main

Prerequisites:

1. A Google OAuth client (Google Cloud Console → APIs & Services → Credentials → Create → OAuth client ID → Web application) with authorized redirect URI
   `https://gighunter-<ACCOUNT_ID>.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`.
2. `infra/main/terraform.tfvars` (git-ignored):

   ```hcl
   google_client_id     = "....apps.googleusercontent.com"
   google_client_secret = "..."
   alarm_email          = "you@example.com"
   allowed_emails       = ["you@example.com"]
   ```
3. Lambda bundles: `pnpm build` from the repo root.

```bash
cd infra/main
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

Confirm the SNS subscription email after the first apply. ACM validation can take a few minutes.

## Deploying changes

- Backend: `pnpm build && (cd infra/main && terraform apply)` — Terraform re-zips `apps/lambdas/dist/*` and updates functions whose hash changed.
- Frontend: `pnpm build:web && pnpm deploy:web` — builds `apps/web/dist` and syncs it to the web bucket, invalidating CloudFront.

## Destroy

`terraform destroy` in `infra/main` removes everything except the state bucket. The DynamoDB table has PITR on; export first if the data matters.
