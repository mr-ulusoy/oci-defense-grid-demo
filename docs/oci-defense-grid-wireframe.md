# OCI Defense Grid Wireframe

This wireframe shows how the live demo is connected across the player view, ops view, VM runtime, API layer and OCI services.

## Runtime Flow

```mermaid
flowchart LR
  player["Player browser<br/>Game view"]
  ops["Presenter browser<br/>Ops HUD (?ops=1)"]

  webLb["OCI Load Balancer<br/>Public web entrypoint"]
  apiGw["OCI API Gateway<br/>/api/* routing, CORS, throttling"]
  fn["OCI Functions<br/>event-ingest for POST /api/events"]
  apiLb["OCI Load Balancer<br/>Private API backend set"]

  subgraph compute["OCI Compute"]
    pool["Instance Pool<br/>2 initial VMs, autoscale to 4"]
    vm1["VM-1<br/>Nginx static game<br/>Node/Express API"]
    vm2["VM-2<br/>Nginx static game<br/>Node/Express API"]
    autoscale["Autoscaling<br/>CPU policy"]
  end

  subgraph telemetry["Telemetry and Analytics"]
    cache["OCI Cache<br/>Live player snapshots"]
    stream["OCI Streaming<br/>Gameplay events"]
    bucket["Object Storage<br/>Raw NDJSON events"]
    adb["Autonomous Database<br/>game_events table"]
    oac["Oracle Analytics Cloud<br/>Demo dashboard dataset"]
  end

  subgraph ai["OCI Generative AI"]
    genai["Gemini via OCI GenAI SDK<br/>eu-frankfurt-1 inference endpoint"]
  end

  subgraph iam["Identity and Access"]
    dg["Manual dynamic group<br/>dg_cengiz: app VMs and Functions"]
    policy["Manual IAM policies<br/>Game-Demo and API Gateway invoke"]
  end

  player --> webLb --> pool
  ops --> webLb
  pool --> vm1
  pool --> vm2
  autoscale --> pool

  player -- "POST/GET /api/*" --> apiGw
  ops -- "status, analytics, copilot" --> apiGw
  apiGw -- "POST /api/events when function_image is set" --> fn
  apiGw -- "other /api routes and fallback /api/events" --> apiLb --> vm1
  apiLb --> vm2

  fn --> stream
  fn --> cache
  fn --> bucket
  fn --> adb
  vm1 --> stream
  vm2 --> stream
  vm1 --> cache
  vm2 --> cache
  cache --> ops
  vm1 --> bucket
  vm2 --> bucket
  vm1 -. "optional direct persistence" .-> adb
  vm2 -. "optional direct persistence" .-> adb
  adb --> oac
  stream -. "analytics pipeline / future function" .-> adb
  stream -. "raw archive pipeline" .-> bucket

  vm1 --> genai
  vm2 --> genai
  dg --> policy
  policy --> stream
  policy --> bucket
  policy --> genai
  policy --> fn
```

## Demo Views

```mermaid
flowchart TB
  publicUrl["Public game URL<br/>http://&lt;web-lb-ip&gt;/"]
  playerView["Player view<br/>Original shooter, callsign, leaderboard"]
  opsUrl["Presenter URL<br/>http://&lt;web-lb-ip&gt;/?ops=1"]
  opsHud["Ops HUD<br/>Active VM, CPU, RAM, cores, disk throughput,<br/>LB/API status, latency, events/sec, AI insight"]

  publicUrl --> playerView
  opsUrl --> playerView
  opsUrl --> opsHud
```

## Service Roles

| OCI service | Role in the demo |
| --- | --- |
| Compute Instance Pool | Runs the static Phaser game and the Node/Express API on multiple VMs. |
| Public Load Balancer | Front door for the game; demonstrates backend health and failover. |
| API Gateway | Enterprise API entrypoint for all `/api/*` browser calls. |
| Private Load Balancer | Routes API Gateway traffic to the VM-backed Express API. |
| Autoscaling | Shows how the VM pool can scale from 2 to 4 instances under CPU pressure. |
| OCI Cache | Keeps live player snapshots shared across all active VM API backends. |
| Streaming | Receives gameplay telemetry events for downstream processing. |
| Object Storage | Stores raw event archives as NDJSON for replay, audit and later analytics. |
| Autonomous Database | Stores curated `game_events` rows for dashboarding and SQL analytics. |
| Oracle Analytics Cloud | Optional dashboard layer on top of ADB. |
| Generative AI | Gemini copilot insight in the ops HUD via OCI GenAI SDK. |
| IAM Dynamic Group and Policies | Manually managed prerequisites. `dg_cengiz` matches app VMs and Functions; `Game-Demo` grants Streaming/Object Storage/GenAI; `oci-defense-grid-apigw-functions` lets API Gateway invoke Functions. |
| OCI Functions | Optional event-ingest backend for `POST /api/events`, used when `function_image` points to an OCIR image. |

## Current GenAI Path

The current Gemini integration uses the native OCI SDK, not the OpenAI-compatible REST path:

```text
Ops browser (?ops=1)
  -> API Gateway /api/copilot
  -> Node/Express
  -> oci-generativeaiinference SDK
  -> https://inference.generativeai.eu-frankfurt-1.oci.oraclecloud.com
  -> Gemini on-demand model OCID
```

The public player view does not call GenAI. Local development uses an OCI security-token profile. Deployed VMs should use instance principal auth through `dg_cengiz` and `Game-Demo`.
