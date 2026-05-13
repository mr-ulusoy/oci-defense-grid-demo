<img width="484" height="745" alt="image" src="https://github.com/user-attachments/assets/634f786e-6ec2-4137-911f-7965187b02c3" /><img width="236" height="742" alt="image" src="https://github.com/user-attachments/assets/ddf8907d-fcda-4ce2-b309-6843cdc7c2b5" />


# OCI Defense Grid Demo

OCI Defense Grid is a V1 customer-demo remix of a Phaser space shooter. The player defends an Oracle Cloud region while the demo shows live cloud telemetry: Compute VMs, Load Balancer, API Gateway, OCI Cache, Streaming, Autonomous Database, Object Storage, Oracle Analytics Cloud and an OCI Generative AI copilot.

The game can run locally with offline fallbacks, then be deployed to OCI with Terraform.

## Demo Views

- Player view: `http://localhost:5173/` locally, or `http://<web-lb-ip>/` on OCI.
- Presenter/ops view: add `?ops=1`, for example `http://<web-lb-ip>/?ops=1`.

Current demo endpoints:

- Player URL: `http://207.127.95.12/`
- Presenter/ops URL: `http://207.127.95.12/?ops=1`

The player view keeps the game clean for public visitors. The ops view adds the Cloud Ops HUD with active VM, CPU, RAM, cores, disk throughput, LB/API status, latency, events/sec and AI insight.

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
| Object Storage | Archives raw events as NDJSON for replay, audit and later pipelines. |
| Autonomous Database | Stores curated `game_events` rows for SQL analytics and dashboards. |
| Oracle Analytics Cloud | Optional dashboard layer on top of ADB. |
| OCI Generative AI | Gemini copilot insight in the ops HUD via the OCI SDK. |
| IAM Dynamic Group and Policies | Lets app VMs call Streaming, Object Storage and GenAI through instance principals. |
| OCI Functions | Optional serverless event-ingest path for `POST /api/events`, writing gameplay telemetry to Streaming, Object Storage, OCI Cache and ADB. |

## Runtime API

The API Gateway exposes these routes:

```http
POST /api/events
GET /api/status
GET /api/leaderboard
GET /api/players/live
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
2. Create `infra/terraform/demo.tfvars` from the sanitized example.
3. Fill in tenancy, compartment, region, SSH key, Ubuntu image OCID and `app_repo_url`.
4. Keep `instance_pool_min_size = 2`, `instance_pool_initial_size = 2`, `instance_pool_max_size = 4` for the default autoscaling demo.
5. Run:

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

By default `function_image = ""`, so Terraform keeps `/api/events` routed to the VM-backed API. To switch the route to OCI Functions:

1. Build and push the function image to OCIR.
2. Set `function_image` in `demo.tfvars` to the OCIR image path.
3. Enable the Function resource-principal dynamic group and policy, or have an admin create equivalent IAM.
4. Run `terraform plan` and `terraform apply`.

Example tfvars:

```hcl
function_image = "arn.ocir.io/<namespace>/oci-defense-grid/event-ingest:0.1.0"

create_function_resource_principal_dynamic_group = true
create_function_resource_principal_policy        = true
```

If your user cannot create IAM policies, leave the two Function IAM booleans as `false` and ask an admin to create:

```text
Dynamic group:
All {resource.type = 'fnfunc', resource.compartment.id = '<compartment_ocid>'}

Policies:
Allow dynamic-group <function-dynamic-group> to use stream-push in compartment id <compartment_ocid>
Allow dynamic-group <function-dynamic-group> to manage objects in compartment id <compartment_ocid> where target.bucket.name='<raw-events-bucket>'
```

The Function also uses `ADB_USER`, `ADB_PASSWORD`, `ADB_CONNECT_STRING`, `REDIS_HOST`, `REDIS_PORT` and `REDIS_TLS` from Terraform function config. Redis does not need IAM. ADB writes use the configured database credentials and the existing ADB network allow-list.

Build example:

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

Autonomous Database is the source of truth for permanent highscores. OCI Cache is only used for live player state and fast presenter metrics.

For instance-principal access to Streaming, Object Storage and GenAI, set:

```hcl
create_instance_principal_policy = true
```

This creates a dynamic group for instances in the compartment and grants publish/archive/GenAI permissions. If your tenancy only allows IAM changes in the home region, set `home_region` correctly. If your user cannot create IAM policies, have an administrator create the equivalent dynamic group and policy.

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

On deployed VMs, the API should use instance principal auth through the dynamic group. The required policy is equivalent to:

```text
Allow dynamic-group <dynamic-group-name> to use generative-ai-family in compartment id <compartment_ocid>
```

If GenAI is unavailable or misconfigured, `/api/copilot` falls back to deterministic demo insights so the game still runs.

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
- Ops HUD lists active players from OCI Cache across both VM backends.
- Gameplay events appear in Streaming and Object Storage.
- Autonomous Database receives `game_events`.
- Ops HUD updates score, active VM, CPU, RAM, cores, disk throughput, latency, events/sec and copilot insight.
- `/api/copilot` returns a Gemini insight when GenAI auth/policy is configured, otherwise a deterministic fallback.
- The game remains playable when one instance is removed from the pool or fails health checks.
