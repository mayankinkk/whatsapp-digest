let selectedFile = null;
let lastFull = null;

const $ = (id) => document.getElementById(id);

/* ---------------- status ---------------- */
async function checkStatus() {
  const pill = $("status-badge");
  const text = $("status-text");
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    if (data.ollama && data.models && data.models.length) {
      pill.className = "privacy-pill";
      text.textContent = "100% Private (Runs on your laptop)";
      const pretty = String(data.model || data.models[0]).replace(/:\d+b$/i, "").replace(/^(\w+)/, (m) => m[0].toUpperCase() + m.slice(1));
      $("model-name").textContent = pretty;
      $("footer-model").textContent = pretty;
    } else if (data.ollama) {
      pill.className = "privacy-pill bad";
      text.textContent = "No AI model found";
    } else {
      pill.className = "privacy-pill bad";
      text.textContent = "Local AI not running";
    }
  } catch {
    pill.className = "privacy-pill bad";
    text.textContent = "Server unreachable";
  }
}
checkStatus();

/* ---------------- file handling ---------------- */
const dropZone = $("drop-zone");
const fileInput = $("file-input");

$("choose-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});
dropZone.addEventListener("click", (e) => {
  if (e.target.closest("button")) return;
  fileInput.click();
});
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

$("sample-btn").addEventListener("click", async (e) => {
  e.stopPropagation();
  try {
    const res = await fetch("sample.txt");
    const text = await res.text();
    const file = new File([text], "chat_college_batch_export.txt", { type: "text/plain" });
    setFile(file);
  } catch {
    setFile(new File([""], "sample_unavailable.txt", { type: "text/plain" }));
  }
});

function setFile(file) {
  selectedFile = file;
  $("file-name").textContent = file.name;
  $("file-chip").classList.add("loaded");
  $("btn-digest").disabled = false;
  $("btn-weekly").disabled = false;
}

function clearFile() {
  selectedFile = null;
  fileInput.value = "";
  $("file-name").textContent = "chat_college_batch_export.txt";
  $("file-chip").classList.remove("loaded");
  $("btn-digest").disabled = true;
  $("btn-weekly").disabled = true;
}

/* ---------------- analyze ---------------- */
$("btn-digest").addEventListener("click", () => analyze("/api/digest", "full"));
$("btn-weekly").addEventListener("click", () => analyze("/api/weekly", "weekly"));
$("btn-weekly-2").addEventListener("click", () => analyze("/api/weekly", "weekly"));
$("btn-back").addEventListener("click", () => {
  if (lastFull) renderResults(lastFull, "full");
  else analyze("/api/digest", "full");
});
$("btn-reset").addEventListener("click", resetAll);
$("error-retry").addEventListener("click", resetAll);

function resetAll() {
  clearFile();
  lastFull = null;
  $("btn-back").classList.add("hidden");
  $("btn-weekly-2").classList.add("hidden");
  $("results").classList.add("hidden");
  $("weekly-result").classList.add("hidden");
  $("full-result").classList.remove("hidden");
  $("error").classList.add("hidden");
  $("upload-section").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function analyze(endpoint, mode) {
  if (!selectedFile) return;

  $("upload-section").classList.add("hidden");
  $("error").classList.add("hidden");
  $("results").classList.add("hidden");
  $("loading").classList.remove("hidden");
  $("loading-text").textContent =
    mode === "weekly" ? "Finding what you missed this week…" : "Extracting deadlines and key news…";

  const formData = new FormData();
  formData.append("chat", selectedFile);

  try {
    const res = await fetch(endpoint, { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong");

    $("loading").classList.add("hidden");
    renderResults(data, mode);
  } catch (err) {
    $("loading").classList.add("hidden");
    $("error").classList.remove("hidden");
    $("error-text").textContent = err.message;
  }
}

/* ---------------- rendering ---------------- */
function renderResults(data, mode) {
  $("results").classList.remove("hidden");
  if (mode === "weekly") {
    $("full-result").classList.add("hidden");
    $("weekly-result").classList.remove("hidden");
    renderWeekly(data.digest, data.stats);
    $("btn-weekly-2").classList.add("hidden");
    $("btn-back").classList.toggle("hidden", !lastFull);
  } else {
    lastFull = data;
    $("weekly-result").classList.add("hidden");
    $("full-result").classList.remove("hidden");
    renderFull(data.digest, data.stats);
    $("btn-weekly-2").classList.remove("hidden");
    $("btn-back").classList.add("hidden");
  }
  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderFull(d, stats) {
  renderGlance(d, stats);
  renderDeadlines(d.deadlines || []);
  renderAnnouncements(d);
}

/* --- TL;DR --- */
function renderGlance(d, stats) {
  const items = [];

  if (stats) {
    const senders = stats.senders ? stats.senders.length : 0;
    const range = stats.dateRange ? `${fmtShort(stats.dateRange.from)} – ${fmtShort(stats.dateRange.to)}` : "";
    let line = `<strong>${stats.totalMessages}</strong> messages from <strong>${senders}</strong> senders`;
    if (range) line += ` • ${range}`;
    items.push(line);
  }

  if (d.summary) {
    for (const sentence of splitSentences(d.summary)) items.push(esc(sentence));
  }
  for (const u of (d.importantUpdates || []).slice(0, 3)) items.push(esc(String(u)));

  if (!items.length) items.push("Nothing notable found in this chat.");

  $("glance-list").innerHTML = items.map((t) => `<li>${t}</li>`).join("");
}

function splitSentences(text) {
  return (text.match(/[^.!?\n]+[.!?]*/g) || [text])
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

/* --- Deadlines --- */
function renderDeadlines(list) {
  const sorted = [...list].sort((a, b) => String(a.due || "z").localeCompare(String(b.due || "z")));
  const el = $("deadlines-list");

  if (!sorted.length) {
    $("section-deadlines").classList.add("hidden");
    return;
  }
  $("section-deadlines").classList.remove("hidden");

  el.innerHTML = sorted.map((item) => {
    const due = String(item.due || "");
    const cls = urgencyClass(due);
    const label = due && due !== "unknown" ? fmtDate(due) : "Date not stated";
    return `
      <div class="deadline-item">
        <div class="deadline-top">
          <div>
            <div class="deadline-title">${esc(item.what || "Untitled")}</div>
            ${item.source ? `<div class="deadline-source">Raised by ${esc(item.source)}</div>` : ""}
          </div>
        </div>
        <span class="date-pill ${cls}"><span class="pill-dot"></span>${esc(label)}</span>
      </div>`;
  }).join("");
}

function urgencyClass(due) {
  if (!due || due === "unknown") return "";
  const d = new Date(due + "T23:59:59");
  if (isNaN(d)) return "";
  const now = new Date();
  const days = (d - now) / 86400000;
  if (days < 0) return "urgent";
  if (days <= 3) return "urgent";
  if (days <= 7) return "soon";
  return "";
}

/* --- Announcements --- */
function renderAnnouncements(d) {
  const cards = [];

  for (const u of d.importantUpdates || []) {
    cards.push({ label: "Announcement", labelCls: "", title: String(u), desc: "" });
  }
  for (const e of d.exams || []) {
    cards.push({
      label: "Exam",
      labelCls: "exam",
      title: e.what || "Exam",
      desc: e.notes || "",
      date: e.when,
    });
  }
  for (const a of d.assignments || []) {
    cards.push({
      label: "Assignment",
      labelCls: "",
      title: a.what || "Assignment",
      desc: a.notes || "",
      date: a.due,
    });
  }
  for (const x of d.actionItems || []) {
    cards.push({
      label: "Action",
      labelCls: "action",
      title: x.what || "Action needed",
      desc: [x.who, x.needsAction].filter(Boolean).join(" — "),
    });
  }

  const grid = $("announce-grid");
  if (!cards.length) {
    $("section-announcements").classList.add("hidden");
    return;
  }
  $("section-announcements").classList.remove("hidden");

  grid.innerHTML = cards.slice(0, 8).map((c) => `
    <div class="announce-card">
      <span class="announce-label ${c.labelCls}">${esc(c.label)}</span>
      <div class="announce-title">${esc(c.title)}</div>
      ${c.desc ? `<p class="announce-desc">${esc(c.desc)}</p>` : ""}
      ${c.date && c.date !== "unknown"
        ? `<span class="announce-meta"><span class="meta-date">${esc(fmtDate(c.date))}</span></span>`
        : ""}
    </div>`).join("");
}

/* --- Weekly --- */
function renderWeekly(d, stats) {
  const el = $("weekly-result");
  const sections = [
    ["Key Announcements", d.keyAnnouncements],
    ["Deadlines You Missed", d.missedDeadlines],
    ["Social Events", d.socialEvents],
    ["Drama & Conflicts", d.dramaOrConflicts],
  ];

  let html = `<div class="card section-card">
    <h2 class="section-title">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
      What did I miss this week?
    </h2>`;

  if (stats) {
    html += `<p class="deadline-source" style="margin:-0.5rem 0 1rem">Week of ${esc(stats.weekOf || "")} • ${stats.messageCount || 0} messages</p>`;
  }
  if (d.oneLiner) html += `<div class="weekly-one-liner">${esc(d.oneLiner)}</div>`;

  if ((d.assignmentsDue || []).length) {
    html += `<div class="weekly-section"><h3>Assignments Due</h3><ul class="weekly-list">`;
    for (const a of d.assignmentsDue) {
      html += `<li><strong>${esc(a.what || "")}</strong>${a.due ? ` — due ${esc(fmtDate(a.due))}` : ""}</li>`;
    }
    html += `</ul></div>`;
  }

  let any = (d.assignmentsDue || []).length > 0;
  for (const [title, items] of sections) {
    if (!items || !items.length) continue;
    any = true;
    html += `<div class="weekly-section"><h3>${esc(title)}</h3><ul class="weekly-list">`;
    for (const i of items) html += `<li>${esc(String(i))}</li>`;
    html += `</ul></div>`;
  }

  if (!any) html += `<p class="deadline-source">Nothing notable found in the past week.</p>`;
  html += `</div>`;
  el.innerHTML = html;
}

/* ---------------- helpers ---------------- */
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return String(iso);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function fmtShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return String(iso || "");
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function esc(str) {
  if (str == null) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}
