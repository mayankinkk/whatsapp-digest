const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const PREFERRED_MODEL = process.env.OLLAMA_MODEL || "gemma3:4b";
let resolvedModel = null;

async function listModels() {
  const res = await fetch(`${OLLAMA_URL}/api/tags`);
  if (!res.ok) throw new Error(`Ollama not reachable at ${OLLAMA_URL}`);
  return res.json();
}

async function resolveModel() {
  if (resolvedModel) return resolvedModel;
  try {
    const data = await listModels();
    const names = (data.models || []).map((m) => m.name);
    if (names.includes(PREFERRED_MODEL)) {
      resolvedModel = PREFERRED_MODEL;
    } else if (names.length > 0) {
      resolvedModel = names[0];
      console.log(`Model "${PREFERRED_MODEL}" not found, using "${resolvedModel}"`);
    } else {
      resolvedModel = PREFERRED_MODEL;
    }
  } catch {
    resolvedModel = PREFERRED_MODEL;
  }
  return resolvedModel;
}

async function chat(messages, options = {}) {
  const model = await resolveModel();
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.3,
        num_predict: options.numPredict ?? 2048,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama error: ${err}`);
  }

  const data = await res.json();
  return data.message?.content || "";
}

export { OLLAMA_URL, PREFERRED_MODEL, resolveModel, listModels, chat };
