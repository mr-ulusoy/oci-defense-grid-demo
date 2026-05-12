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
        maxCompletionTokens: 80,
        temperature: 0.2,
        frequencyPenalty: 0,
        presencePenalty: 0
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
        return common.InstancePrincipalsAuthenticationDetailsProvider.builder().build();
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
  const response = await client.chat(buildSdkChatRequest(prompt));
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
