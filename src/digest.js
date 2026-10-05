import { chat } from "./ollama.js";

function formatMessages(messages, limit = 400) {
  const slice = messages.slice(-limit);
  return slice
    .map((m) => {
      const ts = m.timestamp.toISOString();
      return `[${ts}] ${m.sender}: ${m.text}`;
    })
    .join("\n");
}

function buildDigestPrompt(rawText) {
  return `You are a WhatsApp group digest assistant. A college student muted their group and is catching up. Parse the chat below and return ONLY valid JSON (no markdown fences, no explanation).

Today's date: ${new Date().toISOString().slice(0, 10)}

For relative dates like "tomorrow", "next week", "Friday" — resolve them using the timestamp of the message they appear in, and today's date above.

Return this JSON structure:
{
  "deadlines": [
    {"what": "...", "due": "YYYY-MM-DD or as stated", "source": "who mentioned it", "confidence": "high|medium|low"}
  ],
  "assignments": [
    {"what": "...", "due": "YYYY-MM-DD or as stated", "notes": "any extra context"}
  ],
  "exams": [
    {"what": "...", "when": "YYYY-MM-DD or as stated", "notes": "..."}
  ],
  "actionItems": [
    {"what": "...", "who": "person who said it", "needsAction": "what the reader should do"}
  ],
  "importantUpdates": ["one-line summaries of important non-deadline announcements"],
  "summary": "3-5 sentence overview of what happened in this group chat"
}

Rules:
- Only include REAL deadlines/assignments/exams mentioned in the chat.
- If someone says "submit by tomorrow" and the message timestamp is 2026-10-01, due = 2026-10-02.
- Skip casual conversation, memes, stickers, media omitted lines.
- If nothing found for a category, return an empty array.
- Respond with raw JSON only.

CHAT:
${rawText}`;
}

function buildWeeklyPrompt(rawText) {
  return `You are a WhatsApp group digest assistant. The reader missed the past week of this group chat. Return ONLY valid JSON (no markdown fences).

Today's date: ${new Date().toISOString().slice(0, 10)}

Return this JSON structure:
{
  "missedDeadlines": ["deadlines or events that passed or were announced this week"],
  "keyAnnouncements": ["important announcements the reader should know about"],
  "assignmentsDue": [{"what": "...", "due": "..."}],
  "socialEvents": ["hangouts, parties, events mentioned"],
  "dramaOrConflicts": ["any conflict or hot discussion, if notable"],
  "oneLiner": "one-sentence summary of the week"
}

Rules:
- Only include what actually happened in this chat.
- Resolve relative dates using message timestamps.
- Skip casual chatter unless notable.
- Respond with raw JSON only.

CHAT:
${rawText}`;
}

function extractJson(text) {
  // Try direct parse
  try { return JSON.parse(text); } catch {}

  // Try to extract JSON from markdown fences or surrounding text
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch {}
  }

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }

  throw new Error("Could not extract JSON from model response");
}

async function generateDigest(messages) {
  const rawText = formatMessages(messages);
  const prompt = buildDigestPrompt(rawText);
  const response = await chat([{ role: "user", content: prompt }], { temperature: 0.2 });
  return extractJson(response);
}

async function generateWeeklyDigest(messages) {
  const rawText = formatMessages(messages);
  const prompt = buildWeeklyPrompt(rawText);
  const response = await chat([{ role: "user", content: prompt }], { temperature: 0.3 });
  return extractJson(response);
}

export { generateDigest, generateWeeklyDigest };
