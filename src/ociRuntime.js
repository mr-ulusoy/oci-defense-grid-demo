import { OciTelemetry } from "./telemetry.js";

const params = new URLSearchParams(window.location.search);
export const isOpsView = params.get("ops") === "1";

export const telemetry = new OciTelemetry({
  ...(window.OCI_DEFENSE_CONFIG ?? {}),
  copilotEnabled: isOpsView
});

const appShell = document.getElementById("appShell");
const opsPanel = document.getElementById("opsPanel");

if (isOpsView) {
  appShell?.classList.add("ops-visible");
  opsPanel?.removeAttribute("hidden");
}

const elements = {
  connectionStatus: document.getElementById("connectionStatus"),
  score: document.getElementById("hudScore"),
  level: document.getElementById("hudLevel"),
  latency: document.getElementById("hudLatency"),
  events: document.getElementById("hudEvents"),
  gateway: document.getElementById("hudGateway"),
  loadBalancer: document.getElementById("hudLoadBalancer"),
  vm: document.getElementById("hudVm"),
  vmCount: document.getElementById("hudVmCount"),
  vmList: document.getElementById("hudVmList"),
  cores: document.getElementById("hudCores"),
  cpu: document.getElementById("hudCpu"),
  ram: document.getElementById("hudRam"),
  disk: document.getElementById("hudDisk"),
  diskLabel: document.getElementById("hudDiskLabel"),
  insight: document.getElementById("hudInsight"),
  stressStatus: document.getElementById("stressStatus"),
  scaleState: document.getElementById("scaleState"),
  livePlayers: document.getElementById("livePlayersList"),
  livePlayersStatus: document.getElementById("livePlayersStatus"),
  eventAnalyticsStatus: document.getElementById("eventAnalyticsStatus"),
  eventRate1m: document.getElementById("eventRate1m"),
  eventRate5m: document.getElementById("eventRate5m"),
  eventRate15m: document.getElementById("eventRate15m"),
  leaderboard: document.getElementById("leaderboardList"),
  askCopilot: document.getElementById("askCopilot"),
  startStress: document.getElementById("startStress"),
  stopStress: document.getElementById("stopStress"),
  refreshLeaderboard: document.getElementById("refreshLeaderboard")
};

const architecture = {
  map: document.getElementById("architectureMap"),
  routeMode: document.getElementById("archRouteMode"),
  eventRate: document.getElementById("archEventRate"),
  publicLbState: document.getElementById("archPublicLbState"),
  vmState: document.getElementById("archVmState"),
  apiState: document.getElementById("archApiState"),
  functionState: document.getElementById("archFunctionState"),
  vmAppState: document.getElementById("archVmAppState"),
  privateLbState: document.getElementById("archPrivateLbState"),
  cacheState: document.getElementById("archCacheState"),
  streamState: document.getElementById("archStreamState"),
  consumerState: document.getElementById("archConsumerState"),
  adbState: document.getElementById("archAdbState"),
  objectState: document.getElementById("archObjectState"),
  genaiState: document.getElementById("archGenaiState"),
  nodes: {
    player: document.getElementById("archPlayer"),
    publicLb: document.getElementById("archPublicLb"),
    vmFleet: document.getElementById("archVmFleet"),
    apiGateway: document.getElementById("archApiGateway"),
    functions: document.getElementById("archFunctions"),
    vmApp: document.getElementById("archVmApp"),
    privateLb: document.getElementById("archPrivateLb"),
    cache: document.getElementById("archCache"),
    streaming: document.getElementById("archStreaming"),
    consumer: document.getElementById("archConsumer"),
    adb: document.getElementById("archAdb"),
    objectStorage: document.getElementById("archObjectStorage"),
    genai: document.getElementById("archGenai")
  }
};

const SCORE_EVENT_TYPES = [
  { key: "enemy_killed", label: "Kills" },
  { key: "player_hit", label: "Hits" },
  { key: "powerup", label: "Power up" },
  { key: "extra_life", label: "Extra life" },
  { key: "boss_phase", label: "Boss" }
];

const observedVms = new Map();
let activeVmKey = null;
let scaleIntent = null;

const VM_RECENT_MS = 30000;
const minAppNodes = Number(window.OCI_DEFENSE_CONFIG?.minAppNodes ?? 2);

function setConnection(offline) {
  if (!elements.connectionStatus) return;
  elements.connectionStatus.textContent = offline ? "Offline fallback" : "Live API";
  elements.connectionStatus.classList.toggle("offline", offline);
}

function renderStatus(status) {
  if (!isOpsView) return;

  elements.gateway.textContent = status.gateway ?? "public";
  elements.loadBalancer.textContent = status.loadBalancer ?? "healthy";
  elements.livePlayersStatus.textContent = status.sinks?.redisLivePlayers ?? "memory";
  renderStress(status.stress);
  updateObservedVms(status.vm);
  renderVmFleet();
  renderScaleState(status.stress);

  const metrics = status.vm?.metrics;
  elements.cores.textContent = metrics?.cpuCores == null ? "--" : String(metrics.cpuCores);
  elements.cpu.textContent = metrics?.cpuPercent == null ? "--%" : `${metrics.cpuPercent}%`;
  elements.ram.textContent = metrics?.ramPercent == null ? "--%" : `${metrics.ramPercent}%`;

  const diskIo = metrics?.diskIo;
  elements.diskLabel.textContent = diskIo?.source === "process" ? "Disk I/O*" : "Disk I/O";
  elements.disk.textContent = diskIo
    ? `${formatThroughput(diskIo.readKbps)}/${formatThroughput(diskIo.writeKbps)}`
    : "--";
  renderArchitecture(status);
}

function renderStress(stress = {}) {
  if (!elements.stressStatus) return;

  if (stress.active) {
    elements.stressStatus.textContent = `${stress.workers ?? "--"} workers, ${stress.remainingSeconds ?? "--"}s left`;
    return;
  }

  elements.stressStatus.textContent = scaleIntent === "down" ? "Load released" : "Idle";
}

function renderScaleState(stress = {}) {
  if (!elements.scaleState) return;

  const recentNodes = recentVmCount();
  if (stress.active) {
    scaleIntent = "up";
    elements.scaleState.textContent =
      recentNodes > minAppNodes ? `Scaling up: ${recentNodes} nodes observed` : "Scaling up signal";
    return;
  }

  if (scaleIntent === "down" || recentNodes > minAppNodes) {
    if (recentNodes > minAppNodes) {
      elements.scaleState.textContent = `Scaling down: waiting for ${minAppNodes} nodes`;
      return;
    }
    scaleIntent = null;
  }

  elements.scaleState.textContent = "Stable";
}

function renderLivePlayers(players = [], analytics = {}) {
  if (!isOpsView) return;

  const activePlayers = players.filter((player) => player.callsign !== "UNKNOWN");
  const topScore = activePlayers.reduce((max, player) => Math.max(max, Number(player.score ?? 0)), 0);
  const latencySamples = activePlayers
    .map((player) => Number(player.latencyMs ?? 0))
    .filter((latency) => latency > 0);
  const avgLatency = latencySamples.length
    ? Math.round(latencySamples.reduce((sum, latency) => sum + latency, 0) / latencySamples.length)
    : null;
  const eventRate =
    activePlayers.reduce((sum, player) => sum + Number(player.eventsPerSecond ?? 0), 0) ||
    analytics.eventsPerSecond ||
    telemetry.eventRate();

  elements.score.textContent = String(activePlayers.length);
  elements.level.textContent = String(topScore);
  elements.latency.textContent = avgLatency == null ? "-- ms" : `${avgLatency} ms`;
  elements.events.textContent = Number(eventRate).toFixed(1);

  elements.livePlayers.innerHTML = "";
  if (activePlayers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "live-player-empty";
    empty.textContent = "Waiting for player telemetry.";
    elements.livePlayers.appendChild(empty);
    return;
  }

  const header = document.createElement("div");
  header.className = "live-player-row live-player-head";
  header.innerHTML = "<span>Callsign</span><span>Score</span><span>Lvl</span><span>Latency</span><span>Events</span><span>VM</span>";
  elements.livePlayers.appendChild(header);

  for (const player of activePlayers.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = "live-player-row";
    row.innerHTML = [
      `<strong>${escapeHtml(player.callsign)}</strong>`,
      `<span>${Number(player.score ?? 0)}</span>`,
      `<span>${Number(player.level ?? 1)}</span>`,
      `<span>${formatPercentlessLatency(player.latencyMs)}</span>`,
      `<span class="event-chip-set">${eventChipsHtml(player.eventCounts)}</span>`,
      `<span>${escapeHtml(player.vm ?? "unknown")}</span>`
    ].join("");
    elements.livePlayers.appendChild(row);
  }
}

function renderEventAnalytics(analytics = {}) {
  if (!isOpsView) return;

  const sourceLabel = {
    autonomousDatabase: "ADB game_events",
    memory: "Memory fallback",
    browser: "Browser fallback"
  };
  elements.eventAnalyticsStatus.textContent = sourceLabel[analytics.source] ?? "ADB game_events";
  elements.eventRate1m.textContent = formatEventsPerMinute(analytics.windows?.last1m, 1);
  elements.eventRate5m.textContent = formatEventsPerMinute(analytics.windows?.last5m, 5);
  elements.eventRate15m.textContent = formatEventsPerMinute(analytics.windows?.last15m, 15);
  renderArchitecture(telemetry.status, analytics);
}

function renderArchitecture(status = {}, eventAnalytics = {}) {
  if (!isOpsView || !architecture.map) return;

  const routeMode = status?.eventIngestRouteMode ?? window.OCI_DEFENSE_CONFIG?.eventIngestRouteMode ?? "vm-api";
  const functionMode = routeMode === "oci-functions";
  const eventRate = telemetry.eventRate();
  const recentNodes = recentVmCount();
  const cacheStatus = status?.sinks?.redisLivePlayers ?? "memory";
  const streamStatus = status?.sinks?.streaming ?? "memory";
  const consumerStatus = status?.streamConsumer?.status ?? "disabled";
  const objectStatus = status?.sinks?.objectStorage ?? "memory";
  const adbStatus = eventAnalytics?.source === "autonomousDatabase" ? "ADB live" : (status?.sinks?.autonomousDatabase ?? "memory");
  const flowSpeed = eventRate >= 4 ? "0.55s" : eventRate >= 2 ? "0.78s" : eventRate > 0.05 ? "1.25s" : "2.4s";

  architecture.map.classList.toggle("mode-functions", functionMode);
  architecture.map.classList.toggle("mode-vm", !functionMode);
  architecture.map.classList.toggle("flow-fast", eventRate >= 2);
  architecture.map.classList.toggle("flow-idle", eventRate <= 0.05);
  architecture.map.style.setProperty("--arch-flow-speed", flowSpeed);

  architecture.routeMode.textContent = functionMode ? "Functions ingest" : "VM API fallback";
  architecture.eventRate.textContent = `${Number(eventRate).toFixed(1)} events/sec`;
  architecture.publicLbState.textContent = status?.loadBalancer ?? "Frontend route";
  architecture.vmState.textContent = `${recentNodes || 1} nodes observed`;
  architecture.apiState.textContent = status?.gateway ?? "/api/* routing";
  architecture.functionState.textContent = functionMode ? "Cache + stream" : "Standby";
  architecture.vmAppState.textContent = activeVmKey ? `Active ${observedVms.get(activeVmKey)?.name ?? "VM"}` : "Node/Express APIs";
  architecture.privateLbState.textContent = "VM App route";
  architecture.cacheState.textContent = cacheStatus === "connected" ? "Live player state" : cacheStatus;
  architecture.streamState.textContent = serviceConfigured(streamStatus) ? "Durable event stream" : streamStatus;
  architecture.consumerState.textContent = consumerStatus === "running" ? "Writes ADB/Object" : consumerStatus;
  architecture.adbState.textContent = serviceConfigured(adbStatus) ? "Leaderboard + analytics" : adbStatus;
  architecture.objectState.textContent = serviceConfigured(objectStatus) ? "Raw event files" : objectStatus;
  architecture.genaiState.textContent = "Player Coach + Ops Copilot";

  setNodeLive(architecture.nodes.player, true);
  setNodeLive(architecture.nodes.publicLb, !telemetry.offline);
  setNodeLive(architecture.nodes.vmFleet, recentNodes > 0);
  setNodeLive(architecture.nodes.apiGateway, !telemetry.offline);
  setNodeLive(architecture.nodes.functions, functionMode);
  setNodeLive(architecture.nodes.vmApp, recentNodes > 0);
  setNodeLive(architecture.nodes.privateLb, true);
  setNodeLive(architecture.nodes.cache, cacheStatus === "connected");
  setNodeLive(architecture.nodes.streaming, serviceConfigured(streamStatus) || eventRate > 0);
  setNodeLive(architecture.nodes.consumer, consumerStatus === "running");
  setNodeLive(architecture.nodes.adb, serviceConfigured(adbStatus));
  setNodeLive(architecture.nodes.objectStorage, serviceConfigured(objectStatus));
  setNodeLive(architecture.nodes.genai, true);
}

function setNodeLive(node, live) {
  node?.classList.toggle("is-live", Boolean(live));
}

function serviceConfigured(status) {
  const normalized = String(status ?? "").toLowerCase();
  return normalized !== "" && normalized !== "memory" && normalized !== "browser fallback";
}

function eventChipsHtml(eventCounts = {}) {
  return SCORE_EVENT_TYPES.map(
    (eventType) =>
      `<span class="event-chip"><span>${eventType.label}</span><strong>${Number(eventCounts[eventType.key] ?? 0)}</strong></span>`
  ).join("");
}

function formatEventsPerMinute(count, minutes) {
  const rate = Number(count ?? 0) / minutes;
  return rate >= 10 ? String(Math.round(rate)) : rate.toFixed(1);
}

function formatPercentlessLatency(value) {
  const latency = Number(value ?? 0);
  return latency > 0 ? `${Math.round(latency)} ms` : "--";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[char];
  });
}

function updateObservedVms(vm) {
  const name = vm?.name ?? "unknown";
  const key = vm?.id && vm.id !== "local-instance" ? vm.id : name;
  activeVmKey = key;

  const previous = observedVms.get(key);
  observedVms.set(key, {
    id: key,
    name,
    availabilityDomain: vm?.availabilityDomain ?? previous?.availabilityDomain ?? "--",
    region: vm?.region ?? previous?.region ?? "--",
    metrics: vm?.metrics ?? previous?.metrics ?? {},
    firstSeen: previous?.firstSeen ?? Date.now(),
    lastSeen: Date.now()
  });
}

function renderVmFleet() {
  const vms = [...observedVms.values()].sort((left, right) => {
    if (left.id === activeVmKey) return -1;
    if (right.id === activeVmKey) return 1;
    return left.name.localeCompare(right.name);
  });

  const activeVm = vms.find((vm) => vm.id === activeVmKey);
  elements.vm.textContent = activeVm ? `Active: ${activeVm.name}` : "Active: unknown";
  elements.vmCount.textContent = String(recentVmCount());
  elements.vmList.innerHTML = "";

  for (const vm of vms) {
    const stale = Date.now() - vm.lastSeen > VM_RECENT_MS;
    const item = document.createElement("li");
    item.className = vm.id === activeVmKey ? "is-active" : "";
    item.classList.toggle("is-stale", stale);

    const header = document.createElement("div");
    header.className = "vm-list-header";

    const name = document.createElement("strong");
    name.textContent = vm.name;

    const status = document.createElement("span");
    status.textContent = vm.id === activeVmKey ? "routing now" : `${secondsSince(vm.lastSeen)}s ago`;

    header.append(name, status);

    const metrics = document.createElement("div");
    metrics.className = "vm-list-metrics";
    metrics.textContent = [
      `CPU ${formatPercent(vm.metrics?.cpuPercent)}`,
      `RAM ${formatPercent(vm.metrics?.ramPercent)}`,
      `${vm.metrics?.cpuCores ?? "--"} cores`,
      `I/O ${formatDiskIo(vm.metrics?.diskIo)}`
    ].join(" | ");

    item.append(header, metrics);
    elements.vmList.appendChild(item);
  }
}

function recentVmCount() {
  const cutoff = Date.now() - VM_RECENT_MS;
  return [...observedVms.values()].filter((vm) => vm.lastSeen >= cutoff).length;
}

function secondsSince(timestamp) {
  return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
}

function formatPercent(value) {
  return value == null ? "--%" : `${value}%`;
}

function formatDiskIo(diskIo) {
  if (!diskIo) {
    return "--";
  }

  return `${formatThroughput(diskIo.readKbps)}/${formatThroughput(diskIo.writeKbps)}`;
}

function formatThroughput(kbps) {
  if (kbps == null) {
    return "--";
  }
  if (kbps >= 1024) {
    return `${(kbps / 1024).toFixed(1)} MB/s`;
  }
  return `${kbps} KB/s`;
}

function renderLeaderboard(entries) {
  if (!isOpsView) return;

  elements.leaderboard.innerHTML = "";
  for (const entry of entries.slice(0, 5)) {
    const item = document.createElement("li");
    item.innerHTML = [
      `<span class="leaderboard-name">${escapeHtml(entry.callsign)}</span>`,
      `<span class="leaderboard-level">Lvl ${Number(entry.level ?? 1)}</span>`,
      `<span class="event-chip-set">${eventChipsHtml(entry.eventCounts)}</span>`,
      `<strong>${Number(entry.score ?? 0)}</strong>`
    ].join("");
    elements.leaderboard.appendChild(item);
  }
}

export function updateHud() {
  if (!isOpsView) return;

  setConnection(telemetry.offline);
}

export async function askCopilot(snapshot = {}) {
  if (!isOpsView) return;

  elements.insight.textContent = "Analyzing live telemetry...";
  architecture.nodes.genai?.classList.add("is-busy");
  try {
    elements.insight.textContent = await telemetry.askCopilot(snapshot);
  } finally {
    architecture.nodes.genai?.classList.remove("is-busy");
  }
}

export async function askCoach(context = {}) {
  return telemetry.askCoach(context);
}

export async function startStress() {
  if (!isOpsView) return;

  scaleIntent = "up";
  elements.startStress.disabled = true;
  elements.stressStatus.textContent = "Starting stress...";
  if (elements.scaleState) {
    elements.scaleState.textContent = "Scaling up signal";
  }
  try {
    const result = await telemetry.startStress();
    elements.stressStatus.textContent = `Started ${result.accepted}/${result.requested} routes`;
  } catch {
    elements.stressStatus.textContent = "Stress request failed";
  } finally {
    setTimeout(() => {
      elements.startStress.disabled = false;
    }, 5000);
  }
}

export async function stopStress() {
  if (!isOpsView) return;

  scaleIntent = "down";
  elements.stopStress.disabled = true;
  elements.stressStatus.textContent = "Releasing load...";
  if (elements.scaleState) {
    elements.scaleState.textContent = "Scaling down requested";
  }
  try {
    const result = await telemetry.stopStress();
    elements.stressStatus.textContent = `Released ${result.accepted}/${result.requested} routes`;
  } catch {
    elements.stressStatus.textContent = "Scale-down request failed";
  } finally {
    setTimeout(() => {
      elements.stopStress.disabled = false;
    }, 5000);
  }
}

export async function emitGameEvent(type, snapshot = {}) {
  await telemetry.emit(type, snapshot);
  updateHud(snapshot);
}

export async function initOciRuntime() {
  await telemetry.init();
  if (isOpsView) {
    renderStatus(telemetry.status);
    renderLivePlayers(await telemetry.refreshLivePlayers());
    renderEventAnalytics(await telemetry.eventAnalytics());
    renderLeaderboard(await telemetry.refreshLeaderboard());
    setConnection(telemetry.offline);

    elements.askCopilot.addEventListener("click", () => askCopilot({ score: 0, level: 1 }));
    if (elements.startStress && elements.startStress.dataset.stressBound !== "true") {
      elements.startStress.dataset.stressBound = "true";
      elements.startStress.addEventListener("click", () => startStress());
    }
    if (elements.stopStress && elements.stopStress.dataset.stressBound !== "true") {
      elements.stopStress.dataset.stressBound = "true";
      elements.stopStress.addEventListener("click", () => stopStress());
    }
    elements.refreshLeaderboard.addEventListener("click", async () => {
      renderLeaderboard(await telemetry.refreshLeaderboard());
    });
  } else {
    setConnection(telemetry.offline);
  }

  setInterval(async () => {
    await telemetry.flush();
    const status = await telemetry.refreshStatus();
    if (isOpsView) {
      renderStatus(status);
      const [analytics, livePlayers, eventAnalytics] = await Promise.all([
        telemetry.analytics(),
        telemetry.refreshLivePlayers(),
        telemetry.eventAnalytics()
      ]);
      renderLivePlayers(livePlayers, analytics);
      renderEventAnalytics(eventAnalytics);
    }
    setConnection(telemetry.offline);
  }, window.OCI_DEFENSE_CONFIG.telemetryIntervalMs);

  setInterval(() => {
    if (!isOpsView) return;

    askCopilot({
      score: Number(elements.score.textContent),
      level: Number(elements.level.textContent),
      eventsPerSecond: telemetry.eventRate()
    });
  }, window.OCI_DEFENSE_CONFIG.copilotIntervalMs);
}
