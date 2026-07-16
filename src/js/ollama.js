// Ollama client: card generation with structured JSON output.

const GEN_TIMEOUT_MS = 120000;

/**
 * Keep the app's Ollama API the same in both targets. The browser build uses
 * fetch directly; Electron asks its context-isolated preload bridge to make
 * the request in the main process, where browser CORS restrictions do not
 * apply.
 */
async function ollamaFetch(url, path, options = {}) {
  const desktop = window.aiAgainstHumanityDesktop?.ollama;
  if (!desktop) return fetch(`${url.replace(/\/+$/, "")}${path}`, options);

  const body = await desktop.request({ url, path, ...options });
  return {
    ok: true,
    status: 200,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

/** Parse model output, repairing the escape/wrapper quirks small models produce. */
function parseModelJSON(text) {
  try { return JSON.parse(text); } catch (e) {}
  // sometimes the whole object arrives pre-escaped: {\"cards\": [\"...\"]}
  try { return JSON.parse(text.replace(/\\"/g, '"').replace(/\\n/g, " ")); } catch (e) {}
  // last resort: grab the outermost {...} block (strips prose wrappers)
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
  throw new Error("model returned unparseable JSON");
}

async function chatJSON(url, model, systemPrompt, userPrompt, schema) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEN_TIMEOUT_MS);
    try {
      const res = await ollamaFetch(url, "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          stream: false,
          think: false, // thinking models (e.g. qwen3.5) burn their output budget on reasoning otherwise
          format: schema,
          options: { temperature: 1.15, top_p: 0.95 },
          keep_alive: "15m",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`);
        err.status = res.status; // 404 = model not installed
        throw err; // server errors are not retried — rethrown below
      }
      const data = await res.json();
      return parseModelJSON(data.message.content);
    } catch (err) {
      lastErr = err;
      if (err.status) throw err;      // HTTP error: retrying won't change it
      // bad JSON or timeout: one more sample often fixes it
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

const CARDS_SCHEMA = {
  type: "object",
  properties: {
    cards: { type: "array", items: { type: "string" } },
  },
  required: ["cards"],
};

const SYSTEM_PROMPT =
  "You are the card writer for 'AI Against Humanity', an adult party game in the style of " +
  "Cards Against Humanity. Your job is to write original, funny, absurd, irreverent cards. " +
  "Dark humor, awkward situations, pop culture, and everyday embarrassments are all fair game. " +
  "Every card must be original — never copy real Cards Against Humanity cards. " +
  "Vary the topics widely. Write every card in English ONLY — no Chinese or any other " +
  "language, ever. Respond ONLY with JSON.";

// A few random flavor nudges so back-to-back batches don't converge on the same topics.
const FLAVORS = [
  "everyday life and awkward social situations",
  "technology, the internet, and modern life",
  "food, animals, and nature gone wrong",
  "history, science, and school",
  "relationships, family, and holidays",
  "work, money, and terrible decisions",
  "pop culture, movies, and celebrities",
  "health, the human body, and aging",
];

function pickFlavors(n = 3) {
  const shuffled = [...FLAVORS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n).join("; ");
}

/** Generate white (answer) cards. Returns array of strings. */
export async function generateWhiteCards(settings, count, avoid = []) {
  const avoidNote = avoid.length
    ? `\nDo NOT reuse or closely paraphrase any of these existing cards: ${JSON.stringify(avoid.slice(-40))}`
    : "";
  const user =
    `Write ${count} WHITE answer cards. Each is a short noun phrase or gerund phrase ` +
    `(2 to 8 words) that answers a question or fills a blank. Examples of the FORM (not the content): ` +
    `"Aggressively parallel parking.", "A lifetime supply of regret.", "Grandma's secret browser history." ` +
    `Punchy, specific, and funny on its own. Mix subjects; lean into: ${pickFlavors()}.` +
    avoidNote +
    `\nReturn JSON: {"cards": ["...", ...]} with exactly ${count} entries.`;
  const out = await chatJSON(settings.ollamaUrl, settings.model, SYSTEM_PROMPT, user, CARDS_SCHEMA);
  return cleanCards(out.cards, "white");
}

/** Generate black (prompt) cards. Returns array of strings containing one blank "_____". */
export async function generateBlackCards(settings, count, avoid = []) {
  const avoidNote = avoid.length
    ? `\nDo NOT reuse or closely paraphrase any of these existing prompts: ${JSON.stringify(avoid.slice(-20))}`
    : "";
  const user =
    `Write ${count} BLACK prompt cards. Each is either a sentence containing exactly ONE blank ` +
    `written as five underscores "_____", or a short question that a noun phrase can answer. ` +
    `Examples of the FORM (not the content): "I lost my job because of _____.", ` +
    `"What's the latest fitness craze?", "Scientists have finally discovered _____." ` +
    `One blank maximum per card. Mix subjects; lean into: ${pickFlavors()}.` +
    avoidNote +
    `\nReturn JSON: {"cards": ["...", ...]} with exactly ${count} entries.`;
  const out = await chatJSON(settings.ollamaUrl, settings.model, SYSTEM_PROMPT, user, CARDS_SCHEMA);
  return cleanCards(out.cards, "black");
}

// The form examples shown in the prompts — small models sometimes copy them verbatim.
const EXAMPLE_CARDS = new Set([
  "aggressively parallel parking.",
  "a lifetime supply of regret.",
  "grandma's secret browser history.",
  "i lost my job because of _____.",
  "what's the latest fitness craze?",
  "scientists have finally discovered _____.",
]);

function cleanCards(cards, kind) {
  if (!Array.isArray(cards)) return [];
  const seen = new Set();
  const result = [];
  for (let c of cards) {
    if (typeof c !== "string") continue;
    c = c.replace(/\s+/g, " ").trim();
    // long cards render tiny on phones — reject rambles, the model just writes another
    if (!c || c.length > (kind === "black" ? 110 : 80)) continue;
    // English only: Qwen models occasionally slip into CJK — drop those cards outright
    if (/[⺀-鿿぀-ヿ가-힯豈-﫿！-｠]/.test(c)) continue;
    if (kind === "black") {
      // normalize any run of 3+ underscores to the standard blank
      c = c.replace(/_{3,}/g, "_____");
      const blanks = (c.match(/_____/g) || []).length;
      if (blanks > 1) continue;                 // multi-blank not supported yet
      if (blanks === 0 && !c.includes("?")) continue; // must be a question or have a blank
    } else {
      c = c.replace(/^["']|["']$/g, "");
      if (c.includes("_____")) continue;
    }
    const key = c.toLowerCase();
    if (seen.has(key) || EXAMPLE_CARDS.has(key)) continue;
    seen.add(key);
    result.push(c);
  }
  return result;
}

/** List model names available on the server. */
export async function listModels(url) {
  const res = await ollamaFetch(url, "/api/tags", { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.models || []).map((m) => m.name);
}

/** Quick health check; verifies server and (optionally) that the model exists. */
export async function testConnection(url, model) {
  try {
    const models = await listModels(url);
    if (model && !models.includes(model)) {
      return { ok: false, message: `Server OK, but model "${model}" is not installed. Run: ollama pull ${model} — or pick an installed model in Settings.` };
    }
    return { ok: true, message: `Connected — ${models.length} models available.` };
  } catch (err) {
    return { ok: false, message: "Cannot reach Ollama server." };
  }
}
