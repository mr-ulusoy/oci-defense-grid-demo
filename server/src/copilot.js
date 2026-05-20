import os from "node:os";

const FALLBACK_INSIGHTS = [
  "Traffic pressure is steady. Preserve shields for the next spike and watch for players taking unnecessary hits.",
  "Latency remains inside range. Player scores are stable while event volume builds.",
  "The latest wave looks like a short anomaly burst. High kill counts with low hits indicate efficient play.",
  "Score velocity is rising. Compare kill-to-hit ratio and powerup use to find the strongest pilot."
];

const DEFAULT_GENAI_ENDPOINT = "https://inference.generativeai.eu-frankfurt-1.oci.oraclecloud.com";
const DEFAULT_GENAI_MODEL = "openai.gpt-oss-120b";
const DEFAULT_COACH_GENAI_MODEL = "google.gemini-2.5-flash-lite";
const DEFAULT_GENAI_TIMEOUT_MS = 25000;
const DEFAULT_COACH_GENAI_TIMEOUT_MS = 12000;
const DEFAULT_CARD_INSIGHT_TIMEOUT_MS = 7000;
const COPILOT_GATEWAY_SAFE_TIMEOUT_MS = 7600;
const COACH_REPLY_WORD_LIMIT = 45;
const COPILOT_REPLY_WORD_LIMIT = 220;
const CARD_INSIGHT_CACHE_MAX_ENTRIES = 50;

const cardInsightCache = new Map();

const QUIZ_COACH_CONTEXT = {
  "region-fault-domains": {
    level: 1,
    topic: "Regions and fault domains",
    question: "Why does this demo use one OCI region with fault-domain-aware placement?",
    correctConcept:
      "The selected region keeps services close to the game traffic, while fault domains reduce the chance that one physical hardware failure affects every VM.",
    fallbackHints: [
      "Think about distance first, then hardware separation. A region keeps the stack together; fault domains keep VMs apart physically.",
      "The region gives the demo a repeatable home. Fault domains help avoid every VM sharing the same hardware risk."
    ]
  },
  "api-lb-route": {
    level: 2,
    topic: "API Gateway and Load Balancer",
    question: "Which traffic path is correct in this demo?",
    correctConcept:
      "The browser loads the game through the public Load Balancer, while /api/* calls go through API Gateway.",
    fallbackHints: [
      "Separate the two doors: the game page enters through the public Load Balancer, API calls enter through API Gateway.",
      "Load Balancer serves the playable app. API Gateway is the controlled front door for telemetry, leaderboard and coach calls."
    ]
  },
  "compute-instance-pool": {
    level: 3,
    topic: "Compute VMs and instance pools",
    question: "What does the instance pool demonstrate?",
    correctConcept:
      "An instance pool manages multiple VMs as one fleet, attaches them to the Load Balancer and can grow or shrink with autoscaling.",
    fallbackHints: [
      "Look for the fleet idea. Instance pools manage many Compute VMs together instead of treating each one manually.",
      "The pool is what makes the VM layer repeatable: launch, attach to the Load Balancer and scale as one group."
    ]
  },
  "functions-cache-streaming": {
    level: 4,
    topic: "Functions, OCI Cache and Streaming",
    question: "Which service keeps live player state fast?",
    correctConcept:
      "OCI Cache keeps live player state fast; Functions processes events and Streaming buffers durable event flow.",
    fallbackHints: [
      "Live state should be fast and temporary. Durable event history belongs to Streaming and storage, not the live roster.",
      "Cache is for quick reads like active players. Functions runs code, and Streaming keeps the event flow durable."
    ]
  },
  "adb-object-storage": {
    level: 5,
    topic: "Autonomous Database and Object Storage",
    question: "Where do curated analytics and raw events go?",
    correctConcept:
      "Autonomous Database stores curated game_events and highscores; Object Storage archives raw NDJSON events.",
    fallbackHints: [
      "Curated rows that you query belong in Autonomous Database. Raw replay/audit files belong in Object Storage.",
      "Think SQL for analytics and leaderboard, object archive for raw event payloads."
    ]
  }
};

let sdkClientPromise;
let sdkProviderPromise;

function expandHomePath(filePath) {
  if (!filePath.startsWith("~/")) {
    return filePath;
  }

  return `${os.homedir()}${filePath.slice(1)}`;
}

function topByScore(entries = [], limit = 5) {
  return [...entries]
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
    .slice(0, limit);
}

function eventCount(entry, type) {
  return Number(entry?.eventCounts?.[type] ?? 0);
}

function eventCountAny(entry, ...types) {
  return types.reduce((total, type) => total + Number(entry?.eventCounts?.[type] ?? 0), 0);
}

function playerEfficiency(entry) {
  const kills = eventCount(entry, "enemy_killed");
  const hits = eventCount(entry, "player_hit");
  return kills / Math.max(1, hits);
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function pluralize(count, singular, plural = `${singular}s`) {
  return Number(count) === 1 ? singular : plural;
}

function bestEfficiency(entries = []) {
  return topByScore(entries, 8).sort(
    (left, right) => playerEfficiency(right) - playerEfficiency(left)
  )[0];
}

function latestRun(entries = []) {
  return [...entries]
    .filter((entry) => entry.createdAt)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}

function compactPlayer(entry) {
  if (!entry) {
    return null;
  }

  return {
    callsign: entry.callsign,
    score: Number(entry.score ?? 0),
    level: Number(entry.level ?? 1),
    wave: Number(entry.wave ?? 1),
    bossActive: entry.bossActive === true,
    runId: entry.runId,
    vm: entry.vm,
    createdAt: entry.createdAt,
    eventCounts: {
      kills: eventCount(entry, "enemy_killed"),
      hits: eventCount(entry, "player_hit"),
      powerups: eventCount(entry, "powerup"),
      extraLives: eventCount(entry, "extra_life"),
      bossPhases: eventCount(entry, "boss_phase"),
      runEnd: eventCount(entry, "run_end")
    }
  };
}

function cardMetrics(entry = {}, index = 0) {
  return {
    rank: index + 1,
    callsign: entry.callsign,
    runId: entry.runId,
    score: Number(entry.score ?? 0),
    level: Number(entry.level ?? 1),
    kills: eventCount(entry, "enemy_killed"),
    hits: eventCount(entry, "player_hit"),
    powerups: eventCount(entry, "powerup"),
    extraLivesCollected: eventCount(entry, "extra_life"),
    bossPhases: eventCount(entry, "boss_phase")
  };
}

function cardInsightSignature(entries = []) {
  return entries
    .slice(0, 2)
    .map((entry, index) => JSON.stringify(cardMetrics(entry, index)))
    .join("|");
}

function cacheCardInsight(signature, result) {
  if (!signature || !String(result?.source ?? "").startsWith("oci-genai")) {
    return;
  }

  cardInsightCache.set(signature, result);
  while (cardInsightCache.size > CARD_INSIGHT_CACHE_MAX_ENTRIES) {
    cardInsightCache.delete(cardInsightCache.keys().next().value);
  }
}

function deterministicCardInsight(entry = {}, index = 0) {
  const metrics = cardMetrics(entry, index);
  const livesLabel = metrics.extraLivesCollected === 1 ? "life" : "lives";
  const killText = `${metrics.kills} kills`;
  const hitText = `${metrics.hits} hits`;

  if (metrics.hits >= 40 && metrics.extraLivesCollected > 0) {
    return {
      ...metrics,
      title: "Recovery analysis",
      headline: `${killText}, ${hitText}.`,
      detail: `Collected ${metrics.extraLivesCollected} extra ${livesLabel}; strong output, but damage pressure is high.`,
      tone: "risk"
    };
  }

  if (metrics.extraLivesCollected > 0) {
    return {
      ...metrics,
      title: "Run analysis",
      headline: `${killText}, ${hitText}.`,
      detail: `Collected ${metrics.extraLivesCollected} extra ${livesLabel}; recovery resources helped sustain pressure.`,
      tone: "recovery"
    };
  }

  if (metrics.hits <= 20 && metrics.level >= 3) {
    return {
      ...metrics,
      title: "Clean analysis",
      headline: `${killText}, ${hitText}.`,
      detail: "Low damage and strong progress show controlled survival.",
      tone: "clean"
    };
  }

  if (metrics.hits > 30) {
    return {
      ...metrics,
      title: "Risk analysis",
      headline: `${killText}, ${hitText}.`,
      detail: "No extra-life buffer was collected, so the run had limited recovery margin.",
      tone: "risk"
    };
  }

  return {
    ...metrics,
    title: index === 0 ? "Leader analysis" : "Contender analysis",
    headline: `${killText}, ${hitText}.`,
    detail: "Score, level and damage pattern show steady control.",
    tone: "controlled"
  };
}

function compactEventAnalytics(eventAnalytics = {}) {
  return {
    source: eventAnalytics.source,
    windows: eventAnalytics.windows,
    eventTypes: (eventAnalytics.eventTypes ?? []).slice(0, 8)
  };
}

function buildCopilotContext(context = {}) {
  const topLeaderboard = topByScore(context.leaderboard ?? [], 6);
  const topLivePlayers = topByScore(context.livePlayers ?? [], 8);
  const leaderboard = topLeaderboard.map(compactPlayer);
  const livePlayers = topLivePlayers.map(compactPlayer);
  const combined = [...(context.livePlayers ?? []), ...(context.leaderboard ?? [])];

  return {
    mode: context.mode ?? "live",
    question: String(context.question ?? "").slice(0, 240),
    snapshot: context.snapshot ?? {},
    vm: context.vm,
    routeMode: context.routeMode,
    sinks: context.sinks,
    streamConsumer: context.streamConsumer,
    liveAnalytics: context.analytics,
    eventAnalytics: compactEventAnalytics(context.eventAnalytics),
    leaderboard,
    livePlayers,
    leaders: {
      topScore: compactPlayer(topLeaderboard[0]),
      bestEfficiency: compactPlayer(bestEfficiency(combined)),
      latestRun: compactPlayer(latestRun(context.leaderboard ?? []))
    }
  };
}

function deterministicInsight(context = {}) {
  const mode = context.mode ?? "live";
  const leaderboard = topByScore(context.leaderboard ?? [], 6);
  const livePlayers = topByScore(context.livePlayers ?? [], 8);
  const combined = [...livePlayers, ...leaderboard];
  const topPlayer = leaderboard[0] ?? livePlayers[0];
  const topLivePlayer = livePlayers[0];
  const topCompletedRun = leaderboard[0];
  const efficient = bestEfficiency(combined);
  const latest = latestRun(leaderboard) ?? topPlayer;
  const analytics = context.analytics ?? {};
  const snapshot = context.snapshot ?? {};
  const eventAnalytics = context.eventAnalytics ?? {};
  const eps = Number(analytics?.eventsPerSecond ?? snapshot?.eventsPerSecond ?? 0);
  const score = Number(snapshot.score ?? topPlayer?.score ?? 0);
  const level = Number(snapshot.level ?? topPlayer?.level ?? 1);

  if (mode === "live") {
    if (livePlayers.length > 0) {
      const secondLivePlayer = livePlayers[1];
      const topHits = eventCountAny(topLivePlayer, "player_hit", "hits");
      const topKills = eventCountAny(topLivePlayer, "enemy_killed", "kills");
      const topPowerups = eventCountAny(topLivePlayer, "powerup", "powerups");
      const topBossPhases = eventCountAny(topLivePlayer, "boss_phase", "bossPhases");
      const liveSummary = `${livePlayers.length} active ${pluralize(livePlayers.length, "pilot")}: ${topLivePlayer.callsign} leads live at level ${topLivePlayer.level} with ${formatNumber(topLivePlayer.score)} points`;
      const phaseSummary = topLivePlayer.bossActive
        ? ` and is in a boss phase`
        : Number(topLivePlayer.wave ?? 0) > 0
          ? ` on wave ${topLivePlayer.wave}`
          : "";
      const metricSummary = `${topKills} kills, ${topHits} hits, ${topPowerups} power-ups and ${topBossPhases} boss phases${phaseSummary}`;
      const highScoreGap = topCompletedRun
        ? Math.max(0, Number(topCompletedRun.score ?? 0) - Number(topLivePlayer.score ?? 0))
        : 0;
      const highScorePace = topCompletedRun?.score
        ? Math.round((Number(topLivePlayer.score ?? 0) / Math.max(1, Number(topCompletedRun.score))) * 100)
        : 0;
      const coachingSignal = topHits <= 3
        ? "clean control is strong, so the next move is pushing kill pace and boss clears"
        : topPowerups <= Math.max(2, Math.floor(topKills / 12))
          ? "power-up pickup is the pressure point"
          : "hit control is the pressure point";
      const raceSummary = secondLivePlayer
        ? ` ${secondLivePlayer.callsign} is chasing at level ${secondLivePlayer.level} with ${formatNumber(secondLivePlayer.score)} points.`
        : "";

      if (topCompletedRun && topCompletedRun.callsign !== topLivePlayer.callsign) {
        return `${liveSummary}, recording ${metricSummary}.${raceSummary} ${topCompletedRun.callsign} still owns the completed high score; ${topLivePlayer.callsign} is ${highScorePace}% of that mark, needs ${formatNumber(highScoreGap)} more points, and ${coachingSignal}.`;
      }

      return `${liveSummary}, recording ${metricSummary}.${raceSummary} Compare live score velocity and hit count to see who is controlling the current field.`;
    }

    if (topCompletedRun) {
      return `No active pilots right now. ${topCompletedRun.callsign} holds the completed-run leaderboard with ${formatNumber(topCompletedRun.score)} points at level ${topCompletedRun.level}.`;
    }
  }

  if (mode === "leaderboard" && topPlayer) {
    const leaderCounts = topPlayer.eventCounts ?? {};
    const efficientCounts = efficient?.eventCounts ?? {};
    return `${topPlayer.callsign} leads the board with ${topPlayer.score} points at level ${topPlayer.level}, backed by ${leaderCounts.kills ?? 0} kills, ${leaderCounts.bossPhases ?? 0} boss phases and ${leaderCounts.hits ?? 0} hits. ${efficient?.callsign ?? topPlayer.callsign} is the efficiency story, with ${efficientCounts.kills ?? leaderCounts.kills ?? 0} kills against ${efficientCounts.hits ?? leaderCounts.hits ?? 0} hits. Watch for players with high hits or low level progression: they create a clean coaching moment for shields, powerups and safer boss positioning.`;
  }

  if (mode === "players" && livePlayers.length > 0) {
    return `${livePlayers.length} players are active right now, led by ${livePlayers[0].callsign} with ${livePlayers[0].score} points at level ${livePlayers[0].level}. Compare the live players by score velocity, current level, hits and powerups to see who is actually in control now. If a player has a high score but many hits, they are playing aggressively; if another has fewer hits and steady level progression, they may be more consistent.`;
  }

  if (mode === "run" && latest) {
    const counts = latest.eventCounts ?? {};
    return `${latest.callsign}'s latest completed run reached level ${latest.level} with ${latest.score} points, ${counts.kills ?? 0} kills, ${counts.hits ?? 0} hits and ${counts.powerups ?? 0} powerups. The run looks strongest when kills and boss phases rise faster than hits; it looks risky when hits climb without level progression. Review whether the pilot used powerups and extra lives as recovery tools or relied on them too heavily.`;
  }

  if (mode === "demo_summary") {
    const events = Number(eventAnalytics.windows?.last15m ?? analytics.totalRecentEvents ?? 0);
    return `Demo story: VMs serve the playable game through the Load Balancer, while API Gateway controls the API and AI calls. Functions handles event ingest, OCI Cache keeps live player state fast, Streaming buffers the event flow, Autonomous AI Database ranks runs and exposes analytics, and Object Storage keeps raw NDJSON event files. In the last window this demo has ${events} observed events, giving the presenter real signals to discuss instead of a static diagram.`;
  }

  if (eps > 4) {
    return `High telemetry rate detected at level ${level}. API Gateway should throttle bursts while Streaming buffers the event flow.`;
  }
  if (score > 5000) {
    return `Defense score is strong at ${score}. Compare hits, powerups and boss phases to see whether the player is winning through clean movement or recovery resources.`;
  }
  if (level >= 3) {
    return `Level ${level} is active. Watch whether the player keeps damage low while enemy pressure rises.`;
  }

  return FALLBACK_INSIGHTS[Math.floor(Math.random() * FALLBACK_INSIGHTS.length)];
}

function fallbackCoachReply(questionId, attemptCount = 0) {
  const context = QUIZ_COACH_CONTEXT[questionId];
  if (!context) {
    return null;
  }

  const hints = context.fallbackHints;
  return hints[Math.max(0, Number(attemptCount ?? 0) - 1) % hints.length];
}

function trimWords(value, limit) {
  const words = String(value ?? "")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  return words.slice(0, limit).join(" ");
}

function completeInsight(value) {
  const text = String(value ?? "").trim();
  return text.length >= 40 && /[.!?]$/.test(text);
}

function buildCoachPrompt({ context, message, attemptCount }) {
  return [
    "You are OCI Guide, a friendly in-game learning coach for OCI Defense Grid.",
    "Help the player reason about the current quiz. Do not reveal the exact answer or option letter.",
    `Return one concise hint under ${COACH_REPLY_WORD_LIMIT} words. No markdown.`,
    `Topic: ${context.topic}`,
    `Question: ${context.question}`,
    `Correct concept: ${context.correctConcept}`,
    `Attempt count: ${Number(attemptCount ?? 0)}`,
    `Player message: ${message || "I need a hint."}`
  ].join("\n");
}

export function getCoachQuestion(questionId) {
  return QUIZ_COACH_CONTEXT[questionId] ?? null;
}

function getCopilotModel() {
  return process.env.OCI_GENAI_MODEL || DEFAULT_GENAI_MODEL;
}

function getCoachModel() {
  return process.env.OCI_GENAI_COACH_MODEL || DEFAULT_COACH_GENAI_MODEL;
}

function getCardInsightModel() {
  return getCopilotModel();
}

function modelLabel(model) {
  const value = String(model ?? "");
  if (value === DEFAULT_GENAI_MODEL) {
    return "OpenAI GPT-OSS 120B";
  }
  if (value.includes("gpt-oss-120b")) {
    return "OpenAI GPT-OSS 120B";
  }
  if (value.includes("gemini-2.5-flash-lite")) {
    return "Gemini 2.5 Flash-Lite";
  }
  if (value.includes("gemini-2.5-flash")) {
    return "Gemini 2.5 Flash";
  }
  if (value.includes("gemini-2.5-pro")) {
    return "Gemini 2.5 Pro";
  }
  return value.startsWith("ocid1.generativeaimodel") ? `OCI model ...${value.slice(-6)}` : value;
}

function buildCopilotRequest(prompt, model = getCopilotModel(), maxTokens = 80) {
  const endpoint = process.env.OCI_GENAI_ENDPOINT ?? "";

  if (endpoint.includes("/chat/completions")) {
    return {
      model,
      messages: [
        {
          role: "system",
          content: "You are the OCI Defense Grid live demo copilot. Be concise, stable, and customer-facing."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: maxTokens,
      temperature: 0.2
    };
  }

  if (endpoint.includes("/responses")) {
    return {
      model,
      input: prompt,
      max_output_tokens: maxTokens,
      temperature: 0.2
    };
  }

  return {
    prompt,
    maxTokens,
    temperature: 0.2
  };
}

function buildSdkChatRequest(prompt, model = getCopilotModel(), maxTokens = 1200) {
  return {
    chatDetails: {
      compartmentId: process.env.OCI_GENAI_COMPARTMENT_OCID,
      servingMode: {
        modelId: model,
        servingType: "ON_DEMAND"
      },
      chatRequest: {
        messages: [
          {
            role: "USER",
            content: [
              {
                type: "TEXT",
                text: prompt
              }
            ]
          }
        ],
        apiFormat: "GENERIC",
        maxTokens,
        temperature: 0.2,
        frequencyPenalty: 0,
        presencePenalty: 0,
        topK: 1,
        topP: 0.95
      }
    }
  };
}

function copilotResponseInstruction(mode) {
  if (mode === "live") {
    return [
      "Return one or two customer-facing sentences under 90 words total.",
      "Start with the number of active pilots when livePlayers is not empty.",
      "When two or more livePlayers are present, compare at least the top two active pilots by name.",
      "When one livePlayer reaches a new level, frame it as competition against the completed high score when leaderboard data is present.",
      "Mention if a player needs cleaner hits, stronger survival, or more score pace to take the high score.",
      "For one active pilot, include their current wave or boss phase when provided, their high-score gap or percentage when a completed leader exists, one strength, and one specific next move.",
      "If the active pilot has 0 to 3 hits, do not tell them to play cleaner; praise control and focus the next move on score pace, kills, boss progress, powerups, or level progression.",
      "Avoid generic advice such as 'improve score pace and survival' unless you explain the exact metric behind it.",
      "Clearly distinguish active live players from completed leaderboard runs.",
      "Do not imply a live player is the overall leaderboard leader unless they also lead completed runs.",
      "Use concrete live player signals such as score, level, kills, hits, powerups and boss phases.",
      "Do not mention OCI services or demo architecture. No markdown."
    ].join(" ");
  }

  const modeDetails = {
    leaderboard:
      "Focus only on top performers, why they are winning, efficiency signals such as kills versus hits, level progression, powerups or extra lives, and one risk or coaching point.",
    players:
      "Compare only currently active players, call out who is ahead now, who is improving or struggling, and what their gameplay pattern suggests.",
    run:
      "Review only the latest run: progression, score, kills, hits, powerups, boss phases, strength, weakness and one practical coaching point.",
    demo_summary:
      "Explain what the observed telemetry proves about the OCI architecture, including Load Balancer, API Gateway, Functions, OCI Cache, Streaming, Autonomous AI Database, Object Storage and GenAI."
  }[mode] ?? "Analyze the demo state with concrete metrics and service context.";

  if (mode === "demo_summary") {
    return [
      "Return four customer-facing sentences under 190 words total.",
      "Use concrete names, scores, levels and event counts when present; do not invent numbers.",
      modeDetails,
      "Sentence 1: headline conclusion. Sentence 2: observed telemetry. Sentence 3: service flow. Sentence 4: presenter takeaway.",
      "No markdown, bullets, headings or emojis."
    ].join(" ");
  }

  return [
    "Return three or four customer-facing sentences under 170 words total.",
    "Analyze gameplay only. Do not mention OCI, cloud services, architecture, Functions, Streaming, Database, Cache, Gateway, Load Balancer or Object Storage.",
    "Use concrete names, scores, levels and event counts when present; do not invent numbers.",
    modeDetails,
    "Sentence 1: headline conclusion. Sentence 2: evidence from gameplay metrics. Sentence 3: pattern, risk or comparison. Optional sentence 4: practical coaching point.",
    "No markdown, bullets, headings or emojis."
  ].join(" ");
}

function buildAnalysisPrompt(context) {
  const mode = context.mode ?? "live";
  const intent = {
    live: "Give the presenter a concise multi-player current-state insight.",
    leaderboard: "Analyze who is performing best and why, using score, level and event counts.",
    players: "Compare active players and call out live performance patterns.",
    run: "Analyze the latest or selected run, including strengths, damage, progression and useful gameplay talking points.",
    demo_summary: "Summarize what the current telemetry proves about the OCI architecture."
  }[mode] ?? "Analyze the OCI Defense Grid demo state.";

  return [
    mode === "demo_summary"
      ? "You are the OCI Defense Grid ops copilot for a customer demo."
      : "You are the OCI Defense Grid gameplay analyst.",
    intent,
    copilotResponseInstruction(mode),
    mode === "demo_summary"
      ? "Mention concrete player or service signals when present. No markdown."
      : "Mention concrete player signals when present. No markdown.",
    `Context JSON: ${JSON.stringify(buildCopilotContext(context))}`
  ].join("\n");
}

function buildCardInsightPrompt(entries = []) {
  return [
    "You are a gameplay analyst for OCI Defense Grid leaderboard cards.",
    "Return strict JSON only, no markdown, no comments.",
    "Create one short run analysis for each player in the input array. Each object represents one completed run.",
    "The JSON must be an array with objects: rank, callsign, title, headline, detail, tone.",
    "title: 1-3 words, title case. headline: one short sentence under 10 words. detail: one short sentence under 20 words.",
    "tone must be one of: clean, controlled, recovery, risk, aggressive.",
    "Use only the provided metrics. Do not invent numbers.",
    "extraLivesCollected means extra lives collected, not used. Never write 'used extra lives'.",
    "Mention collected extra lives only when extraLivesCollected is greater than 0.",
    "Analyze the full run using score, level, kills, hits, powerups, extra lives collected and boss phases.",
    "Focus on playing style, risk, control, recovery and efficiency.",
    `Input JSON: ${JSON.stringify(entries.slice(0, 2).map(cardMetrics))}`
  ].join("\n");
}

function parseJsonArray(value) {
  const text = String(value ?? "").trim();
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      return null;
    }
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function compactSentence(value, wordLimit) {
  const text = trimWords(value, wordLimit).replace(/\s+/g, " ").trim();
  return text || null;
}

function normalizeTone(value, fallback) {
  const tone = String(value ?? "").toLowerCase();
  return ["clean", "controlled", "recovery", "risk", "aggressive"].includes(tone)
    ? tone
    : fallback;
}

function sanitizeCardInsight(rawInsight, entry, index) {
  const fallback = deterministicCardInsight(entry, index);
  const title = compactSentence(rawInsight?.title, 3);
  const headline = compactSentence(rawInsight?.headline, 10);
  const detail = compactSentence(rawInsight?.detail, 22);

  if (!title || !headline || !detail) {
    return fallback;
  }

  return {
    ...fallback,
    title,
    headline,
    detail,
    tone: normalizeTone(rawInsight?.tone, fallback.tone)
  };
}

function extractCopilotText(payload) {
  const responseText = payload.output
    ?.flatMap((item) => item.content ?? [])
    ?.map((content) => content.text)
    ?.filter(Boolean)
    ?.join(" ");
  const sdkChoiceContent = payload.chatResult?.chatResponse?.choices?.[0]?.message?.content
    ?.map((content) => content.text)
    ?.filter(Boolean)
    ?.join(" ");

  return (
    payload.insight ??
    payload.text ??
    payload.output_text ??
    payload.choices?.[0]?.message?.content ??
    payload.choices?.[0]?.text ??
    sdkChoiceContent ??
    responseText ??
    null
  );
}

async function getSdkAuthProvider() {
  if (!sdkProviderPromise) {
    sdkProviderPromise = (async () => {
      const common = await import("oci-common");

      if (process.env.OCI_RESOURCE_PRINCIPAL_VERSION) {
        return common.ResourcePrincipalAuthenticationDetailsProvider.builder();
      }

      if (process.env.OCI_INSTANCE_ID || process.env.OCI_REGION) {
        return new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
      }

      const configLocation = expandHomePath(process.env.OCI_CONFIG_FILE ?? "~/.oci/config");
      const profile = process.env.OCI_CONFIG_FILE_PROFILE ?? "DEFAULT";
      if (process.env.OCI_AUTH === "SecurityToken") {
        return new common.SessionAuthDetailProvider(configLocation, profile);
      }

      return new common.ConfigFileAuthenticationDetailsProvider(configLocation, profile);
    })();
  }

  return sdkProviderPromise;
}

async function getSdkClient() {
  if (!sdkClientPromise) {
    sdkClientPromise = (async () => {
      const inference = await import("oci-generativeaiinference");
      const client = new inference.GenerativeAiInferenceClient({
        authenticationDetailsProvider: await getSdkAuthProvider()
      });
      client.endpoint = process.env.OCI_GENAI_ENDPOINT || DEFAULT_GENAI_ENDPOINT;
      return client;
    })();
  }

  return sdkClientPromise;
}

async function callSdkCopilot(prompt, options = {}) {
  if (!process.env.OCI_GENAI_COMPARTMENT_OCID) {
    return null;
  }

  const client = await getSdkClient();
  const common = await import("oci-common");
  const response = await client.chat({
    ...buildSdkChatRequest(prompt, options.model, options.maxTokens),
    retryConfiguration: common.NoRetryConfigurationDetails
  });
  return extractCopilotText(response);
}

async function callBearerCopilot(prompt, options = {}) {
  const endpoint = process.env.OCI_GENAI_ENDPOINT ?? "";
  if (!endpoint || !process.env.OCI_GENAI_BEARER_TOKEN) {
    return null;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OCI_GENAI_BEARER_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildCopilotRequest(prompt, options.model, options.maxTokens))
  });

  if (!response.ok) {
    throw new Error(`OCI GenAI endpoint returned ${response.status}`);
  }

  const payload = await response.json();
  return extractCopilotText(payload);
}

async function callExternalCopilot(prompt, options = {}) {
  const endpoint = process.env.OCI_GENAI_ENDPOINT ?? "";

  if (endpoint.includes("/chat/completions") || endpoint.includes("/responses")) {
    return callBearerCopilot(prompt, options);
  }

  return callSdkCopilot(prompt, options);
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`OCI GenAI timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export async function createCopilotInsight(context) {
  const mode = context?.mode ?? "live";
  const model = getCopilotModel();
  const prompt = buildAnalysisPrompt(context);
  const started = Date.now();
  const configuredTimeoutMs = Number(process.env.OCI_GENAI_TIMEOUT_MS ?? DEFAULT_GENAI_TIMEOUT_MS);
  const timeoutMs = Math.min(configuredTimeoutMs, COPILOT_GATEWAY_SAFE_TIMEOUT_MS);

  try {
    const externalInsight = await withTimeout(
      callExternalCopilot(prompt, {
        model,
        maxTokens: mode === "live" ? 300 : 900
      }),
      timeoutMs
    );
    if (externalInsight) {
      const insight = trimWords(externalInsight, COPILOT_REPLY_WORD_LIMIT);
      if (!completeInsight(insight)) {
        throw new Error("OCI GenAI returned an incomplete copilot sentence");
      }
      return {
        insight,
        source: "oci-genai",
        model,
        modelLabel: modelLabel(model),
        latencyMs: Date.now() - started,
        mode,
        generatedAt: new Date().toISOString()
      };
    }
  } catch (error) {
    console.warn("Copilot primary GenAI call failed, trying fast model.", error.message);
  }

  const fastModel = getCoachModel();
  if (fastModel && fastModel !== model) {
    try {
      const externalInsight = await withTimeout(
        callExternalCopilot(prompt, {
          model: fastModel,
          maxTokens: mode === "live" ? 300 : 760
        }),
        Math.min(5000, timeoutMs)
      );
      if (externalInsight) {
        const insight = trimWords(externalInsight, COPILOT_REPLY_WORD_LIMIT);
        if (!completeInsight(insight)) {
          throw new Error("Fast GenAI model returned an incomplete copilot sentence");
        }
        return {
          insight,
          source: "oci-genai-fast",
          model: fastModel,
          modelLabel: modelLabel(fastModel),
          latencyMs: Date.now() - started,
          mode,
          generatedAt: new Date().toISOString()
        };
      }
    } catch (error) {
      console.warn("Copilot fast GenAI call failed, using deterministic fallback.", error.message);
    }
  }

  return {
    insight: deterministicInsight(context),
    source: "fallback",
    model: "deterministic",
    modelLabel: "Deterministic fallback",
    latencyMs: Date.now() - started,
    mode,
    generatedAt: new Date().toISOString()
  };
}

export async function createLeaderboardCardInsights(entries = []) {
  const topEntries = topByScore(entries, 2);
  const fallbackCards = topEntries.map((entry, index) => deterministicCardInsight(entry, index));

  if (topEntries.length === 0) {
    return {
      cards: [],
      source: "fallback",
      model: "deterministic",
      modelLabel: "Deterministic fallback",
      latencyMs: 0,
      generatedAt: new Date().toISOString()
    };
  }

  const signature = cardInsightSignature(topEntries);
  const cached = cardInsightCache.get(signature);
  if (cached) {
    return {
      ...cached,
      cached: true
    };
  }

  const started = Date.now();
  const model = getCardInsightModel();
  const fastModel = getCoachModel();
  const prompt = buildCardInsightPrompt(topEntries);
  const timeoutMs = Number(process.env.OCI_GENAI_CARD_TIMEOUT_MS ?? DEFAULT_CARD_INSIGHT_TIMEOUT_MS);

  const analyzeCardsWithModel = async (modelId, source, timeout) => {
    const externalInsight = await withTimeout(
      callExternalCopilot(prompt, {
        model: modelId,
        maxTokens: 420
      }),
      timeout
    );
    const parsed = parseJsonArray(externalInsight);
    if (!parsed) {
      throw new Error("Leaderboard card GenAI did not return JSON");
    }

    const cards = topEntries.map((entry, index) => sanitizeCardInsight(parsed[index], entry, index));
    return {
      cards,
      source,
      model: modelId,
      modelLabel: modelLabel(modelId),
      latencyMs: Date.now() - started,
      generatedAt: new Date().toISOString()
    };
  };

  try {
    const result = await analyzeCardsWithModel(
      model,
      "oci-genai",
      Math.min(timeoutMs, COPILOT_GATEWAY_SAFE_TIMEOUT_MS)
    );
    cacheCardInsight(signature, result);
    return result;
  } catch (error) {
    console.warn("Leaderboard card primary GenAI call failed, trying fast model.", error.message);
  }

  if (fastModel && fastModel !== model) {
    try {
      const result = await analyzeCardsWithModel(
        fastModel,
        "oci-genai-fast",
        Math.min(5000, timeoutMs, COPILOT_GATEWAY_SAFE_TIMEOUT_MS)
      );
      cacheCardInsight(signature, result);
      return result;
    } catch (error) {
      console.warn(
        "Leaderboard card fast GenAI call failed, using deterministic fallback.",
        error.message
      );
    }
  }

  const result = {
    cards: fallbackCards,
    source: "fallback",
    model: "deterministic",
    modelLabel: "Deterministic fallback",
    latencyMs: Date.now() - started,
    generatedAt: new Date().toISOString()
  };
  return result;
}

export async function createCoachReply({ level, questionId, message = "", attemptCount = 0 } = {}) {
  const context = getCoachQuestion(questionId);
  if (!context || Number(level) !== context.level) {
    return null;
  }

  const prompt = buildCoachPrompt({ context, message, attemptCount });

  try {
    const timeoutMs = Number(
      process.env.OCI_GENAI_COACH_TIMEOUT_MS ?? DEFAULT_COACH_GENAI_TIMEOUT_MS
    );
    const externalReply = await withTimeout(
      callExternalCopilot(prompt, {
        model: getCoachModel(),
        maxTokens: 120
      }),
      timeoutMs
    );
    if (externalReply) {
      return {
        questionId,
        reply: trimWords(externalReply, COACH_REPLY_WORD_LIMIT),
        source: "oci-genai"
      };
    }
  } catch (error) {
    console.warn("Coach external call failed, using deterministic fallback.", error.message);
  }

  return {
    questionId,
    reply: fallbackCoachReply(questionId, attemptCount),
    source: "fallback"
  };
}
