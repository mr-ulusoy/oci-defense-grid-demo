<img width="484" height="745" alt="image" src="https://github.com/user-attachments/assets/634f786e-6ec2-4137-911f-7965187b02c3" /><img width="236" height="742" alt="image" src="https://github.com/user-attachments/assets/ddf8907d-fcda-4ce2-b309-6843cdc7c2b5" />


# OCI Defense Grid Demo

OCI Defense Grid is a V1 customer-demo remix of a Phaser space shooter. The player defends an Oracle Cloud region while the demo shows live cloud telemetry: Compute VMs, Load Balancer, API Gateway, OCI Cache, Streaming, Autonomous Database, Object Storage and an OCI Generative AI copilot.

The game can run locally with offline fallbacks, then be deployed to OCI with Terraform.

## Demo Views

- Player view: `http://localhost:5173/` locally, or `http://<web-lb-ip>/` on OCI.
- Presenter/ops view: add `?ops=1`, for example `http://<web-lb-ip>/?ops=1`.

Current demo endpoints:

- Player URL: `http://207.127.95.12/`
- Presenter/ops URL: `http://207.127.95.12/?ops=1`

The player view keeps the game clean for public visitors. The ops view adds the Cloud Ops HUD with active VM, CPU, RAM, cores, disk throughput, LB/API status, latency, events/sec and AI insight.
The ops view also includes a bounded `Stress VMs` control for autoscaling demos.

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

The Vite dev server proxies `/api/*` to the local Express API. Without OCI environment variables, telemetry stays in memory. The AI copilot is only enabled in the ops view (`?ops=1`) and falls back to deterministic demo insights when GenAI is unavailable.

## Architecture

```text
Player browser
  -> OCI public Load Balancer
     -> Compute Instance Pool running Nginx static game

Game API calls
  -> OCI API Gateway
     -> POST /api/events
        -> OCI Functions event ingest, when function_image is configured
        -> VM-backed Node API fallback, when function_image is empty
     -> other /api routes
        -> private OCI Load Balancer
           -> Compute Instance Pool Node/Express API
              -> OCI Cache live player state
              -> OCI Streaming
              -> Autonomous Database
              -> Object Storage raw event archive
              -> OCI Generative AI Gemini copilot or deterministic fallback
```

OCI Cache is used for the live player roster in the presenter view. Every VM writes the latest player heartbeat/event into the same managed cache, so the ops HUD can list active players even while API Gateway and the private Load Balancer bounce between backend VMs.

The Compute layer uses an OCI instance pool with autoscaling. Defaults are two always-on
instances for HA, with CPU-based scale-out up to four instances for the live demo.

See the full wireframe in [docs/oci-defense-grid-wireframe.md](docs/oci-defense-grid-wireframe.md).

## OCI Services

| OCI service | How it is used |
| --- | --- |
| Compute Instance Pool | Runs the Phaser static game through Nginx and the Node/Express API on each VM. |
| Public Load Balancer | Public entrypoint for the game and health-checked VM failover. |
| API Gateway | Fronts all `/api/*` calls for routing, CORS and enterprise API control. |
| Private Load Balancer | Routes API Gateway traffic to the VM-backed Express API. |
| Autoscaling | Scales the instance pool from 2 to 4 VMs based on CPU. |
| OCI Cache | Stores short-lived live player snapshots shared across all app VMs. |
| Streaming | Receives gameplay telemetry events. |
| Object Storage | Archives raw events as NDJSON for replay and audit. |
| Autonomous Database | Stores curated `game_events` rows for SQL analytics and the ops Event Analytics panel. |
| OCI Generative AI | Gemini copilot insight in the ops HUD via the OCI SDK. |
| IAM Dynamic Group and Policies | Manually created prerequisites that let app VMs and Functions call Streaming, Object Storage and GenAI, and let API Gateway invoke Functions. |
| OCI Functions | Optional serverless event-ingest path for `POST /api/events`, writing gameplay telemetry to Streaming, Object Storage, OCI Cache and ADB. |

## Runtime API

The API Gateway exposes these routes:

```http
POST /api/events
GET /api/status
GET /api/leaderboard
GET /api/players/live
GET /api/analytics/live?runId=...
GET /api/analytics/events
GET /api/stress
POST /api/stress
POST /api/copilot
```

`POST /api/copilot` is for the presenter/ops view only. The browser sends it only when `?ops=1` is active, and the API requires `"ops": true` in the JSON body.
`POST /api/stress` follows the same ops-only pattern and starts short, bounded CPU load on VM API backends so autoscaling can be demonstrated without real player volume.

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
2. Create `infra/terraform/demo.tfvars` from the sanitized example.
3. Fill in tenancy, compartment, region, SSH key, Ubuntu image OCID and `app_repo_url`.
4. Keep `instance_pool_min_size = 2`, `instance_pool_initial_size = 2`, `instance_pool_max_size = 4` for the default autoscaling demo.
5. Confirm the manual IAM prerequisites below exist before enabling `function_image`.
6. Run:

```bash
cp infra/terraform/terraform.tfvars.example infra/terraform/demo.tfvars
```

Use the local working `demo.tfvars` as the reference for real values, but do not copy secrets into GitHub. Keep these values local only:

- `oci_genai_bearer_token`
- `adb_admin_password`
- private SSH keys in `infra/terraform/.keys/`
- Terraform state and plan files

`demo.tfvars` is intentionally ignored by Git. The checked-in `terraform.tfvars.example` should stay sanitized so others can copy it safely.

```bash
terraform -chdir=infra/terraform init
terraform -chdir=infra/terraform fmt
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform plan -var-file=demo.tfvars
terraform -chdir=infra/terraform apply -var-file=demo.tfvars
```

Terraform outputs `game_url` and `api_gateway_endpoint`. The VM cloud-init writes `config.js` so the browser calls API Gateway rather than bypassing it.

## Manual IAM Prerequisites

This project treats IAM dynamic groups and policies as manual prerequisites. That keeps Terraform focused on demo infrastructure and avoids accidental changes to shared tenancy-level identity resources.

Use these exact names for the current demo:

| Resource | Name | Where |
| --- | --- | --- |
| Dynamic group | `dg_cengiz` | Identity domain `OracleIdentityCloudService` |
| Telemetry/GenAI policy | `Game-Demo` | Demo compartment |
| API Gateway invoke policy | `oci-defense-grid-apigw-functions` | Demo compartment |

`dg_cengiz` must match both app VMs and OCI Functions in the demo compartment:

```text
Any {
  All {instance.compartment.id = '<compartment_ocid>'},
  All {resource.type = 'fnfunc', resource.compartment.id = '<compartment_ocid>'}
}
```

`Game-Demo` must contain these statements. Use the identity-domain-qualified dynamic group name:

```text
Allow dynamic-group OracleIdentityCloudService/dg_cengiz to use stream-push in compartment id <compartment_ocid>
Allow dynamic-group OracleIdentityCloudService/dg_cengiz to manage objects in compartment id <compartment_ocid> where target.bucket.name='<raw-events-bucket>'
Allow dynamic-group OracleIdentityCloudService/dg_cengiz to use generative-ai-family in compartment id <genai_compartment_ocid>
```

For this demo, `<genai_compartment_ocid>` is usually the same as `<compartment_ocid>`. The Object Storage bucket name is available after Terraform creates the bucket, for example `oci-defense-grid-9591c7-raw-events`.

`oci-defense-grid-apigw-functions` allows API Gateway to invoke OCI Functions backends:

```text
Allow any-user to use functions-family in compartment id <compartment_ocid> where ALL {request.principal.type = 'ApiGateway', request.resource.compartment.id = '<compartment_ocid>'}
```

If you rebuild in the same tenancy, keep the manual IAM resources above. If you deploy in a new tenancy, create the same dynamic group and policies before switching `/api/events` to OCI Functions.

## OCI Functions Event Ingest

`functions/event-ingest` is the serverless telemetry ingest function. It is designed to take load off the VMs during demo spikes:

```text
Browser POST /api/events
  -> API Gateway
     -> OCI Function event-ingest
        -> OCI Cache live player state
        -> OCI Streaming
        -> Object Storage raw NDJSON archive
        -> Autonomous Database game_events/high_scores
```

By default `function_image = ""`, so Terraform keeps `/api/events` routed to the VM-backed API. To switch the route to OCI Functions, point Terraform at an existing OCIR image and make sure the manual IAM prerequisites above are in place.

Current shared image:

```hcl
function_image = "arn.ocir.io/fr9qm01oq44x/oci-defense-grid/event-ingest:0.1.0"
```

Use that image for this demo. Build and push a new image only if the Function code changes or you deploy into an environment that cannot pull the shared OCIR image.

Recommended tfvars:

```hcl
function_image = "arn.ocir.io/fr9qm01oq44x/oci-defense-grid/event-ingest:0.1.0"
```

The Function also uses `ADB_USER`, `ADB_PASSWORD`, `ADB_CONNECT_STRING`, `REDIS_HOST`, `REDIS_PORT` and `REDIS_TLS` from Terraform function config. Redis does not need IAM. ADB writes use the configured database credentials and the existing ADB network allow-list.

Build example for a new image:

```bash
cd functions/event-ingest
docker build -t <region-key>.ocir.io/<namespace>/oci-defense-grid/event-ingest:0.1.0 .
docker push <region-key>.ocir.io/<namespace>/oci-defense-grid/event-ingest:0.1.0
```

For Stockholm, the OCIR region key is typically `arn`, so the image becomes:

```text
arn.ocir.io/<namespace>/oci-defense-grid/event-ingest:0.1.0
```

## Updating Running VMs

This demo intentionally uses bastion-based updates instead of a GitHub workflow. After pushing changes to the repo, update the running app VMs through the bastion:

```bash
scripts/deploy-via-bastion.sh
```

The script defaults to the current demo hosts:

```bash
BASTION_HOST=82.70.59.158
VM_HOSTS="10.42.20.153 10.42.20.192"
SSH_KEY=infra/terraform/.keys/oci-defense-grid-demo
DEPLOY_PATH=/opt/oci-defense-grid
DEPLOY_BRANCH=main
REDIS_HOST=<terraform redis_live_players_endpoint>
REDIS_PORT=6379
REDIS_TLS=true
```

It SSHes through the bastion to each private VM, optionally writes the Redis/OCI Cache environment drop-in, pulls the latest `main`, installs production dependencies and restarts `oci-defense-api` and `nginx`. Override any value as an environment variable if the VM list changes after autoscaling, for example:

```bash
VM_HOSTS="10.42.20.153 10.42.20.192 10.42.20.210" scripts/deploy-via-bastion.sh
```

The default app VM shape is:

```hcl
instance_shape      = "VM.Standard.E4.Flex"
instance_ocpus      = 1
instance_memory_gbs = 8
```

The game runs through level 6. Levels 4-6 reuse the lava biome as overdrive levels with more waves, denser spawns, tougher enemies and harder boss patterns.

OCI Cache is enabled for the live player list:

```hcl
create_redis_cache       = true
redis_node_count         = 2
redis_node_memory_in_gbs = 2
redis_software_version   = "VALKEY_7_2"
redis_tls                = true
live_player_ttl_seconds  = 60
```

Autonomous Database is configured as the smallest paid ECPU setup for this demo:

```hcl
adb_user                        = "ADMIN"
adb_connect_string              = ""
adb_is_mtls_connection_required = false
adb_whitelisted_ips             = []
adb_compute_model        = "ECPU"
adb_compute_count        = 2
adb_data_storage_size_gb = 20
adb_is_free_tier         = false
```

Autonomous Database is the source of truth for permanent highscores and the ops Event Analytics panel. OCI Cache is only used for live player state and fast presenter metrics.

## OCI Generative AI

The copilot supports two modes:

- Native OCI SDK mode for Gemini and OCI model OCIDs.
- OpenAI-compatible bearer-token mode when `oci_genai_endpoint` points to `/chat/completions` or `/responses`.

The current Gemini path uses native SDK mode:

```hcl
oci_genai_endpoint = "https://inference.generativeai.eu-frankfurt-1.oci.oraclecloud.com"
oci_genai_model    = "ocid1.generativeaimodel.oc1.eu-frankfurt-1.amaaaaaask7dceyan6gecfjovk7wtgl3r65b5tmpuegfxojbp2mebjgtvhra"
```

Local tests use an OCI security-token profile:

```bash
oci session authenticate --region eu-stockholm-1
```

Then set the profile in your tfvars, for example:

```hcl
oci_auth                = "SecurityToken"
oci_config_file_profile = "demo"
```

On deployed VMs, the API uses instance principal auth through `dg_cengiz`. The required GenAI policy is:

```text
Allow dynamic-group OracleIdentityCloudService/dg_cengiz to use generative-ai-family in compartment id <genai_compartment_ocid>
```

`/api/copilot` is intentionally ops-only. The public player view does not call GenAI. If GenAI is unavailable, slow, or misconfigured, `/api/copilot` falls back to deterministic demo insights so the ops HUD still works.

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

## Event Analytics

The presenter view reads `/api/analytics/events`, which summarizes the `game_events` table in Autonomous Database:

- Events per minute over the last 1, 5 and 15 minutes.
- Counts for `enemy_killed`, `player_hit`, `powerup`, `boss_phase`, `run_end` and `heartbeat`.
- Live Players and Leaderboard include per-run event chips for kills, hits, powerups and boss phases.

When ADB is not configured locally, the same endpoint falls back to the in-memory event buffer so the UI remains testable.

## OCI Functions

`functions/event-ingest` is the deployed serverless ingest path when `function_image` points at an OCIR image. If `function_image = ""`, API Gateway keeps `/api/events` on the VM API fallback.

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
- Ops HUD lists active players from OCI Cache across both VM backends.
- Gameplay events appear in Streaming and Object Storage.
- Autonomous Database receives `game_events`.
- Ops HUD Event Analytics reads from Autonomous Database and falls back to memory locally.
- Ops HUD updates score, active VM, CPU, RAM, cores, disk throughput, latency, events/sec and copilot insight.
- `/api/copilot` returns `403` without the ops flag and `200` for ops callers.
- Ops copilot returns a Gemini insight when GenAI auth/policy is configured, otherwise a deterministic fallback.
- The game remains playable when one instance is removed from the pool or fails health checks.
