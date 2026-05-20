import { telemetry } from "./ociRuntime.js";

const RANK_RETRY_DELAYS_MS = [700, 1800, 3200, 5200];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatScore(value) {
  return new Intl.NumberFormat("en-US").format(Number(value ?? 0));
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

  return {
    rank: null,
    total: latestResult?.total ?? 0,
    leader: latestResult?.leader ?? null
  };
}
