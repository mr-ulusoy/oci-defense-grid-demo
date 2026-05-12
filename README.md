<img width="484" height="745" alt="image" src="https://github.com/user-attachments/assets/634f786e-6ec2-4137-911f-7965187b02c3" />

# OCI Defense Grid Demo

OCI Defense Grid is a V1 customer-demo remix of a Phaser space shooter. The player defends an Oracle Cloud region while the app shows live cloud telemetry: Compute VMs, Load Balancer, API Gateway, Streaming, Autonomous Database, Object Storage, Analytics and an AI copilot.

The game can run locally with offline fallbacks, then be deployed to OCI with Terraform.

## Local Run

```bash
npm install
cp .env.example .env
npm run dev:api
```

In a second terminal:

```bash
npm run dev
```

Open `http://localhost:5173`.

The Vite dev server proxies `/api/*` to the local Express API. Without OCI environment variables, telemetry stays in memory and the copilot uses deterministic demo insights.

## Architecture

```text
Player browser
  -> OCI public Load Balancer
     -> Compute Instance Pool running Nginx static game

Game API calls
  -> OCI API Gateway
     -> private OCI Load Balancer
        -> Compute Instance Pool Node/Express API
           -> OCI Streaming
           -> Autonomous Database
           -> Object Storage raw event archive
           -> OCI Generative AI hook or deterministic fallback
```

Redis/OCI Cache is intentionally outside V1.

The Compute layer uses an OCI instance pool with autoscaling. Defaults are two always-on
instances for HA, with CPU-based scale-out up to four instances for the live demo.

## Runtime API

The API Gateway exposes these routes:

```http
POST /api/events
GET /api/status
GET /api/leaderboard
GET /api/analytics/live?runId=...
POST /api/copilot
```

Telemetry events use this envelope:

```json
{
  "runId": "uuid",
  "sessionId": "uuid",
  "type": "enemy_killed",
  "level": 1,
  "score": 4200,
  "cloudAction": "rebalance_lb",
  "metrics": { "fps": 58, "latencyMs": 42 },
  "clientTs": "2026-05-12T18:00:00.000Z"
}
```

## OCI Deploy

1. Push this repo to a Git remote that the OCI VMs can clone.
2. Copy `infra/terraform/terraform.tfvars.example` to a real `.tfvars` file.
3. Fill in tenancy, compartment, region, SSH key, Oracle Linux image OCID and `app_repo_url`.
4. Keep `instance_pool_min_size = 2`, `instance_pool_initial_size = 2`, `instance_pool_max_size = 4` for the default autoscaling demo.
5. Run:

```bash
terraform -chdir=infra/terraform init
terraform -chdir=infra/terraform fmt
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform plan -var-file=demo.tfvars
terraform -chdir=infra/terraform apply -var-file=demo.tfvars
```

Terraform outputs `game_url` and `api_gateway_endpoint`. The VM cloud-init writes `config.js` so the browser calls API Gateway rather than bypassing it.

For instance-principal access to Streaming/Object Storage, set:

```hcl
create_instance_principal_policy = true
```

This creates a dynamic group for instances in the compartment and grants publish/archive permissions.

## Autonomous Database

Create tables with:

```bash
sql /nolog
```

Then connect to the Autonomous Database and run:

```sql
@server/schema.sql
```

Set these VM/API environment variables if you want the Express API to persist directly to ADB:

```bash
ADB_USER=ADMIN
ADB_PASSWORD=...
ADB_CONNECT_STRING=...
```

## Oracle Analytics

Use `game_events` as the primary dataset. Suggested dashboard tiles:

- Events/sec by run
- Score by session
- Cloud action mix
- Active VM/backend
- Player hit events versus latency
- Latest AI insight

Terraform can optionally create an Analytics instance with:

```hcl
create_analytics_instance = true
```

## OCI Functions

`functions/event-ingest` is a V1 function stub for moving event ingestion from VM-backed Express to OCI Functions later. In this V1 implementation, API Gateway routes `/api/events` to the VM API so the demo is deployable without first building and pushing a function image.

Set `function_image` in Terraform when you have an OCIR image ready.

## Verification

```bash
npm test
terraform -chdir=infra/terraform fmt
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform plan -var-file=demo.tfvars
```

The customer-facing demo checks are:

- Game loads through the public Load Balancer.
- `/api/status` shows the active VM/backend.
- Compute uses an instance pool with autoscaling enabled.
- Gameplay events appear in Streaming and Object Storage.
- Autonomous Database receives `game_events`.
- HUD updates score, latency, events/sec and copilot insight.
- The game remains playable when one instance is removed from the pool or fails health checks.
