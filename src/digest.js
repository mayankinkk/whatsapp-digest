import { chat } from "./ollama.js";

const KEY = /due|deadline|submit|exam|quiz|test|demo|assign|project|viva|report|presentation|defence|defense|attendance|marks|result|schedule|tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|eod|\b\d{1,2}\s*(?:\/|-)\s*\d{1,2}\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const clip = (s, max = 12000) => (s.length > max ? s.slice(0, max) : s);

function formatMessages(messages, limit = 400) {
  return messages.slice(-limit).map((m) => {
    const d = m.timestamp;
    const text = m.text.replace(/\n/g, " ").slice(0, 300);
    return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())} ${m.sender}: ${text}`;
  }).join("\n");
}

// Deterministic date resolution relative to the message's own date.
function resolveLineDates(text, lineDate) {
  const found = new Set();
  const lower = text.toLowerCase();
  const year = lineDate.getFullYear();

  if (/\btomorrow\b/.test(lower)) found.add(ymd(addDays(lineDate, 1)));
  if (/\btoday\b/.test(lower) || /\btonight\b/.test(lower)) found.add(ymd(lineDate));

  for (let i = 0; i < 7; i++) {
    const re = new RegExp(`\\b${WEEKDAYS[i]}\\b`, "i");
    if (re.test(lower)) {
      const cur = lineDate.getDay();
      let delta = (i - cur + 7) % 7;
      if (delta === 0) delta = 7;
      found.add(ymd(addDays(lineDate, delta)));
    }
  }

  // "Oct 15", "october 4", "4 october"
  let m = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/);
  if (m && MONTHS[m[1]]) found.add(ymd(new Date(year, MONTHS[m[1]] - 1, Number(m[2]))));
  m = lower.match(/\b(\d{1,2})\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*/);
  if (m && MONTHS[m[2]]) found.add(ymd(new Date(year, MONTHS[m[2]] - 1, Number(m[1]))));

  // d/m or m/d where unambiguous (>12 means day)
  m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) found.add(ymd(new Date(year, b - 1, a)));
    else if (b > 12 && a <= 12) found.add(ymd(new Date(year, a - 1, b)));
  }

  return [...found];
}

function pickCandidates(messages) {
  const out = [];
  for (const m of messages) {
    if (m.isSystem) continue;
    const flat = m.text.replace(/\n/g, " ");
    if (!KEY.test(flat)) continue;
    out.push({
      date: ymd(m.timestamp),
      sender: m.sender,
      text: flat.slice(0, 200),
      dates: resolveLineDates(flat, m.timestamp),
    });
    if (out.length >= 25) break;
  }
  return out;
}

function buildExtractPrompt(candidates) {
  const lines = candidates.map((c, i) => `${i + 1}. ${c.date} ${c.sender}: ${c.text}`).join("\n");
  return `Pick the important WhatsApp lines (deadlines, exams, events, tasks). Output ONLY a JSON array of objects with 2 keys: n (line number) and k (single letter: a=assignment/submit, e=exam/quiz, v=event/demo/meeting, t=task). Skip casual lines. Example: [{"n": 2, "k": "a"}, {"n": 5, "k": "e"}]

LINES:
${lines}`;
}

// Fallback when the model output is unusable: heuristic relevance + kind from keywords.
function inferKind(text) {
  const t = text.toLowerCase();
  if (/\bexam\b|\bviva\b|mid-?sem|\bquiz\b/.test(t)) return "e";
  if (/^[a-z][a-z ]{1,30}:\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(t)) return "e";
  if (/submit|deadline|\bdue\b|assignment|\bhw\b|proposal submission/.test(t)) return "a";
  if (/\bdemo\b|\bmeeting\b|party|event|hangout|\bfunction\b/.test(t)) return "v";
  return "t";
}

function buildSummaryPrompt(deadlineFacts, rawText) {
  const facts = deadlineFacts.length ? `\nKNOWN DEADLINES (trust these dates): ${deadlineFacts.join("; ")}\n` : "";
  return `Summarize this WhatsApp group in 2 short sentences (max 45 words). Only facts from the chat. Do not invent dates.${facts}
CHAT:
${rawText}`;
}

function coerceArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return [v];
  if (typeof v === "string" && v.trim()) return [{ what: v.trim() }];
  return [];
}

function str(v, fallback = "") {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return fallback;
}

function validDate(v, allowed) {
  const s = str(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (allowed && allowed.includes(s)) return s;
  if (allowed && allowed.length === 1) return allowed[0];
  return "";
}

// Small models echo prompt text into fields; reject those and derive from the line instead.
const ECHO_RE = /line number|kind\b|assignment\||YYYY|short task name|short tasks with|or empty|\|/i;
function cleanWhat(modelWhat, candText) {
  const m = str(modelWhat);
  if (m && m.length >= 3 && m.length <= 80 && !ECHO_RE.test(m)) return m;
  const base = candText
    .replace(/\[\s*date:[^\]]*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s:,\-–]+$/, "")
    .trim();
  return (base || candText).slice(0, 70);
}

// Small models return odd shapes: column-style {"n":[1,2],"kind":[...]},
// wrapped {"LINES":[...]}, single objects. Coerce everything to row objects.
function toRows(raw) {
  if (Array.isArray(raw)) {
    return raw.map((x) => (x && typeof x === "object" ? x : { what: str(x) }));
  }
  if (!raw || typeof raw !== "object") return [];

  // Unwrap {"LINES": [...]} / any single key whose value is an array of objects
  const vals = Object.values(raw);
  if (vals.length === 1 && Array.isArray(vals[0])) return toRows(vals[0]);
  if (Object.keys(raw).some((k) => Array.isArray(raw[k]) && k.toLowerCase() !== "n" && k.toLowerCase() !== "k")) {
    const arrKey = Object.keys(raw).find((k) => Array.isArray(raw[k]));
    return toRows(raw[arrKey]);
  }

  const keys = ["n", "k", "kind", "what", "due"];
  const cols = {};
  for (const k of keys) if (k in raw) cols[k] = raw[k];

  const isArrayCol = Object.values(cols).some((v) => Array.isArray(v));
  if (isArrayCol) {
    const len = Math.max(...Object.values(cols).map((v) => (Array.isArray(v) ? v.length : 1)));
    const rows = [];
    for (let i = 0; i < len; i++) {
      const row = {};
      for (const [k, v] of Object.entries(cols)) row[k] = Array.isArray(v) ? v[i] : v;
      rows.push(row);
    }
    return rows;
  }
  return [raw];
}

const KIND_MAP = { a: "assignment", e: "exam", v: "event", t: "task", assignment: "assignment", exam: "exam", event: "event", task: "task", none: "none" };

function normalize(raw, candidates) {
  const byN = new Map();
  for (const item of toRows(raw)) {
    const n = Number(item.n);
    if (!isNaN(n) && n >= 1 && n <= candidates.length) {
      const kLetter = str(item.k) || str(item.kind);
      const mapped = KIND_MAP[kLetter.toLowerCase()];
      if (mapped && mapped !== "none") byN.set(n, mapped);
    }
  }

  const digest = { deadlines: [], assignments: [], exams: [], actionItems: [], importantUpdates: [], summary: "" };

  candidates.forEach((c, i) => {
    const n = i + 1;
    // Union: never drop a line with a resolved date, even if the model missed it.
    const kind = byN.get(n) || (c.dates.length ? KIND_MAP[inferKind(c.text)] : null);
    if (!kind || kind === "none") return;
    const what = cleanWhat("", c.text);
    const due = c.dates.length ? [...c.dates].sort()[0] : "";

    if (kind === "assignment") {
      digest.assignments.push({ what, due: due || "unknown", notes: "" });
      if (due) digest.deadlines.push({ what, due, source: c.sender, confidence: "high" });
    } else if (kind === "exam") {
      const dates = c.dates.length ? c.dates : [""];
      for (const dt of dates) {
        digest.exams.push({ what, when: dt || "unknown", notes: "" });
        if (dt) digest.deadlines.push({ what, due: dt, source: c.sender, confidence: "high" });
      }
    } else if (kind === "event") {
      digest.importantUpdates.push(what + (due ? ` (${due})` : ""));
      if (due) digest.deadlines.push({ what, due, source: c.sender, confidence: "high" });
    } else if (kind === "task") {
      digest.actionItems.push({ what, who: c.sender, needsAction: due ? `by ${due}` : "check chat for details" });
    }
  });

  const seen = new Set();
  digest.deadlines = digest.deadlines.filter((d) => {
    const k = d.what + d.due;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  digest.deadlines.sort((a, b) => a.due.localeCompare(b.due));

  return digest;
}

// Drop summary sentences that mention dates/times never present in the chat.
function sanitizeSummary(text, allowedDates, body = "") {
  if (!text) return "";
  const allowed = new Set(allowedDates);
  const bodyNorm = body ? normText(body) : null;
  const sentences = text.match(/[^.!?\n]+[.!?]?/g) || [text];
  const year = new Date().getFullYear();
  const monthNum = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const ok = [];
  const bad = [];
  const allowedMonths = new Set(allowedDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).map((d) => Number(d.slice(5, 7))));
  const monthOk = (phrase) => {
    const mm = phrase.toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})/);
    if (!mm || !monthNum[mm[1]]) return true;
    return allowed.has(`${year}-${pad(monthNum[mm[1]])}-${pad(Number(mm[2]))}`);
  };
  for (const s of sentences) {
    let valid = true;
    for (const iso of s.match(/\d{4}-\d{2}-\d{2}/g) || []) {
      if (!allowed.has(iso)) { valid = false; bad.push(iso); }
    }
    const m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?/gi) || [];
    for (const phrase of m) {
      if (!monthOk(phrase)) { valid = false; bad.push(phrase); }
    }
    // Bare month names (no day) are only OK if that month appears in an allowed date.
    const bare = s.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b(?!\s*\.?\s*\d)/gi) || [];
    for (const phrase of bare) {
      const key = phrase.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3);
      if (monthNum[key] && !allowedMonths.has(monthNum[key])) { valid = false; bad.push(phrase); }
    }
    if (bodyNorm) {
      for (const t of s.match(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b|\b\d{1,2}\s*(?:am|pm)\b/gi) || []) {
        if (!bodyNorm.includes(normText(t))) { valid = false; bad.push(t); }
      }
    }
    if (valid) ok.push(s.trim());
  }
  if (ok.length) return ok.join(" ").trim();
  // Every sentence had a bad date: keep the text but strip the offending date phrases.
  let t = text;
  for (const p of bad) t = t.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
  t = t.replace(/\s+/g, " ").replace(/\s+([,.;!?])/g, "$1").trim();
  return t;
}

const normText = (s) => s.toLowerCase()
  .replace(/\s+/g, "")
  .replace(/(\d+)(?:st|nd|rd|th)/g, "$1")
  .replace(/:00/g, "");

// True when every time/date mentioned in `text` also appears in the chat bodies.
function groundedIn(text, body) {
  const b = normText(body);
  const times = text.match(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b|\b\d{1,2}\s*(?:am|pm)\b/gi) || [];
  if (times.some((t) => !b.includes(normText(t)))) return false;
  const dates = text.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{1,2}(?:st|nd|rd|th)?\b/gi) || [];
  if (dates.some((d) => !b.includes(normText(d)))) return false;
  return true;
}

function extractJson(text) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const first = text.indexOf("[");
  const firstBrace = text.indexOf("{");
  const start = first !== -1 && (firstBrace === -1 || first < firstBrace) ? first : firstBrace;
  const lastArr = text.lastIndexOf("]");
  const lastObj = text.lastIndexOf("}");
  const last = Math.max(lastArr, lastObj);
  if (start !== -1 && last > start) {
    try { return JSON.parse(text.slice(start, last + 1)); } catch {}
  }
  return [];
}

async function generateDigest(messages) {
  const candidates = pickCandidates(messages);
  const rawText = clip(formatMessages(messages));

  let extraction = [];
  if (candidates.length) {
    try {
      const resp = await chat([{ role: "user", content: buildExtractPrompt(candidates) }], { temperature: 0.1, json: true, numPredict: 700, repeatPenalty: 1.3 });
      extraction = extractJson(resp);
    } catch (err) {
      console.error("Extraction failed:", err.message);
    }
  }

  const digest = normalize(extraction, candidates);

  let summary = "";
  try {
    const facts = digest.deadlines.map((d) => `${d.what} due ${d.due}`);
    const resp = await chat([{ role: "user", content: buildSummaryPrompt(facts, rawText) }], { temperature: 0.1, numPredict: 100, repeatPenalty: 1.4 });
    let s = resp.replace(/^["'\s]+|["'\s]+$/g, "").trim();
    s = s.split(/\n\s*\n/)[0];
    s = s.split(/(?<=[.!?])\s+(?=This summary|The summary|This captures)/)[0];
    if (s.length > 300) s = s.slice(0, 300).replace(/\s+\S*$/, "") + "…";
    const allowed = [...candidates.flatMap((c) => c.dates), ...digest.deadlines.map((d) => d.due), ...digest.exams.map((e) => e.when)];
    summary = sanitizeSummary(s, allowed, messages.map((m) => m.text).join("\n"));
  } catch (err) {
    console.error("Summary failed:", err.message);
  }

  digest.summary = summary;
  return digest;
}

function buildWeeklyPrompt(rawText) {
  return `Summarize what a person missed in this WhatsApp week. JSON only with exactly these keys:
{"keyAnnouncements": ["..."], "missedDeadlines": ["..."], "socialEvents": ["..."], "oneLiner": "one sentence"}
Arrays of strings. Only facts from the chat. Empty arrays if none. oneLiner max 20 words.

CHAT:
${rawText}`;
}

function normalizeWeekly(raw) {
  const out = {
    keyAnnouncements: coerceArray(raw?.keyAnnouncements).map((x) => str(x)).filter(Boolean).slice(0, 8),
    missedDeadlines: coerceArray(raw?.missedDeadlines).map((x) => str(x)).filter(Boolean).slice(0, 8),
    assignmentsDue: coerceArray(raw?.assignmentsDue).map((x) => typeof x === "object" ? { what: str(x.what), due: str(x.due) } : { what: str(x), due: "" }).filter((x) => x.what).slice(0, 8),
    socialEvents: coerceArray(raw?.socialEvents).map((x) => str(x)).filter(Boolean).slice(0, 8),
    dramaOrConflicts: coerceArray(raw?.dramaOrConflicts).map((x) => str(x)).filter(Boolean).slice(0, 5),
    oneLiner: str(raw?.oneLiner),
  };
  return out;
}

async function generateWeeklyDigest(messages) {
  const rawText = clip(formatMessages(messages, 250));
  let raw = {};
  try {
    const resp = await chat([{ role: "user", content: buildWeeklyPrompt(rawText) }], { temperature: 0.2, json: true, numPredict: 500, repeatPenalty: 1.3 });
    raw = extractJson(resp);
  } catch (err) {
    console.error("Weekly failed:", err.message);
  }
  const out = normalizeWeekly(raw);
  const body = messages.map((m) => m.text).join("\n");
  const keep = (arr) => arr.filter((x) => groundedIn(x, body));
  out.keyAnnouncements = keep(out.keyAnnouncements);
  out.missedDeadlines = keep(out.missedDeadlines);
  out.socialEvents = keep(out.socialEvents);
  out.dramaOrConflicts = keep(out.dramaOrConflicts);
  out.assignmentsDue = out.assignmentsDue.filter((a) => groundedIn(a.what, body));
  if (out.oneLiner && !groundedIn(out.oneLiner, body)) out.oneLiner = "";
  return out;
}

export { generateDigest, generateWeeklyDigest, resolveLineDates, pickCandidates, inferKind, normalize, toRows };
