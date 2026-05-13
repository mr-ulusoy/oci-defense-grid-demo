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
  livePlayers: document.getElementById("livePlayersList"),
  livePlayersStatus: document.getElementById("livePlayersStatus"),
  leaderboard: document.getElementById("leaderboardList"),
  askCopilot: document.getElementById("askCopilot"),
  refreshLeaderboard: document.getElementById("refreshLeaderboard")
};

const observedVms = new Map();
let activeVmKey = null;

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
  updateObservedVms(status.vm);
  renderVmFleet();

  const metrics = status.vm?.metrics;
  elements.cores.textContent = metrics?.cpuCores == null ? "--" : String(metrics.cpuCores);
  elements.cpu.textContent = metrics?.cpuPercent == null ? "--%" : `${metrics.cpuPercent}%`;
  elements.ram.textContent = metrics?.ramPercent == null ? "--%" : `${metrics.ramPercent}%`;

  const diskIo = metrics?.diskIo;
  elements.diskLabel.textContent = diskIo?.source === "process" ? "Disk I/O*" : "Disk I/O";
  elements.disk.textContent = diskIo
    ? `${formatThroughput(diskIo.readKbps)}/${formatThroughput(diskIo.writeKbps)}`
    : "--";
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
  header.innerHTML = "<span>Callsign</span><span>Score</span><span>Lvl</span><span>Latency</span><span>VM</span>";
  elements.livePlayers.appendChild(header);

  for (const player of activePlayers.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = "live-player-row";
    row.innerHTML = [
      `<strong>${escapeHtml(player.callsign)}</strong>`,
      `<span>${Number(player.score ?? 0)}</span>`,
      `<span>${Number(player.level ?? 1)}</span>`,
      `<span>${formatPercentlessLatency(player.latencyMs)}</span>`,
      `<span>${escapeHtml(player.vm ?? "unknown")}</span>`
    ].join("");
    elements.livePlayers.appendChild(row);
  }
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
  elements.vmCount.textContent = String(vms.length);
  elements.vmList.innerHTML = "";

  for (const vm of vms) {
    const item = document.createElement("li");
    item.className = vm.id === activeVmKey ? "is-active" : "";

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
    item.innerHTML = `<span>${entry.callsign}</span><strong>${entry.score}</strong>`;
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
  elements.insight.textContent = await telemetry.askCopilot(snapshot);
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
    renderLeaderboard(await telemetry.refreshLeaderboard());
    setConnection(telemetry.offline);

    elements.askCopilot.addEventListener("click", () => askCopilot({ score: 0, level: 1 }));
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
      const analytics = await telemetry.analytics();
      renderLivePlayers(await telemetry.refreshLivePlayers(), analytics);
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
