<img width="1145" height="1093" alt="image" src="https://github.com/user-attachments/assets/eef54d6d-9c1e-40bf-9a25-fadb736e1551" />
<img width="1350" height="1078" alt="image" src="https://github.com/user-attachments/assets/e419ca7c-c26d-471c-b0bd-55820de7366d" />


# OCI Defense Grid Demo

OCI Defense Grid is a V1 customer-demo remix of a Phaser space shooter. The player defends an Oracle Cloud region while the demo shows live cloud telemetry: Compute VMs, Load Balancer, API Gateway, OCI Cache, Streaming, Autonomous Database, Object Storage and an OCI Generative AI copilot.

The game can run locally with offline fallbacks, then be deployed to OCI with Terraform.

## Demo Views

- Player view: `http://localhost:5173/` locally, or `http://<web-lb-ip>/` on OCI.
- Presenter/ops view: add `?ops=1`, for example `http://<web-lb-ip>/?ops=1`.

Current demo endpoints:

- Player URL: `http://207.127.95.12/`
- Presenter/ops URL: `http://207.127.95.12/?ops=1`

The player view keeps the game clean for public visitors. The ops view adds the Cloud Ops HUD with live architecture flow, active VM, CPU, RAM, cores, disk throughput, LB/API status, latency, events/sec, live players, leaderboard level, gameplay event chips and AI insight.
The live architecture panel shows a single animated traffic map: game load, APIs + AI, and events + data. It avoids implementation jargon and shows AI in both places it is used: player quiz coaching and the ops copilot.
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
        -> OCI Streaming durable event stream
           -> background consumer/processor, hidden in the ops diagram
              -> Autonomous Database game_events/high_scores
              -> Object Storage raw NDJSON archive
     -> GET /api/leaderboard, /api/players/live, /api/analytics/*
        -> OCI Functions read APIs, when function_image is configured
           -> OCI Cache live player state
           -> Autonomous Database leaderboard and analytics
     -> status, stress, coach and copilot routes
        -> private OCI Load Balancer
           -> Compute Instance Pool VM App
              -> OCI Generative AI ops copilot or deterministic fallback
```

OCI Cache is used for the live player roster in the presenter view. Every VM writes the latest player heartbeat/event into the same managed cache, so the ops HUD can list active players even while API Gateway and the private Load Balancer bounce between backend VMs.

The Compute layer uses an OCI instance pool with autoscaling. Defaults are two always-on
instances for HA, with CPU-based scale-out up to four instances for the live demo.

See the full wireframe in [docs/oci-defense-grid-wireframe.md](docs/oci-defense-grid-wireframe.md).

## OCI Services

| OCI service | How it is used |
| --- | --- |
| Compute Instance Pool | Runs the Phaser static game through Nginx, the Node/Express API on each VM, and currently the background Streaming consumer worker. |
| Public Load Balancer | Public entrypoint for the game and health-checked VM failover. |
| API Gateway | Fronts all `/api/*` calls for routing, CORS and enterprise API control. |
| Private Load Balancer | Routes API Gateway traffic to the VM-backed Express API. |
| Autoscaling | Scales the instance pool from 2 to 4 VMs based on CPU. |
| OCI Cache | Stores short-lived live player snapshots shared across Functions and app VMs. |
| Streaming | Durable backbone for gameplay telemetry events. The ops diagram shows Streaming delivering to data services; technically a background consumer/processor reads the stream. |
| Object Storage | Receives raw NDJSON event archives written by the Streaming consumer/processor. |
| Autonomous Database | Receives curated `game_events` rows from the Streaming consumer/processor for SQL analytics and the ops Event Analytics panel. |
| OCI Generative AI | GPT-OSS ops copilot insight and Flash-Lite player hints via the OCI SDK. |
| IAM Dynamic Group and Policies | Manually created prerequisites that let app VMs and Functions call Streaming, Object Storage and GenAI, and let API Gateway invoke Functions. |
| OCI Functions | Optional serverless cloud API path for `POST /api/events`, `GET /api/leaderboard`, `GET /api/players/live`, `GET /api/analytics/live` and `GET /api/analytics/events`. |

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
POST /api/coach
GET /api/ops/session
POST /api/ops/login
POST /api/ops/logout
```

`POST /api/copilot` is for the presenter/ops view only. The ops page requires an admin login and receives an HTTP-only session cookie before it can call presenter APIs. The default demo password is `OCI2026`; override it with `OPS_ADMIN_PASSWORD` and set `OPS_SESSION_SECRET` for a stable shared cookie secret across VM backends.
The player view uses the API Gateway endpoint from `config.js`. The presenter/ops view intentionally uses same-origin `/api` through the public Load Balancer/VM app so the HTTP-only admin session cookie stays first-party and works reliably in browsers.
`POST /api/stress` follows the same ops-only login pattern and starts short, bounded CPU load on VM API backends so autoscaling can be demonstrated without real player volume.
`POST /api/coach` is the player-facing OCI Guide helper used during level-unlock quizzes. It accepts a known `level/questionId`, a short player message and returns a guarded hint from OCI GenAI or deterministic fallback. It is rate-limited so public players cannot use it as a general-purpose GenAI proxy.

### API security controls

- GenAI credentials are server-side only. They are not written to `config.js` or bundled into the frontend.
- Presenter-only endpoints are `/api/copilot`, `/api/leaderboard/insights`, `/api/players/live`, `/api/analytics/live`, `/api/analytics/events`, `/api/stress` and `/api/admin/reset-demo`. They require the ops session cookie created by `/api/ops/login`.
- Leaderboard card AI copy is cached in VM memory per leaderboard signature, so it regenerates after API restarts or redeploys.
- GenAI routes have in-memory rate limits: `OPS_AI_RATE_LIMIT_PER_MINUTE` for ops AI, `COACH_AI_RATE_LIMIT_PER_MINUTE` for player quiz coaching and `OPS_CONTROL_RATE_LIMIT_PER_MINUTE` for stress controls.
- `/api/coach` only accepts known quiz `level/questionId` combinations and caps messages at 300 characters.

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

Valid gameplay event types are:

```text
enemy_killed
boss_phase
powerup
extra_life
player_hit
run_end
heartbeat
```

`level` is not a separate event type. It is a numeric field included on every telemetry event and is also stored with leaderboard rows as the level reached.

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

Terraform outputs `game_url` and `api_gateway_endpoint`. The VM cloud-init writes `config.js` so the player browser calls API Gateway rather than bypassing it. The ops dashboard overrides that at runtime and calls same-origin `/api` for session-protected presenter endpoints.

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
Allow dynamic-group OracleIdentityCloudService/dg_cengiz to use stream-pull in compartment id <compartment_ocid>
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

`functions/event-ingest` is the serverless cloud API function. It is designed to take event ingest and read-heavy data APIs off the VMs during demo spikes:

```text
Browser POST /api/events
  -> API Gateway
     -> OCI Function cloud API
        -> OCI Cache live player state
        -> OCI Streaming
           -> background consumer/processor, not shown as a separate ops diagram box
              -> Autonomous Database game_events/high_scores
              -> Object Storage raw NDJSON archive

Browser GET /api/leaderboard, /api/players/live, /api/analytics/*
  -> API Gateway
     -> OCI Function cloud API
        -> OCI Cache live player state
        -> Autonomous Database leaderboard and analytics
```

By default `function_image = ""`, so Terraform keeps `/api/events` and read APIs routed to the VM-backed API. To switch those routes to OCI Functions, point Terraform at an existing OCIR image and make sure the manual IAM prerequisites above are in place.

The Function source in this repo accepts the same telemetry event types as the VM API, including `extra_life`, and can also serve leaderboard, live player and analytics reads.

Current tested image in Stockholm:

```hcl
function_image = "ocir.eu-stockholm-1.oci.oraclecloud.com/fr9qm01oq44x/oci-defense-grid/event-ingest:0.1.2"
```

OCI Functions requires the image to be in the same region's OCIR as the Function. Keep one known-good source image, then publish it into the target demo region before running Terraform.

Recommended tfvars pattern:

```hcl
function_image = "ocir.<region>.oci.oraclecloud.com/<namespace>/oci-defense-grid/event-ingest:<tag>"
```

The Function uses `OCI_STREAM_OCID`, `OCI_STREAM_MESSAGE_ENDPOINT`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_TLS`, `ADB_USER`, `ADB_PASSWORD` and `ADB_CONNECT_STRING` from Terraform function config. Redis does not need IAM. ADB/Object Storage writes still happen in the background Streaming consumer/processor; the Function reads ADB for leaderboard and analytics.

Build example for a new source image:

```bash
cd functions/event-ingest
docker build -t fra.ocir.io/<namespace>/oci-defense-grid/event-ingest:0.1.1 .
docker push fra.ocir.io/<namespace>/oci-defense-grid/event-ingest:0.1.1
```

Publish the same image to the region where the demo is deployed:

```bash
OCIR_NAMESPACE=<namespace> \
OCIR_USERNAME='<namespace>/oracleidentitycloudservice/<user-email>' \
scripts/publish-function-image.sh eu-stockholm-1 0.1.1
```

The script uses `ocir.<region>.oci.oraclecloud.com`, which is OCI's recommended registry-domain format. For Stockholm, the output is:

```text
ocir.eu-stockholm-1.oci.oraclecloud.com/<namespace>/oci-defense-grid/event-ingest:0.1.1
```

## Updating Running VMs

This demo intentionally uses bastion-based updates instead of a GitHub workflow. After pushing changes to the repo, update the running app VMs through the bastion:

```bash
scripts/deploy-via-bastion.sh
```

The script defaults to the current demo hosts:

```bash
BASTION_HOST=82.70.59.158
VM_DNS_PATTERN="ocidefense-9591c7-%d.private.ocidefense.oraclevcn.com"
VM_DNS_SCAN_MAX=12
SSH_KEY=infra/terraform/.keys/oci-defense-grid-demo
DEPLOY_PATH=/opt/oci-defense-grid
DEPLOY_BRANCH=main
REDIS_HOST=<terraform redis_live_players_endpoint>
REDIS_PORT=6379
REDIS_TLS=true
EVENT_INGEST_ROUTE_MODE=oci-functions
OCI_GENAI_ENDPOINT=<GenAI inference endpoint>
OCI_GENAI_MODEL=openai.gpt-oss-120b
OCI_GENAI_COACH_MODEL=google.gemini-2.5-flash-lite
OCI_GENAI_COMPARTMENT_OCID=<compartment OCID>
OCI_GENAI_TIMEOUT_MS=25000
```

It SSHes through the bastion, discovers active private VM DNS names in the VCN, optionally writes the Redis/OCI Cache, event-ingest, GenAI and ADB environment drop-ins, removes the deprecated ops-token drop-in, pulls the latest `main`, installs production dependencies and restarts `oci-defense-api` and `nginx`. This avoids stale private IPs when autoscaling replaces instances.

Override any value as an environment variable if needed, for example:

```bash
VM_HOSTS="ocidefense-9591c7-3.private.ocidefense.oraclevcn.com ocidefense-9591c7-5.private.ocidefense.oraclevcn.com" scripts/deploy-via-bastion.sh
```

The default app VM shape is:

```hcl
instance_shape      = "VM.Standard.E4.Flex"
instance_ocpus      = 1
instance_memory_gbs = 8
```

The game now runs through 5 levels. Level 1 is space, level 2 is desert, level 3 is lava, level 4 is star-fighter overdrive, and level 5 is the new blue nebula final stage. Level 5 has been tuned down for a customer-demo finish: three waves, fewer heavy enemies and a calmer final boss.

Each level starts with an in-game OCI education briefing inside the game scene:

| Level | Briefing | What it teaches |
| --- | --- | --- |
| 1 | Regions and Fault Domains | The stack deploys into one selected OCI region through Terraform, with VCN public/private subnets and fault-domain-aware VM placement. |
| 2 | API Gateway and Load Balancer | The browser loads the game through the public Load Balancer, while `/api/*` calls go through API Gateway. |
| 3 | Compute VMs and Instance Pools | Flexible VM shapes, private app fleet, instance pools and autoscaling. |
| 4 | Functions, Cache and Streaming | Serverless event handling, OCI Cache live state and durable streaming telemetry. |
| 5 | ADB and Object Storage | Autonomous Database as source of truth and Object Storage as durable raw event archive. |

Each level now starts with its briefing. After the boss, the player answers one quiz question to unlock the next level. Wrong answers open OCI Guide for a short AI/fallback hint; correct answers show an explanation and a Continue button.

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

The current native SDK path uses GPT-OSS for ops analysis and Flash-Lite for player hints:

```hcl
oci_genai_endpoint = "https://inference.generativeai.eu-frankfurt-1.oci.oraclecloud.com"
oci_genai_model    = "openai.gpt-oss-120b"
oci_genai_coach_model = "google.gemini-2.5-flash-lite"
```

`oci_genai_model` is used for the ops copilot. `oci_genai_coach_model` is used for the player-facing OCI Guide during quiz hints, and defaults to Gemini 2.5 Flash-Lite for faster short answers.

Recommended model split:

- `/api/coach`: Gemini 2.5 Flash-Lite for fast player hints.
- `/api/copilot`: OpenAI GPT-OSS 120B for deeper ops analysis across leaderboard, live players, run events and ADB analytics, with Gemini 2.5 Flash-Lite as the fast timeout fallback.

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

`/api/copilot` is intentionally ops-only. The player view only reaches GenAI through the guarded `/api/coach` endpoint during quiz hints. If GenAI is unavailable, slow, or misconfigured, both copilot and coach fall back to deterministic demo text so the demo still works.

## Autonomous Database

Create tables with:

```bash
sql /nolog
```

Then connect to the Autonomous Database and run:

```sql
@server/schema.sql
```

Set these VM/API environment variables so the current Streaming consumer/processor can persist curated events and highscores to ADB:

```bash
ADB_USER=ADMIN
ADB_PASSWORD=...
ADB_CONNECT_STRING=...
```

## Event Analytics

The presenter view reads `/api/analytics/events`, which summarizes the `game_events` table in Autonomous Database:

- Events per minute over the last 1, 5 and 15 minutes.
- Counts for `enemy_killed`, `player_hit`, `powerup`, `extra_life`, `boss_phase`, `run_end` and `heartbeat`.
- Live Players and Leaderboard include per-run event chips for kills, hits, powerups, extra lives and boss phases.
- Leaderboard rows include the level reached, so presenters can distinguish a high score from deeper progression.

When ADB is not configured locally, the same endpoint falls back to the in-memory event buffer so the UI remains testable.

## OCI Functions

`functions/event-ingest` is the deployed serverless cloud API path when `function_image` points at an OCIR image. If `function_image = ""`, API Gateway keeps `/api/events`, leaderboard, live players and analytics on the VM API fallback.

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
- Leaderboard shows score, level reached and event chips including extra lives.
- Gameplay events appear in Streaming first, then a background consumer/processor writes Object Storage raw files.
- Autonomous Database receives `game_events` from the background consumer/processor.
- Ops HUD Event Analytics reads from Autonomous Database and falls back to memory locally.
- Ops HUD updates score, active VM, CPU, RAM, cores, disk throughput, latency, events/sec and copilot insight.
- `/api/copilot` returns `401` without the ops session cookie and `200` after ops login.
- Ops copilot returns an OCI GenAI insight when GenAI auth/policy is configured, otherwise a deterministic fallback.
- The game remains playable when one instance is removed from the pool or fails health checks.
