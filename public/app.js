let selectedFile = null;

const $ = (id) => document.getElementById(id);

// Status check
async function checkStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    const badge = $("status-badge");
    if (data.ollama) {
      badge.textContent = `● Ollama connected — ${data.model}`;
      badge.className = "badge ok";
    } else {
      badge.textContent = "Ollama not running — start it with `ollama serve`";
      badge.className = "badge bad";
    }
  } catch {
    $("status-badge").textContent = "Cannot reach server";
    $("status-badge").className = "badge bad";
  }
}
checkStatus();

// File handling
const dropZone = $("drop-zone");
const fileInput = $("file-input");

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
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

function setFile(file) {
  selectedFile = file;
  dropZone.innerHTML = `
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#25d366" stroke-width="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
    <p><strong>${file.name}</strong></p>
    <p class="hint">${(file.size / 1024).toFixed(1)} KB — ready to analyze</p>
  `;
  $("btn-digest").disabled = false;
  $("btn-weekly").disabled = false;
}

// Analyze
$("btn-digest").addEventListener("click", () => analyze("/api/digest", "full"));
$("btn-weekly").addEventListener("click", () => analyze("/api/weekly", "weekly"));

async function analyze(endpoint, mode) {
  if (!selectedFile) return;

  $("upload-section").classList.add("hidden");
  $("error").classList.add("hidden");
  $("results").classList.add("hidden");
  $("loading").classList.remove("hidden");
  $("loading-text").textContent = mode === "weekly"
    ? "Finding what you missed this week…"
    : "Analyzing your chat… (this can take a minute)";

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

function renderResults(data, mode) {
  $("results").classList.remove("hidden");

  // Stats
  if (data.stats) {
    const s = data.stats;
    $("stats-card").innerHTML = mode === "weekly"
      ? stat("Week of", s.weekOf) + stat("Messages", s.messageCount)
      : stat("Messages", s.totalMessages) +
        stat("Senders", s.senders?.length || 0) +
        stat("Days", s.days) +
        stat("Range", `${s.dateRange?.from} → ${s.dateRange?.to}`);
  }

  if (mode === "weekly") {
    $("full-result").classList.add("hidden");
    $("weekly-result").classList.remove("hidden");
    renderWeekly(data.digest);
  } else {
    $("weekly-result").classList.add("hidden");
    $("full-result").classList.remove("hidden");
    renderFull(data.digest);
  }
}

function stat(label, value) {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function renderFull(d) {
  // Summary
  $("summary-text").textContent = d.summary || "No summary generated.";

  // Deadlines
  renderList("deadlines-list", d.deadlines, (item) => {
    const cls = isOverdue(item.due) ? "overdue" : "";
    const conf = item.confidence ? `<span class="tag ${item.confidence}">${item.confidence}</span>` : "";
    return `<div class="item ${cls}">
      <div class="title">${esc(item.what)}${conf}</div>
      <div class="meta">Due: <strong>${esc(item.due)}</strong>${item.source ? ` · mentioned by ${esc(item.source)}` : ""}</div>
    </div>`;
  });

  // Assignments
  renderList("assignments-list", d.assignments, (item) => {
    const cls = isOverdue(item.due) ? "overdue" : "";
    return `<div class="item ${cls}">
      <div class="title">${esc(item.what)}</div>
      <div class="meta">Due: <strong>${esc(item.due)}</strong>${item.notes ? ` · ${esc(item.notes)}` : ""}</div>
    </div>`;
  });

  // Exams
  renderList("exams-list", d.exams, (item) => `
    <div class="item">
      <div class="title">${esc(item.what)}</div>
      <div class="meta">When: <strong>${esc(item.when)}</strong>${item.notes ? ` · ${esc(item.notes)}` : ""}</div>
    </div>
  `);

  // Action items
  renderList("actions-list", d.actionItems, (item) => `
    <div class="item">
      <div class="title">${esc(item.what)}</div>
      <div class="meta">${esc(item.who)} — ${esc(item.needsAction)}</div>
    </div>
  `);

  // Updates
  renderList("updates-list", d.importantUpdates, (item) => `
    <div class="item"><div class="title">${esc(item)}</div></div>
  `);

  // Hide empty sections
  for (const [id, list] of [
    ["section-deadlines", d.deadlines],
    ["section-assignments", d.assignments],
    ["section-exams", d.exams],
    ["section-actions", d.actionItems],
    ["section-updates", d.importantUpdates],
  ]) {
    $(id).style.display = (!list || list.length === 0) ? "none" : "";
  }
}

function renderWeekly(d) {
  const el = $("weekly-result");
  let html = `
    <div class="card">
      <div class="weekly-header">
        <h2>What did I miss?</h2>
      </div>
      ${d.oneLiner ? `<div class="one-liner">"${esc(d.oneLiner)}"</div>` : ""}
      ${weeklySection("Key Announcements", d.keyAnnouncements)}
      ${weeklySection("Deadlines Missed", d.missedDeadlines)}
      ${assignSection(d.assignmentsDue)}
      ${weeklySection("Social Events", d.socialEvents)}
      ${weeklySection("Drama & Conflicts", d.dramaOrConflicts)}
    </div>
  `;
  el.innerHTML = html;
}

function weeklySection(title, items) {
  if (!items || !items.length) return "";
  return `<div class="weekly-section"><h3>${title}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`;
}

function assignSection(items) {
  if (!items || !items.length) return "";
  return `<div class="weekly-section"><h3>Assignments Due</h3><ul>${items
    .map((i) => `<li><strong>${esc(i.what)}</strong> — due ${esc(i.due)}</li>`)
    .join("")}</ul></div>`;
}

function renderList(containerId, items, renderer) {
  const el = $(containerId);
  if (!items || items.length === 0) {
    el.innerHTML = `<div class="empty">Nothing found</div>`;
    return;
  }
  el.innerHTML = items.map(renderer).join("");
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  const parsed = new Date(dateStr);
  if (isNaN(parsed)) return false;
  return parsed < new Date();
}

function esc(str) {
  if (str == null) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

// Reset
$("btn-reset").addEventListener("click", () => {
  selectedFile = null;
  fileInput.value = "";
  $("results").classList.add("hidden");
  $("upload-section").classList.remove("hidden");
  dropZone.innerHTML = `
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
    <p><strong>Upload your WhatsApp export</strong></p>
    <p class="hint">Drag & drop a .txt file, or click to browse</p>
  `;
  $("btn-digest").disabled = true;
  $("btn-weekly").disabled = true;
});
