import { OciTelemetry } from "./telemetry.js?v=20260521-architecture-event-rate";

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
  opsPanel?.classList.add("is-locked");
}

const elements = {
  connectionStatus: document.getElementById("connectionStatus"),
  score: document.getElementById("hudScore"),
  level: document.getElementById("hudLevel"),
  latency: document.getElementById("hudLatency"),
  events: document.getElementById("hudEvents"),
  loadBalancer: document.getElementById("hudLoadBalancer"),
  vm: document.getElementById("hudVm"),
  vmCount: document.getElementById("hudVmCount"),
  vmList: document.getElementById("hudVmList"),
  cores: document.getElementById("hudCores"),
  cpu: document.getElementById("hudCpu"),
  ram: document.getElementById("hudRam"),
  ramTotal: document.getElementById("hudRamTotal"),
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
  copilotActions: document.querySelectorAll("[data-copilot-mode]"),
  copilotMeta: document.getElementById("copilotMeta"),
  startStress: document.getElementById("startStress"),
  stopStress: document.getElementById("stopStress"),
  resetDemoData: document.getElementById("resetDemoData"),
  resetDemoStatus: document.getElementById("resetDemoStatus"),
  opsLogin: document.getElementById("opsLogin"),
  opsLoginForm: document.getElementById("opsLoginForm"),
  opsPassword: document.getElementById("opsPassword"),
  opsLoginButton: document.getElementById("opsLoginButton"),
  opsLoginStatus: document.getElementById("opsLoginStatus"),
  refreshLeaderboard: document.getElementById("refreshLeaderboard"),
  gameQrCanvas: document.getElementById("gameQrCanvas"),
  gameQrLink: document.getElementById("gameQrLink")
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
const leaderboardCardInsights = new Map();
const leaderboardInsightRetryCounts = new Map();
const liveCopilotInsights = new Map();
let activeVmKey = null;
let scaleIntent = null;
let latestLeaderboardEntries = [];
let latestActivePlayers = [];
let latestLiveCopilotSignature = "";
let lastLivePlayerHeartbeatAt = 0;
let latestLivePlayerEventRate = 0;
let leaderboardInsightSignature = "";
let leaderboardRefreshInFlight = false;
let copilotInFlight = false;
let liveCopilotSignatureInFlight = "";

const VM_RECENT_MS = 30000;
const minAppNodes = Number(window.OCI_DEFENSE_CONFIG?.minAppNodes ?? 2);

function setConnection(offline) {
  if (!elements.connectionStatus) return;
  elements.connectionStatus.textContent = offline ? "Offline fallback" : "Live API";
  elements.connectionStatus.classList.toggle("offline", offline);
}

function unlockOpsPanel() {
  opsPanel?.classList.remove("is-locked");
  if (elements.opsLogin) {
    elements.opsLogin.hidden = true;
  }
}

function showOpsLogin(message = "Enter the demo ops password.") {
  opsPanel?.classList.add("is-locked");
  if (elements.opsLogin) {
    elements.opsLogin.hidden = false;
  }
  if (elements.opsLoginStatus) {
    elements.opsLoginStatus.textContent = message;
  }
  window.setTimeout(() => elements.opsPassword?.focus(), 0);
}

function bindOpsLogin() {
  if (!elements.opsLoginForm || elements.opsLoginForm.dataset.bound === "true") return;

  elements.opsLoginForm.dataset.bound = "true";
  elements.opsLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = elements.opsPassword?.value ?? "";
    if (!password) {
      showOpsLogin("Enter the demo ops password.");
      return;
    }

    if (elements.opsLoginButton) elements.opsLoginButton.disabled = true;
    if (elements.opsLoginStatus) elements.opsLoginStatus.textContent = "Checking password...";
    try {
      await telemetry.loginOps(password);
      if (elements.opsLoginStatus) elements.opsLoginStatus.textContent = "Access granted. Loading ops...";
      window.location.reload();
    } catch {
      if (elements.opsLoginStatus) elements.opsLoginStatus.textContent = "Wrong password.";
      if (elements.opsPassword) {
        elements.opsPassword.select();
      }
    } finally {
      if (elements.opsLoginButton) elements.opsLoginButton.disabled = false;
    }
  });
}

function resolvePublicGameUrl() {
  const configuredUrl =
    window.OCI_DEFENSE_CONFIG?.publicGameUrl ?? window.OCI_DEFENSE_CONFIG?.gameUrl ?? "";
  if (configuredUrl) {
    return new window.URL(configuredUrl, window.location.href).href;
  }

  const gameUrl = new window.URL(window.location.href);
  gameUrl.pathname = "/";
  gameUrl.search = "";
  gameUrl.hash = "";
  return gameUrl.href;
}

async function renderGameQrCode() {
  if (!isOpsView || !elements.gameQrCanvas) return;

  const gameUrl = resolvePublicGameUrl();
  if (elements.gameQrLink) {
    elements.gameQrLink.href = gameUrl;
    elements.gameQrLink.textContent = gameUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  try {
    const qrModule = await import("qrcode");
    const qrCode = qrModule.default ?? qrModule;
    await qrCode.toCanvas(elements.gameQrCanvas, gameUrl, {
      color: {
        dark: "#071017",
        light: "#f4fbf7"
      },
      errorCorrectionLevel: "M",
      margin: 2,
      width: 132
    });
  } catch (error) {
    console.warn("Unable to render game QR code.", error);
    elements.gameQrCanvas.hidden = true;
  }
}

async function ensureOpsAuthenticated() {
  if (!isOpsView) return true;

  bindOpsLogin();
  showOpsLogin("Checking ops session...");
  const authenticated = await telemetry.checkOpsSession();
  if (authenticated) {
    unlockOpsPanel();
    return true;
  }

  showOpsLogin("Enter the demo ops password.");
  return false;
}

function renderStatus(status) {
  if (!isOpsView) return;

  elements.loadBalancer.textContent = status.loadBalancer ?? "healthy";
  elements.livePlayersStatus.textContent = status.sinks?.redisLivePlayers ?? "memory";
  renderStress(status.stress);
  updateObservedVms(status.vm);
  renderVmFleet();
  renderScaleState(status.stress);
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

  const now = Date.now();
  const activePlayers = players.filter((player) => player.callsign !== "UNKNOWN");
  if (activePlayers.length > 0) {
    latestActivePlayers = activePlayers.slice(0, 12);
    lastLivePlayerHeartbeatAt = now;
  } else if (now - lastLivePlayerHeartbeatAt > 20000) {
    latestActivePlayers = [];
  }

  const visiblePlayers = activePlayers.length > 0 ? activePlayers : latestActivePlayers;
  const topScore = visiblePlayers.reduce((max, player) => Math.max(max, Number(player.score ?? 0)), 0);
  const latencySamples = visiblePlayers
    .map((player) => Number(player.latencyMs ?? 0))
    .filter((latency) => latency > 0);
  const avgLatency = latencySamples.length
    ? Math.round(latencySamples.reduce((sum, latency) => sum + latency, 0) / latencySamples.length)
    : null;
  const eventRate =
    visiblePlayers.reduce((sum, player) => sum + Number(player.eventsPerSecond ?? 0), 0) ||
    analytics.eventsPerSecond ||
    telemetry.eventRate();
  latestLivePlayerEventRate = Number(eventRate) || 0;

  elements.score.textContent = String(visiblePlayers.length);
  elements.level.textContent = String(topScore);
  elements.latency.textContent = avgLatency == null ? "-- ms" : `${avgLatency} ms`;
  elements.events.textContent = Number(eventRate).toFixed(1);

  elements.livePlayers.innerHTML = "";
  if (visiblePlayers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "live-player-empty";
    empty.textContent = "Waiting for player telemetry.";
    elements.livePlayers.appendChild(empty);
    if (activeCopilotMode() === "live" && !copilotInFlight) {
      showWaitingForLivePlayers();
    }
    return;
  }

  maybeRunLiveCopilot();

  const header = document.createElement("div");
  header.className = "live-player-row live-player-head";
  header.innerHTML = "<span>Callsign</span><span>Score</span><span>Lvl</span><span>Latency</span><span>Events</span><span>VM</span>";
  elements.livePlayers.appendChild(header);

  for (const player of visiblePlayers.slice(0, 12)) {
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
  const eventActivity = architectureEventActivity(eventAnalytics);
  const eventRate = eventActivity.rate;
  const recentNodes = recentVmCount();
  const cacheStatus = status?.sinks?.redisLivePlayers ?? "memory";
  const streamStatus = status?.sinks?.streaming ?? "memory";
  const objectStatus = status?.sinks?.objectStorage ?? "memory";
  const adbStatus = eventAnalytics?.source === "autonomousDatabase" ? "ADB live" : (status?.sinks?.autonomousDatabase ?? "memory");
  const flowSpeed = eventRate >= 4 ? "0.55s" : eventRate >= 2 ? "0.78s" : eventRate > 0.05 ? "1.25s" : "2.4s";

  architecture.map.classList.toggle("mode-functions", functionMode);
  architecture.map.classList.toggle("mode-vm", !functionMode);
  architecture.map.classList.toggle("flow-fast", eventRate >= 2);
  architecture.map.classList.toggle("flow-idle", eventActivity.lastMinuteEvents <= 0 && eventRate <= 0.05);
  architecture.map.style.setProperty("--arch-flow-speed", flowSpeed);

  architecture.routeMode.textContent = functionMode ? "Functions ingest + reads" : "VM API fallback";
  architecture.eventRate.textContent = formatArchitectureEventActivity(eventActivity);
  architecture.publicLbState.textContent = status?.loadBalancer ?? "Frontend route";
  architecture.vmState.textContent = `${recentNodes || 1} nodes observed`;
  architecture.apiState.textContent = status?.gateway ?? "/api/* routing";
  architecture.functionState.textContent = functionMode ? "Events + read APIs" : "Standby";
  architecture.vmAppState.textContent = activeVmKey ? `Active ${observedVms.get(activeVmKey)?.name ?? "VM"}` : "Node/Express APIs";
  architecture.privateLbState.textContent = status?.privateLoadBalancer ?? "Private API LB";
  architecture.cacheState.textContent = cacheStatus === "connected" ? "Live player state" : cacheStatus;
  architecture.streamState.textContent = serviceConfigured(streamStatus) ? "Durable event stream" : streamStatus;
  architecture.adbState.textContent = serviceConfigured(adbStatus) ? "Leaderboard + analytics" : adbStatus;
  architecture.objectState.textContent = serviceConfigured(objectStatus) ? "Raw event files" : objectStatus;
  architecture.genaiState.textContent = "Player Coach + Ops AI";

  setNodeLive(architecture.nodes.player, true);
  setNodeLive(architecture.nodes.publicLb, !telemetry.offline);
  setNodeLive(architecture.nodes.vmFleet, recentNodes > 0);
  setNodeLive(architecture.nodes.apiGateway, !telemetry.offline);
  setNodeLive(architecture.nodes.functions, functionMode);
  setNodeLive(architecture.nodes.vmApp, recentNodes > 0);
  setNodeLive(architecture.nodes.privateLb, true);
  setNodeLive(architecture.nodes.cache, cacheStatus === "connected");
  setNodeLive(architecture.nodes.streaming, serviceConfigured(streamStatus) || eventRate > 0);
  setNodeLive(architecture.nodes.adb, serviceConfigured(adbStatus));
  setNodeLive(architecture.nodes.objectStorage, serviceConfigured(objectStatus));
  setNodeLive(architecture.nodes.genai, true);
}

function architectureEventActivity(eventAnalytics = {}) {
  const lastMinuteEvents = Number(eventAnalytics?.windows?.last1m ?? 0);
  const analyticsRate = lastMinuteEvents > 0 ? lastMinuteEvents / 60 : 0;
  const liveRate = Number(latestLivePlayerEventRate ?? 0);
  const localRate = Number(telemetry.eventRate() ?? 0);

  return {
    lastMinuteEvents,
    rate: Math.max(liveRate, analyticsRate, localRate)
  };
}

function formatArchitectureEventActivity(activity) {
  if (activity.rate >= 0.1) {
    return `${activity.rate.toFixed(1)} events/sec`;
  }

  if (activity.lastMinuteEvents > 0) {
    return `${Math.round(activity.lastMinuteEvents)} events/min`;
  }

  return "0 events/min";
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

const numberFormatter = new Intl.NumberFormat("en-US");

function formatNumber(value) {
  return numberFormatter.format(Number(value ?? 0));
}

function playerInitials(callsign = "") {
  const clean = String(callsign || "Pilot")
    .replace(/[^a-z0-9 ]/gi, " ")
    .trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials = parts.length >= 2
    ? `${parts[0][0]}${parts[1][0]}`
    : clean.slice(0, 2);
  return initials.toUpperCase() || "P1";
}

function countEvent(entry = {}, key) {
  return Number(entry.eventCounts?.[key] ?? 0);
}

function leaderboardEntryKey(entry = {}, index = 0) {
  return String(
    entry.runId ||
    `${entry.callsign ?? "pilot"}-${Number(entry.score ?? 0)}-${Number(entry.level ?? 1)}-${index}`
  );
}

function leaderboardEntriesSignature(entries = []) {
  return entries
    .slice(0, 2)
    .map((entry, index) =>
      [
        leaderboardEntryKey(entry, index),
        Number(entry.score ?? 0),
        Number(entry.level ?? 1),
        countEvent(entry, "enemy_killed"),
        countEvent(entry, "player_hit"),
        countEvent(entry, "powerup"),
        countEvent(entry, "extra_life"),
        countEvent(entry, "boss_phase")
      ].join(":")
    )
    .join("|");
}

function playerArchetype(entry = {}) {
  const kills = countEvent(entry, "enemy_killed");
  const hits = countEvent(entry, "player_hit");
  const powerups = countEvent(entry, "powerup");
  const extraLives = countEvent(entry, "extra_life");

  if (hits === 0 && Number(entry.level ?? 1) >= 3) return "Tactical / Untouched";
  if (extraLives === 0 && hits <= 20) return "Clean / High Control";
  if (kills >= hits * 18 && kills > 0) return "Aggressive / High Efficiency";
  if (powerups >= 40) return "Resource Heavy / Resilient";
  return "Steady / Progression Focus";
}

function efficiencyPercent(entry = {}) {
  const kills = countEvent(entry, "enemy_killed");
  const hits = countEvent(entry, "player_hit");
  if (kills <= 0 && hits <= 0) return 0;
  if (hits <= 0) return 100;
  return Math.max(8, Math.min(100, Math.round((kills / (kills + hits * 2)) * 100)));
}

function fallbackReserveInsight(entry = {}, index = 0) {
  const extraLives = countEvent(entry, "extra_life");
  const hits = countEvent(entry, "player_hit");
  const kills = countEvent(entry, "enemy_killed");
  const level = Number(entry.level ?? 1);
  const livesLabel = extraLives === 1 ? "life" : "lives";
  const headline = `${formatNumber(kills)} kills, ${formatNumber(hits)} hits.`;
  const modelLabel = "Deterministic fallback";

  if (hits >= 40 && extraLives > 0) {
    return {
      title: "Recovery analysis",
      headline,
      detail: `The run produced strong offense, but ${formatNumber(hits)} hits show real pressure. Collected ${formatNumber(extraLives)} extra ${livesLabel}, which helped keep the run alive through damage spikes.`,
      tone: "risk",
      modelLabel
    };
  }

  if (extraLives > 0) {
    return {
      title: "Run analysis",
      headline,
      detail: `Collected ${formatNumber(extraLives)} extra ${livesLabel}, giving the pilot a strong recovery buffer. The next benchmark is keeping the same score pace with fewer rescue pickups needed.`,
      tone: "recovery",
      modelLabel
    };
  }

  if (hits <= 20 && level >= 3) {
    return {
      title: "Clean analysis",
      headline,
      detail: "Low damage and deep progress show strong control. The pilot can push the score ceiling by keeping that survival profile while taking more aggressive kill routes.",
      tone: "clean",
      modelLabel
    };
  }

  if (hits > 30) {
    return {
      title: "Risk analysis",
      headline,
      detail: "The run survived pressure, but high damage left little margin for mistakes. Without an extra-life buffer, one bad wave could quickly collapse the attempt.",
      tone: "risk",
      modelLabel
    };
  }

  return {
    title: index === 0 ? "Leader analysis" : "Contender analysis",
    headline,
    detail: "Score, level and damage pattern show steady control. The next improvement is turning that stability into more kills, powerups and cleaner boss phases.",
    tone: "controlled",
    modelLabel
  };
}

function normalizeInsightTone(value) {
  const tone = String(value ?? "").toLowerCase();
  return ["risk", "recovery", "aggressive"].includes(tone) ? "is-risk" : "is-clean";
}

function leaderboardInsightFor(entry = {}, index = 0) {
  const insight = leaderboardCardInsights.get(leaderboardEntryKey(entry, index));
  if (!insight) {
    return fallbackReserveInsight(entry, index);
  }

  return {
    ...fallbackReserveInsight(entry, index),
    ...insight
  };
}

function reserveStatusHtml(entry = {}, index = 0) {
  const insight = leaderboardInsightFor(entry, index);
  const source = String(insight.source ?? "");
  const sourceLabel = source.startsWith("oci-genai") || source === "pending"
    ? "AI model"
    : "Analysis";

  return `
    <div class="leaderboard-reserve ${normalizeInsightTone(insight.tone)}">
      <span>${escapeHtml(insight.title)}</span>
      <strong>${escapeHtml(insight.headline)}</strong>
      <em>${escapeHtml(insight.detail)}</em>
      <small>${sourceLabel}: ${escapeHtml(insight.modelLabel ?? "waiting")}</small>
    </div>
  `;
}

function pendingCardInsight(entry = {}, index = 0) {
  return {
    ...fallbackReserveInsight(entry, index),
    title: "AI analysis",
    headline: "Analyzing this run.",
    detail: "Waiting for the AI model to score risk, control and recovery.",
    tone: "controlled",
    source: "pending",
    modelLabel: "analyzing..."
  };
}

function topPlayerCardHtml(entry = {}, index = 0) {
  const rank = index + 1;
  const kills = countEvent(entry, "enemy_killed");
  const hits = countEvent(entry, "player_hit");
  const powerups = countEvent(entry, "powerup");
  const bossPhases = countEvent(entry, "boss_phase");
  const level = Number(entry.level ?? 1);
  const score = Number(entry.score ?? 0);
  const percent = efficiencyPercent(entry);
  const rankLabel = rank === 1 ? "#1 Leader" : "#2 Contender";

  return `
    <article class="leaderboard-card leaderboard-card-${rank}">
      <div class="leaderboard-card-head">
        <div class="leaderboard-avatar">${escapeHtml(playerInitials(entry.callsign))}</div>
        <div>
          <strong>${escapeHtml(entry.callsign ?? "Pilot")}</strong>
          <span>${escapeHtml(playerArchetype(entry))}</span>
        </div>
        <em>${rankLabel}</em>
      </div>
      <div class="leaderboard-card-stats">
        <div>
          <span>Score</span>
          <strong>${formatNumber(score)}</strong>
        </div>
        <div>
          <span>Level reached</span>
          <strong>Level ${level}</strong>
        </div>
      </div>
      <div class="leaderboard-efficiency">
        <div>
          <span>Kills vs Hits</span>
          <strong>${formatNumber(kills)} Kills / ${formatNumber(hits)} Hits</strong>
        </div>
        <i style="--efficiency:${percent}%"></i>
      </div>
      <div class="leaderboard-card-events">
        <div>
          <span>Power-ups</span>
          <strong>${formatNumber(powerups)} collected</strong>
        </div>
        <div>
          <span>Boss phases</span>
          <strong>${formatNumber(bossPhases)} survived</strong>
        </div>
      </div>
      ${reserveStatusHtml(entry, index)}
    </article>
  `;
}

function rankedPlayerRowHtml(entry = {}, index = 0) {
  const rank = index + 3;
  return `
    <div class="leaderboard-row">
      <span class="leaderboard-rank">#${rank}</span>
      <strong class="leaderboard-name">${escapeHtml(entry.callsign ?? "Pilot")}</strong>
      <span class="leaderboard-level">Lvl ${Number(entry.level ?? 1)}</span>
      <span class="event-chip-set">${eventChipsHtml(entry.eventCounts)}</span>
      <strong class="leaderboard-score">${formatNumber(entry.score)}</strong>
    </div>
  `;
}

function updateObservedVms(vm) {
  if (!vm || isSyntheticVm(vm)) {
    activeVmKey = null;
    return;
  }

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
  const recentVms = recentObservedVms();
  elements.vm.textContent = activeVm ? `Routing now: ${activeVm.name}` : "Routing now: status unavailable";
  elements.vmCount.textContent = String(recentVmCount());
  renderFleetSummary(recentVms);
  elements.vmList.innerHTML = "";

  for (const vm of vms) {
    const stale = Date.now() - vm.lastSeen > VM_RECENT_MS;
    const item = document.createElement("li");
    item.className = vm.id === activeVmKey ? "is-active" : "";
    item.classList.toggle("is-stale", stale);

    const header = document.createElement("div");
    header.className = "vm-list-header";

    const statusDot = document.createElement("span");
    statusDot.className = "vm-list-status-dot";
    statusDot.setAttribute("aria-hidden", "true");

    const name = document.createElement("strong");
    name.textContent = vm.name;

    header.append(statusDot, name);

    const age = document.createElement("span");
    age.className = "vm-list-age";
    age.textContent = vm.id === activeVmKey ? "Routing now" : `${formatAge(vm.lastSeen)} ago`;

    const instance = document.createElement("div");
    instance.append(header, age);

    const resources = document.createElement("div");
    resources.className = "vm-list-resources";
    resources.append(
      createResourceRow("CPU", vm.metrics?.cpuPercent),
      createResourceRow("RAM", vm.metrics?.ramPercent)
    );

    const disk = document.createElement("div");
    disk.className = "vm-disk-cell";
    const diskIo = formatDiskIoParts(vm.metrics?.diskIo);
    disk.innerHTML = `<span>${diskIo.read} <em>R</em></span><span>${diskIo.write} <em>W</em></span>`;

    item.append(instance, resources, disk);
    elements.vmList.appendChild(item);
  }
}

function renderFleetSummary(vms) {
  const metrics = vms.map((vm) => vm.metrics ?? {});
  const totalCores = sumMetric(metrics, "cpuCores");
  const avgCpu = averageMetric(metrics, "cpuPercent");
  const avgRam = averageMetric(metrics, "ramPercent");
  const totalRamGb = sumMetric(metrics, "ramTotalGb");
  const diskTotals = sumDiskIo(metrics);

  elements.cores.textContent = totalCores == null ? "--" : String(totalCores);
  elements.cpu.textContent = avgCpu == null ? "--%" : `${avgCpu}%`;
  elements.ram.textContent = avgRam == null ? "--%" : `${avgRam}%`;
  if (elements.ramTotal) {
    elements.ramTotal.textContent = totalRamGb == null ? "--" : String(totalRamGb);
  }
  elements.diskLabel.textContent = diskTotals?.source === "process" ? "Disk I/O*" : "Disk I/O";
  elements.disk.textContent = diskTotals
    ? `${formatThroughput(diskTotals.readKbps)} R / ${formatThroughput(diskTotals.writeKbps)} W`
    : "--";
}

function sumMetric(metrics, key) {
  const values = metrics.map((item) => Number(item?.[key])).filter(Number.isFinite);
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0));
}

function averageMetric(metrics, key) {
  const values = metrics.map((item) => Number(item?.[key])).filter(Number.isFinite);
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function sumDiskIo(metrics) {
  const diskEntries = metrics.map((item) => item?.diskIo).filter(Boolean);
  if (diskEntries.length === 0) return null;

  return {
    source: diskEntries.some((disk) => disk.source === "process") ? "process" : "host",
    readKbps: Math.round(
      diskEntries.reduce((sum, disk) => sum + (Number.isFinite(Number(disk.readKbps)) ? Number(disk.readKbps) : 0), 0)
    ),
    writeKbps: Math.round(
      diskEntries.reduce((sum, disk) => sum + (Number.isFinite(Number(disk.writeKbps)) ? Number(disk.writeKbps) : 0), 0)
    )
  };
}

function createResourceRow(label, value) {
  const row = document.createElement("div");
  row.className = "vm-resource-row";

  const labelElement = document.createElement("span");
  labelElement.textContent = label;

  const bar = document.createElement("div");
  bar.className = "vm-resource-bar";
  const fill = document.createElement("i");
  const percent = clampPercent(value);
  fill.style.width = value == null ? "0%" : `${percent}%`;
  bar.append(fill);

  const valueElement = document.createElement("strong");
  valueElement.textContent = formatPercent(value);

  row.append(labelElement, bar, valueElement);
  return row;
}

function recentVmCount() {
  return recentObservedVms().length;
}

function recentObservedVms() {
  const cutoff = Date.now() - VM_RECENT_MS;
  return [...observedVms.values()].filter((vm) => vm.lastSeen >= cutoff);
}

function isSyntheticVm(vm) {
  return vm?.name === "browser-demo" || vm?.gateway === "offline fallback";
}

function secondsSince(timestamp) {
  return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
}

function formatAge(timestamp) {
  const seconds = secondsSince(timestamp);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.round(seconds / 60)}m`;
}

function formatPercent(value) {
  return value == null ? "--%" : `${value}%`;
}

function clampPercent(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(value)));
}

function formatDiskIoParts(diskIo) {
  if (!diskIo) {
    return { read: "--", write: "--" };
  }
  return {
    read: formatThroughput(diskIo.readKbps),
    write: formatThroughput(diskIo.writeKbps)
  };
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
  const ranked = entries.slice(0, 8);
  latestLeaderboardEntries = ranked;

  if (ranked.length === 0) {
    elements.leaderboard.innerHTML = '<div class="leaderboard-empty">Waiting for completed runs.</div>';
    return;
  }

  const spotlight = ranked
    .slice(0, 2)
    .map((entry, index) => topPlayerCardHtml(entry, index))
    .join("");
  const rows = ranked
    .slice(2, 8)
    .map((entry, index) => rankedPlayerRowHtml(entry, index))
    .join("");

  elements.leaderboard.innerHTML = `
    <div class="leaderboard-spotlight">${spotlight}</div>
    ${rows ? `<div class="leaderboard-list">${rows}</div>` : ""}
  `;
}

function sameLeaderboardEntry(left = {}, right = {}) {
  const leftRunId = String(left.runId ?? "");
  const rightRunId = String(right.runId ?? "");
  if (leftRunId && rightRunId) {
    return leftRunId === rightRunId;
  }

  return (
    String(left.callsign ?? "").toUpperCase() === String(right.callsign ?? "").toUpperCase() &&
    Number(left.score ?? 0) === Number(right.score ?? 0) &&
    Number(left.level ?? 1) === Number(right.level ?? 1)
  );
}

function applyLeaderboardCardInsights(result = {}, expectedEntries = []) {
  if (!Array.isArray(result.cards) || result.cards.length === 0) {
    return false;
  }

  let applied = 0;
  result.cards.forEach((card, index) => {
    const expectedEntry = expectedEntries[index] ?? card;
    if (!sameLeaderboardEntry(card, expectedEntry)) {
      return;
    }

    leaderboardCardInsights.set(leaderboardEntryKey(expectedEntry, index), {
      ...card,
      source: result.source,
      model: result.model,
      modelLabel: result.modelLabel
    });
    applied += 1;
  });

  return applied > 0 && applied === Math.min(result.cards.length, expectedEntries.length || result.cards.length);
}

function isAiLeaderboardInsight(insight = {}) {
  return String(insight.source ?? "").startsWith("oci-genai");
}

function hasAiLeaderboardInsights(entries = []) {
  return entries.slice(0, 2).every((entry, index) => {
    const insight = leaderboardCardInsights.get(leaderboardEntryKey(entry, index));
    return isAiLeaderboardInsight(insight);
  });
}

async function refreshLeaderboardCardInsights(entries = [], { force = false } = {}) {
  if (!isOpsView || entries.length === 0) return;

  const signature = leaderboardEntriesSignature(entries);
  if (!signature) {
    return;
  }

  if (signature === leaderboardInsightSignature && hasAiLeaderboardInsights(entries)) {
    return;
  }

  if (!force && signature === leaderboardInsightSignature) {
    return;
  }

  entries.slice(0, 2).forEach((entry, index) => {
    const key = leaderboardEntryKey(entry, index);
    const existing = leaderboardCardInsights.get(key);
    if (!isAiLeaderboardInsight(existing)) {
      leaderboardCardInsights.set(key, pendingCardInsight(entry, index));
    }
  });
  renderLeaderboard(latestLeaderboardEntries);

  const result = await telemetry.refreshLeaderboardInsights();
  if (isAiLeaderboardInsight(result) && applyLeaderboardCardInsights(result, entries.slice(0, 2))) {
    leaderboardInsightSignature = signature;
    leaderboardInsightRetryCounts.delete(signature);
    renderLeaderboard(latestLeaderboardEntries);
    return;
  }

  const attempts = (leaderboardInsightRetryCounts.get(signature) ?? 0) + 1;
  leaderboardInsightRetryCounts.set(signature, attempts);
  if (attempts >= 3 && applyLeaderboardCardInsights(result, entries.slice(0, 2))) {
    renderLeaderboard(latestLeaderboardEntries);
  }

  window.setTimeout(() => {
    refreshLeaderboardCardInsights(latestLeaderboardEntries, { force: true });
  }, 5000);
}

async function refreshLeaderboardBoard({ forceInsights = false } = {}) {
  if (leaderboardRefreshInFlight) {
    return;
  }

  leaderboardRefreshInFlight = true;
  try {
    const entries = await telemetry.refreshLeaderboard();
    renderLeaderboard(entries);
    await refreshLeaderboardCardInsights(entries, { force: forceInsights });
  } finally {
    leaderboardRefreshInFlight = false;
  }
}

export function updateHud() {
  if (!isOpsView) return;

  setConnection(telemetry.offline);
}

function copilotModeLabel(mode = "live") {
  return {
    live: "Live insight",
    leaderboard: "Leaderboard analysis",
    players: "Player comparison",
    run: "Latest run analysis",
    demo_summary: "Demo summary"
  }[mode] ?? "AI analysis";
}

function shortModelName(model = "") {
  const value = String(model || "");
  if (!value) return "unknown model";
  if (value.includes("gpt-oss-120b")) return "OpenAI GPT-OSS 120B";
  if (value.includes("flash-lite")) return "Gemini Flash Lite";
  if (value.includes("gemini")) return value.replace(/^.*google\./, "Gemini ");
  if (value.startsWith("ocid1.generativeaimodel")) return `model ...${value.slice(-6)}`;
  return value;
}

function copilotSourceLabel(source = "unknown", model = "unknown model") {
  return {
    pending: "OCI GenAI running",
    waiting: model,
    "oci-genai": `OCI GenAI: ${model}`,
    "oci-genai-fast": `OCI GenAI: ${model} after primary timed out`,
    "oci-genai-fast-fallback": `OCI GenAI: ${model} after primary timed out`,
    fallback: "No AI: local fallback",
    "local-fallback": "No API: browser fallback",
    disabled: "Disabled",
    unknown: "Unknown source"
  }[source] ?? source;
}

function renderCopilotMeta(result = {}) {
  if (!elements.copilotMeta) return;

  const source = result.source ?? "unknown";
  const model = result.modelLabel ?? shortModelName(result.model);
  const sourceLabel = copilotSourceLabel(source, model);
  const latency = result.latencyMs == null ? "" : ` | ${(Number(result.latencyMs) / 1000).toFixed(1)}s`;
  elements.copilotMeta.textContent = `${copilotModeLabel(result.mode)} | ${sourceLabel}${latency}`;
}

function activeCopilotMode() {
  return [...elements.copilotActions].find((button) => button.classList.contains("is-active"))
    ?.dataset.copilotMode ?? "live";
}

function setActiveCopilotMode(mode = "live") {
  elements.copilotActions.forEach((button) => {
    button.classList.toggle("is-active", (button.dataset.copilotMode ?? "live") === mode);
  });
}

function activePlayerCount() {
  return latestActivePlayers.length || Number(elements.score.textContent || 0);
}

function liveScoreBucket(score) {
  return Math.floor(Number(score ?? 0) / 20000);
}

function livePlayerKey(player = {}) {
  return player.runId || player.sessionId || player.callsign || "unknown";
}

function sortedActivePlayersForInsight() {
  return latestActivePlayers
    .filter((player) => player.callsign && player.callsign !== "UNKNOWN")
    .slice()
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
}

function liveCopilotSignature() {
  const players = sortedActivePlayersForInsight();
  if (players.length === 0) return "";

  if (players.length === 1) {
    const player = players[0];
    const phase = player.bossActive === true ? "boss" : `wave-${Number(player.wave ?? 1)}`;
    return [
      "single",
      livePlayerKey(player),
      "level",
      Number(player.level ?? 1),
      phase,
      "score",
      liveScoreBucket(player.score)
    ].join(":");
  }

  const top4 = players.slice(0, 4).map((player) => [
    livePlayerKey(player),
    Number(player.level ?? 1),
    liveScoreBucket(player.score)
  ].join(":")).join("|");

  return `multi:${players.length}:${top4}`;
}

function liveCopilotTrigger() {
  const players = sortedActivePlayersForInsight();
  if (players.length === 0) return "waiting";
  if (players.length === 1) {
    const player = players[0];
    const phase = player.bossActive === true ? "boss phase" : `wave ${Number(player.wave ?? 1)}`;
    return `${player.callsign} reached level ${Number(player.level ?? 1)} ${phase} with ${Number(player.score ?? 0).toLocaleString("en-US")} points`;
  }

  return `${players.length} active players, top4 levels and score buckets changed`;
}

function copilotSnapshot() {
  return {
    livePlayers: activePlayerCount(),
    activePlayers: latestActivePlayers.slice(0, 8).map((player) => ({
      callsign: player.callsign,
      score: Number(player.score ?? 0),
      level: Number(player.level ?? 1),
      latencyMs: Number(player.latencyMs ?? 0),
      eventsPerSecond: Number(player.eventsPerSecond ?? 0),
      wave: Number(player.wave ?? 1),
      bossActive: player.bossActive === true,
      eventCounts: player.eventCounts ?? {},
      vm: player.vm ?? "unknown"
    })),
    liveSignature: liveCopilotSignature(),
    liveTrigger: liveCopilotTrigger(),
    topScore: Number(elements.level.textContent),
    eventsPerSecond: telemetry.eventRate()
  };
}

function showWaitingForLivePlayers() {
  latestLiveCopilotSignature = "";
  elements.insight.textContent = "Waiting for active players.";
  renderCopilotMeta({
    mode: "live",
    source: "waiting",
    modelLabel: "no active players"
  });
}

function renderCopilotResult(result = {}) {
  elements.insight.textContent = result.insight ?? "AI returned no insight.";
  renderCopilotMeta(result);
}

function hasStableLiveInsight() {
  const text = elements.insight?.textContent?.trim() ?? "";
  return Boolean(text && !/^Waiting/i.test(text) && !/is running\.\.\.$/i.test(text));
}

export async function askCopilot(snapshot = {}, mode = "live") {
  if (!isOpsView) return;
  if (copilotInFlight) return;
  setActiveCopilotMode(mode);
  if (mode === "live" && activePlayerCount() === 0) {
    showWaitingForLivePlayers();
    return;
  }

  copilotInFlight = true;
  const liveSignature = mode === "live" ? snapshot.liveSignature || liveCopilotSignature() : "";
  if (mode === "live") {
    liveCopilotSignatureInFlight = liveSignature;
  }
  if (mode !== "live" || !hasStableLiveInsight()) {
    elements.insight.textContent = `${copilotModeLabel(mode)} is running...`;
  }
  renderCopilotMeta({ mode, source: "pending", model: "OCI GenAI" });
  architecture.nodes.genai?.classList.add("is-busy");
  elements.copilotActions.forEach((button) => {
    button.disabled = true;
  });
  try {
    const result = await telemetry.askCopilot(snapshot, { mode });
    if (mode === "live" && liveSignature) {
      liveCopilotInsights.set(liveSignature, result);
      latestLiveCopilotSignature = liveSignature;
    }
    renderCopilotResult(result);
  } finally {
    copilotInFlight = false;
    if (mode === "live") {
      liveCopilotSignatureInFlight = "";
    }
    architecture.nodes.genai?.classList.remove("is-busy");
    elements.copilotActions.forEach((button) => {
      button.disabled = false;
    });
  }
}

function maybeRunLiveCopilot({ force = false } = {}) {
  if (!isOpsView || activeCopilotMode() !== "live" || copilotInFlight) return;
  if (activePlayerCount() === 0) {
    showWaitingForLivePlayers();
    return;
  }

  const signature = liveCopilotSignature();
  if (!signature || liveCopilotSignatureInFlight === signature) return;

  const cached = liveCopilotInsights.get(signature);
  if (cached) {
    if (force || latestLiveCopilotSignature !== signature) {
      latestLiveCopilotSignature = signature;
      renderCopilotResult(cached);
    }
    return;
  }

  if (!force && latestLiveCopilotSignature === signature) return;
  askCopilot(copilotSnapshot(), "live");
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
  } catch (error) {
    elements.stressStatus.textContent = error?.message ?? "Stress request failed";
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
  } catch (error) {
    elements.stressStatus.textContent = error?.message ?? "Scale-down request failed";
  } finally {
    setTimeout(() => {
      elements.stopStress.disabled = false;
    }, 5000);
  }
}

export async function resetDemoData() {
  if (!isOpsView || !elements.resetDemoData) return;

  const confirmationCode = window.prompt("Type !Oracle#2026! to permanently clear demo leaderboard, analytics and live player state.");
  if (!confirmationCode) {
    if (elements.resetDemoStatus) elements.resetDemoStatus.textContent = "Reset cancelled";
    return;
  }

  elements.resetDemoData.disabled = true;
  if (elements.resetDemoStatus) elements.resetDemoStatus.textContent = "Resetting...";
  try {
    const result = await telemetry.resetDemoData(confirmationCode);
    leaderboardCardInsights.clear();
    liveCopilotInsights.clear();
    latestLeaderboardEntries = [];
    latestLiveCopilotSignature = "";
    renderCopilotResult({
      insight: "Demo data was reset. Waiting for new live telemetry.",
      source: "local",
      mode: activeCopilotMode()
    });
    renderLivePlayers([]);
    renderEventAnalytics({
      source: "autonomousDatabase",
      windows: { last1m: 0, last5m: 0, last15m: 0 },
      eventTypes: []
    });
    await refreshLeaderboardBoard({ forceInsights: true });
    if (elements.resetDemoStatus) {
      elements.resetDemoStatus.textContent = result?.ok ? "Demo data cleared" : "Reset completed";
    }
  } catch (error) {
    if (elements.resetDemoStatus) {
      elements.resetDemoStatus.textContent = error?.message ?? "Reset failed";
    }
  } finally {
    window.setTimeout(() => {
      elements.resetDemoData.disabled = false;
    }, 3000);
  }
}

export async function emitGameEvent(type, snapshot = {}) {
  await telemetry.emit(type, snapshot);
  updateHud(snapshot);
}

export async function initOciRuntime() {
  if (isOpsView && !(await ensureOpsAuthenticated())) {
    setConnection(true);
    return;
  }

  await telemetry.init();
  if (isOpsView) {
    renderGameQrCode();
    renderStatus(telemetry.status);
    renderLivePlayers(await telemetry.refreshLivePlayers());
    renderEventAnalytics(await telemetry.eventAnalytics());
    await refreshLeaderboardBoard();
    setConnection(telemetry.offline);

    elements.copilotActions.forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.copilotMode ?? "live";
        setActiveCopilotMode(mode);
        if (mode === "live") {
          maybeRunLiveCopilot({ force: true });
          return;
        }
        askCopilot(copilotSnapshot(), mode);
      });
    });
    if (elements.startStress && elements.startStress.dataset.stressBound !== "true") {
      elements.startStress.dataset.stressBound = "true";
      elements.startStress.addEventListener("click", () => startStress());
    }
    if (elements.stopStress && elements.stopStress.dataset.stressBound !== "true") {
      elements.stopStress.dataset.stressBound = "true";
      elements.stopStress.addEventListener("click", () => stopStress());
    }
    if (elements.resetDemoData && elements.resetDemoData.dataset.resetBound !== "true") {
      elements.resetDemoData.dataset.resetBound = "true";
      elements.resetDemoData.addEventListener("click", () => resetDemoData());
    }
    elements.refreshLeaderboard.addEventListener("click", async () => {
      await refreshLeaderboardBoard({ forceInsights: true });
    });

    maybeRunLiveCopilot({ force: true });

    const leaderboardIntervalMs = Number(window.OCI_DEFENSE_CONFIG.leaderboardIntervalMs ?? 6000);
    window.setInterval(() => {
      refreshLeaderboardBoard();
    }, leaderboardIntervalMs);
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
}
