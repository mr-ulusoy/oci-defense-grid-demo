import { OciTelemetry } from "./telemetry.js";

const params = new URLSearchParams(window.location.search);
export const isOpsView = params.get("ops") === "1";

export const telemetry = new OciTelemetry(window.OCI_DEFENSE_CONFIG ?? {});

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
  cores: document.getElementById("hudCores"),
  cpu: document.getElementById("hudCpu"),
  ram: document.getElementById("hudRam"),
  disk: document.getElementById("hudDisk"),
  diskLabel: document.getElementById("hudDiskLabel"),
  insight: document.getElementById("hudInsight"),
  leaderboard: document.getElementById("leaderboardList"),
  askCopilot: document.getElementById("askCopilot"),
  refreshLeaderboard: document.getElementById("refreshLeaderboard")
};

function setConnection(offline) {
  if (!elements.connectionStatus) return;
  elements.connectionStatus.textContent = offline ? "Offline fallback" : "Live API";
  elements.connectionStatus.classList.toggle("offline", offline);
}

function renderStatus(status) {
  if (!isOpsView) return;

  elements.gateway.textContent = status.gateway ?? "public";
  elements.loadBalancer.textContent = status.loadBalancer ?? "healthy";
  elements.vm.textContent = status.vm?.name ?? "unknown";

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

export function updateHud(snapshot = {}) {
  if (!isOpsView) return;

  elements.score.textContent = String(snapshot.score ?? 0);
  elements.level.textContent = String(snapshot.level ?? 1);
  elements.latency.textContent = `${Math.round(telemetry.lastLatencyMs)} ms`;
  elements.events.textContent = telemetry.eventRate().toFixed(1);
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
      elements.events.textContent = (analytics.eventsPerSecond ?? telemetry.eventRate()).toFixed(1);
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
