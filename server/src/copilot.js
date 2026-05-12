const FALLBACK_INSIGHTS = [
  "Traffic pressure is steady. Keep the Load Balancer path active and preserve shields for the next spike.",
  "Latency remains inside demo range. VM routing looks healthy while event volume builds.",
  "The latest wave looks like a short anomaly burst. Streaming ingest should absorb it cleanly.",
  "Score velocity is rising. This is a good moment to show API Gateway throttling and backend identity."
];

function deterministicInsight({ snapshot, analytics, vm }) {
  const eps = Number(analytics?.eventsPerSecond ?? snapshot?.eventsPerSecond ?? 0);
  const score = Number(snapshot?.score ?? 0);
  const level = Number(snapshot?.level ?? 1);

  if (eps > 4) {
    return `High telemetry rate detected at level ${level}. API Gateway should throttle bursts while Streaming buffers the event flow.`;
  }
  if (score > 5000) {
    return `Defense score is strong on ${vm.name}. Keep routing balanced and use the leaderboard view to show Autonomous Database updates.`;
  }
  if (level >= 3) {
    return `Anomaly level ${level} is active. Watch VM latency and call out Load Balancer failover readiness.`;
  }

  return FALLBACK_INSIGHTS[Math.floor(Math.random() * FALLBACK_INSIGHTS.length)];
}

async function callExternalCopilot(prompt) {
  if (!process.env.OCI_GENAI_ENDPOINT || !process.env.OCI_GENAI_BEARER_TOKEN) {
    return null;
  }

  const response = await fetch(process.env.OCI_GENAI_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OCI_GENAI_BEARER_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt,
      maxTokens: 80,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`OCI GenAI endpoint returned ${response.status}`);
  }

  const payload = await response.json();
  return payload.insight ?? payload.text ?? payload.choices?.[0]?.text ?? null;
}

export async function createCopilotInsight(context) {
  const prompt = [
    "You are the OCI Defense Grid live demo copilot.",
    "Write one concise customer-facing insight based on the current game and cloud telemetry.",
    `Context: ${JSON.stringify(context)}`
  ].join("\n");

  try {
    const externalInsight = await callExternalCopilot(prompt);
    if (externalInsight) {
      return externalInsight.trim().slice(0, 280);
    }
  } catch (error) {
    console.warn("Copilot external call failed, using deterministic fallback.", error.message);
  }

  return deterministicInsight(context);
}
