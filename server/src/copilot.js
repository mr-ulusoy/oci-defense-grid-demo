import os from "node:os";

const FALLBACK_INSIGHTS = [
  "Traffic pressure is steady. Keep the Load Balancer path active and preserve shields for the next spike.",
  "Latency remains inside demo range. VM routing looks healthy while event volume builds.",
  "The latest wave looks like a short anomaly burst. Streaming ingest should absorb it cleanly.",
  "Score velocity is rising. This is a good moment to show API Gateway throttling and backend identity."
];

const DEFAULT_GENAI_ENDPOINT = "https://inference.generativeai.eu-frankfurt-1.oci.oraclecloud.com";
const DEFAULT_GENAI_MODEL =
  "ocid1.generativeaimodel.oc1.eu-frankfurt-1.amaaaaaask7dceyan6gecfjovk7wtgl3r65b5tmpuegfxojbp2mebjgtvhra";
const DEFAULT_GENAI_TIMEOUT_MS = 25000;
const COACH_REPLY_WORD_LIMIT = 45;

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

function buildCopilotRequest(prompt) {
  const endpoint = process.env.OCI_GENAI_ENDPOINT ?? "";
  const model = process.env.OCI_GENAI_MODEL || DEFAULT_GENAI_MODEL;

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
      max_tokens: 80,
      temperature: 0.2
    };
  }

  if (endpoint.includes("/responses")) {
    return {
      model,
      input: prompt,
      max_output_tokens: 80,
      temperature: 0.2
    };
  }

  return {
    prompt,
    maxTokens: 80,
    temperature: 0.2
  };
}

function buildSdkChatRequest(prompt) {
  return {
    chatDetails: {
      compartmentId: process.env.OCI_GENAI_COMPARTMENT_OCID,
      servingMode: {
        modelId: process.env.OCI_GENAI_MODEL || DEFAULT_GENAI_MODEL,
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
        maxTokens: 1200,
        temperature: 0.2,
        frequencyPenalty: 0,
        presencePenalty: 0,
        topK: 1,
        topP: 0.95
      }
    }
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

async function callSdkCopilot(prompt) {
  if (!process.env.OCI_GENAI_COMPARTMENT_OCID) {
    return null;
  }

  const client = await getSdkClient();
  const common = await import("oci-common");
  const response = await client.chat({
    ...buildSdkChatRequest(prompt),
    retryConfiguration: common.NoRetryConfigurationDetails
  });
  return extractCopilotText(response);
}

async function callBearerCopilot(prompt) {
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
    body: JSON.stringify(buildCopilotRequest(prompt))
  });

  if (!response.ok) {
    throw new Error(`OCI GenAI endpoint returned ${response.status}`);
  }

  const payload = await response.json();
  return extractCopilotText(payload);
}

async function callExternalCopilot(prompt) {
  const endpoint = process.env.OCI_GENAI_ENDPOINT ?? "";

  if (endpoint.includes("/chat/completions") || endpoint.includes("/responses")) {
    return callBearerCopilot(prompt);
  }

  return callSdkCopilot(prompt);
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
  const prompt = [
    "You are the OCI Defense Grid live demo copilot.",
    "Return one complete customer-facing sentence under 22 words. No markdown.",
    `Context: ${JSON.stringify(context)}`
  ].join("\n");

  try {
    const timeoutMs = Number(process.env.OCI_GENAI_TIMEOUT_MS ?? DEFAULT_GENAI_TIMEOUT_MS);
    const externalInsight = await withTimeout(callExternalCopilot(prompt), timeoutMs);
    if (externalInsight) {
      return externalInsight.trim().slice(0, 280);
    }
  } catch (error) {
    console.warn("Copilot external call failed, using deterministic fallback.", error.message);
  }

  return deterministicInsight(context);
}

export async function createCoachReply({ level, questionId, message = "", attemptCount = 0 } = {}) {
  const context = getCoachQuestion(questionId);
  if (!context || Number(level) !== context.level) {
    return null;
  }

  const prompt = buildCoachPrompt({ context, message, attemptCount });

  try {
    const timeoutMs = Number(process.env.OCI_GENAI_TIMEOUT_MS ?? DEFAULT_GENAI_TIMEOUT_MS);
    const externalReply = await withTimeout(callExternalCopilot(prompt), timeoutMs);
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
