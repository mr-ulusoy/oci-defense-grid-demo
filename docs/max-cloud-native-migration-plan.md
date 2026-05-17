# Max Cloud-Native Migration Plan

This note is a decision document for moving OCI Defense Grid from the current VM-backed API model toward a more cloud-native architecture.

## Goal

Make the Compute VMs as clean as possible:

- VMs host only the static Phaser game through Nginx.
- API Gateway owns all `/api/*` entrypoints.
- OCI Functions run API/backend logic.
- OCI managed services provide live state, events, analytics, raw archive and AI.
- VM identity is still visible for the Load Balancer/failover demo.

Target architecture:

```text
Player browser
  -> Public Load Balancer
  -> VM Fleet / Nginx
  -> static game files

Player/Ops browser
  -> API Gateway
  -> OCI Functions
  -> OCI Cache / Streaming / Autonomous AI DB / Object Storage / OCI GenAI
```

## Current State

Today the demo is a hybrid:

```text
Browser
  -> API Gateway
  -> Private Load Balancer
  -> VM App / Node Express
  -> OCI Cache / Streaming / Autonomous AI DB / Object Storage / OCI GenAI
```

`POST /api/events` can use OCI Functions when `function_image` is configured, but most API logic still lives in the VM App.

This started in the VM App because it was the fastest way to build and debug the first working demo:

- VMs already existed for the game.
- Node/Express was easy to run and inspect.
- API Gateway could route to the VM backend quickly.
- We avoided early complexity around OCIR image builds, Functions config, IAM policies, dynamic groups and cold starts while gameplay, cache, ADB, GenAI and ops UI were still changing.

## Keep VM Status Without VM API

When the API moves away from the VM, keep frontend VM visibility with a generated static file:

```text
/vm-info.json
```

Example:

```json
{
  "vmName": "ocidefense-9591c7-3",
  "shape": "VM.Standard.E4.Flex",
  "ocpus": 1,
  "memoryGb": 8,
  "role": "static-game-node"
}
```

The player/ops browser can fetch this through the Public Load Balancer to show which VM served the static game. Fleet-wide status can later come from Functions reading OCI APIs, Cache or Terraform-generated config.

## Route Ownership Target

| Route | Current owner | Target owner | Notes |
| --- | --- | --- | --- |
| `POST /api/events` | Functions or VM fallback | OCI Functions | First route to move. Low player-visible latency risk. |
| `GET /api/leaderboard` | VM App | OCI Functions | Reads Autonomous AI DB and optionally Cache. |
| `GET /api/analytics/live` | VM App | OCI Functions | Reads Autonomous AI DB and Cache. |
| `GET /api/status` | VM App | OCI Functions | Aggregates route mode, Cache, ADB, VM fleet and service health. |
| `POST /api/coach` | VM App | OCI Functions, last | Player-visible latency path. Keep on VM until Function latency is proven. |
| `POST /api/copilot` | VM App | OCI Functions, last | Ops-only AI path, but should move with coach for consistency. |

## Proposed Phases

### Phase 0: Stabilize VM Identity

- Add `/vm-info.json` generation to VM cloud-init or deploy.
- Keep Node/Express running for now.
- Update ops UI to separate:
  - frontend VM identity from Public LB
  - API backend owner from API Gateway route

Diagram impact:

```text
Game load:
Browser -> Public LB -> VM Fleet / Nginx -> /vm-info.json

APIs:
Browser -> API Gateway -> Private LB -> VM App
```

Decision gate:

- Confirm `/vm-info.json` gives enough VM/LB demo value before removing VM status API.

### Phase 1: Move Event Ingest

Move gameplay telemetry first:

```text
POST /api/events
  -> API Gateway
  -> OCI Functions
  -> OCI Cache
  -> OCI Streaming
```

Keep these on VM App for now:

- `/api/status`
- `/api/leaderboard`
- `/api/analytics/live`
- `/api/coach`
- `/api/copilot`

Why first:

- Events are high-volume and fit serverless ingest well.
- Player experience is less sensitive than AI chat latency.
- It gives a clear cloud-native story without moving everything at once.

Technical checks:

- API Gateway invoke policy for Functions.
- Function dynamic group and policy for Cache/Streaming.
- Function config for stream OCID, Cache endpoint and region.
- Fallback behavior if Function is unavailable.

Diagram impact:

```text
Events:
Browser -> API Gateway -> Functions -> Cache + Streaming

AI/status still:
Browser -> API Gateway -> Private LB -> VM App
```

### Phase 2: Move Event Processing

Target event pipeline:

```text
OCI Functions ingest
  -> OCI Streaming
  -> processor/consumer
  -> Autonomous AI DB
  -> Object Storage
```

Processor options:

| Option | Cloud-native level | Pros | Cons |
| --- | --- | --- | --- |
| Streaming-triggered Function | Highest | Serverless end to end, no VM worker | Need to confirm OCI trigger/runtime behavior and batching fits demo. |
| Container Instance worker | High | Managed container, better long-running consumer fit | More infra than a Function. |
| Keep VM stream consumer temporarily | Medium | Lowest risk, already works | VM still owns part of backend. |

Recommendation:

- For max cloud-native, prefer a Function/managed processor if the OCI trigger model fits.
- If that becomes slow to implement, use Container Instance as the next-best managed option.

Diagram impact:

```text
Functions -> Streaming -> Autonomous AI DB + Object Storage
```

The ops diagram should hide the processor as a separate box so the customer sees the managed OCI service flow. The technical docs should still state that a background consumer/processor reads from Streaming and performs the ADB/Object Storage writes.

Decision gate:

- Choose processor type before deleting VM stream consumer.

### Phase 3: Move Read APIs

Move the non-AI APIs:

```text
GET /api/leaderboard
GET /api/analytics/live
GET /api/status
  -> API Gateway
  -> OCI Functions
  -> OCI Cache / Autonomous AI DB / OCI APIs
```

Why before AI:

- These routes are easier to cache.
- They do not affect player quiz typing latency as directly.
- They remove most backend responsibility from the VM App.

Technical checks:

- ADB driver and connection strategy in Functions image.
- Wallet/EZCONNECT decision.
- Secure Function config for ADB credentials.
- OCI SDK permissions if `/api/status` reads Compute/LB/APIGW state.
- Cache read path from Functions.

Diagram impact:

```text
Status/read APIs:
Browser -> API Gateway -> Functions -> Cache + Autonomous AI DB + OCI APIs
```

### Phase 4: Move AI Last

Move the latency-sensitive AI routes last:

```text
POST /api/coach
POST /api/copilot
  -> API Gateway
  -> OCI Functions
  -> OCI GenAI
```

Why last:

- OCI Guide now feels very fast.
- Functions can introduce cold-start latency.
- AI is the most visible player-facing wait.

Mitigations:

- Keep the Flash Lite coach model.
- Use a short timeout and deterministic fallback.
- Consider warm-up or provisioned/minimum concurrency if available.
- Keep the VM App AI route as a rollback path until demo latency is accepted.

Decision gate:

- Test first response after idle and repeated warm calls.
- Only move AI if user experience remains fast enough for the game.

## Technical Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Function cold starts | Coach/copilot can feel slower | Move AI last, use fast model, short timeout and fallback. |
| Function image build/deploy | More OCIR and CI/manual steps | Keep image private but document build/push, reuse same image per region. |
| Region-specific OCIR images | Colleagues deploying in other regions need local image | Add copy/build script per target region, document `function_image`. |
| IAM and dynamic groups | Missing policies break runtime calls | Keep manual IAM prerequisites explicit in README. |
| ADB connectivity from Functions | DB driver/wallet config can be tricky | Decide between wallet and TLS EZCONNECT before Phase 3. |
| Streaming processor choice | VM consumer may remain if not redesigned | Decide Function trigger vs Container Instance before Phase 2. |
| Ops diagram confusion | Hybrid phases can look messy | Diagram each phase honestly with temporary paths clearly labeled. |
| Terraform state drift | Manual OCI edits may not recreate cleanly | Keep manual prerequisites documented; keep generated runtime config in Terraform where possible. |

## Diagram Plan

The ops diagram should change with each phase.

Phase 0:

```text
Game load: Browser -> Public LB -> VM Fleet / Nginx
API: Browser -> API Gateway -> Private LB -> VM App
```

Phase 1:

```text
Events: Browser -> API Gateway -> Functions -> Cache + Streaming
AI/status: Browser -> API Gateway -> Private LB -> VM App
```

Phase 2:

```text
Events: Browser -> API Gateway -> Functions -> Streaming -> Processor -> ADB/Object
```

Phase 3:

```text
Read APIs: Browser -> API Gateway -> Functions -> Cache/ADB/OCI APIs
```

Phase 4:

```text
AI: Browser -> API Gateway -> Functions -> OCI GenAI
```

Final:

```text
Game:
Browser -> Public LB -> VM Fleet / Nginx

APIs:
Browser -> API Gateway -> Functions -> Cache / Streaming / ADB / Object Storage / GenAI
```

## Decision Needed

Before implementation, choose:

1. Do we accept Functions cold-start risk for the final AI path?
2. Should Streaming processing use a Function trigger, Container Instance, or temporary VM consumer?
3. Should ADB from Functions use wallet or TLS/EZCONNECT?
4. Do we keep Private Load Balancer only during migration, or remove it in the final architecture?
5. Do we want Terraform to create Functions/OCIR wiring fully, or keep image publishing as a manual prerequisite?

Recommended next implementation step:

```text
Phase 0 + Phase 1 only
```

That gives a cleaner cloud-native story immediately while preserving the fast coach/copilot experience until the end.
