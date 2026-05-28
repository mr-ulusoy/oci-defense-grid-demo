import { telemetry } from "./ociRuntime.js";

const RANK_RETRY_DELAYS_MS = [700, 1800, 3200, 5200];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatScore(value) {
  return new Intl.NumberFormat("en-US").format(Number(value ?? 0));
}

function rankFromLeaderboard(entries = [], target = {}, latestResult = null) {
  const ranked = [...entries].sort(
    (left, right) =>
      Number(right.score ?? 0) - Number(left.score ?? 0) ||
      Date.parse(left.createdAt ?? 0) - Date.parse(right.createdAt ?? 0)
  );
  const numericScore = Number(target.score);
  const targetIndex = ranked.findIndex((entry) => {
    if (target.runId && entry.runId) {
      return entry.runId === target.runId;
    }

    return (
      String(entry.callsign ?? "").toUpperCase() === String(target.callsign ?? "").toUpperCase() &&
      Number(entry.score ?? 0) === numericScore
    );
  });

  if (targetIndex >= 0) {
    return {
      rank: targetIndex + 1,
      total: ranked.length,
      source: "leaderboardFallback",
      leader: ranked[0] ?? latestResult?.leader ?? null
    };
  }

  if (!Number.isFinite(numericScore)) {
    return null;
  }

  return {
    rank: ranked.filter((entry) => Number(entry.score ?? 0) > numericScore).length + 1,
    total: ranked.length + 1,
    source: "scoreEstimate",
    leader: ranked[0] ?? latestResult?.leader ?? null
  };
}

export async function fetchGlobalLeaderboardRank(target = {}) {
  let latestResult = null;
  const query = new URLSearchParams();
  if (target.runId) query.set("runId", target.runId);
  if (target.callsign) query.set("callsign", target.callsign);
  if (Number.isFinite(Number(target.score))) query.set("score", String(Number(target.score)));

  for (const delay of [0, ...RANK_RETRY_DELAYS_MS]) {
    if (delay > 0) {
      await wait(delay);
    }

    try {
      const response = await fetch(`${telemetry.apiBase}/leaderboard/rank?${query.toString()}`);
      latestResult = await response.json();
      if (response.ok && latestResult?.rank) {
        return latestResult;
      }
    } catch {
      // End screens should stay calm if the API is still ingesting the final run.
    }
  }

  try {
    const entries = await telemetry.refreshLeaderboard();
    const fallbackRank = rankFromLeaderboard(entries, target, latestResult);
    if (fallbackRank?.rank) {
      return fallbackRank;
    }
  } catch {
    // The end screen still has the score, so keep the UI out of a permanent pending state.
  }

  return {
    rank: Number.isFinite(Number(target.score)) ? 1 : null,
    total: Number.isFinite(Number(target.score)) ? 1 : latestResult?.total ?? 0,
    source: "localScoreFallback",
    leader: latestResult?.leader ?? null
  };
}
