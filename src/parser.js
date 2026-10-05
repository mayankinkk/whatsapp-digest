const LINE_PATTERNS = [
  // [12/10/23, 10:30:45 AM] Name: message
  /^\[?(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\]?\s*[-–]?\s*([^:]+):\s*([\s\S]*)$/,
  // 12/10/23, 10:30:45 AM - Name: message
  /^(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\s*[-–]\s*([^:]+):\s*([\s\S]*)$/,
];

const SYSTEM_MESSAGES = [
  /created group/i, /added/i, /left/i, /removed/i, /changed the subject/i,
  /changed this group/i, /Messages and calls are end-to-end encrypted/i,
  /disappearing messages/i, /changed the group description/i,
  /<Media omitted>/i, /image omitted/i, /video omitted/i, /document omitted/i,
];

function parseDate(dateStr, timeStr) {
  // Formats: D/M/YY, D/M/YYYY, M/D/YY, M/D/YYYY, YYYY-MM-DD
  let datePart = dateStr.replace(/[\/.]/g, "-");
  const parts = datePart.split("-").map(Number);
  const time = timeStr.trim();

  let day, month, year;
  if (parts[0] > 31) {
    // YYYY-MM-DD
    year = parts[0]; month = parts[1]; day = parts[2];
  } else {
    // D/M/Y or M/D/Y — assume D/M (day first) if first > 12
    if (parts[0] > 12) { day = parts[0]; month = parts[1]; }
    else if (parts[1] > 12) { month = parts[0]; day = parts[1]; }
    else { day = parts[0]; month = parts[1]; } // ambiguous, default D/M
    year = parts[2];
    if (year < 100) year += 2000;
  }

  // Parse time
  const timeMatch = time.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  if (!timeMatch) return new Date(year, month - 1, day);

  let h = Number(timeMatch[1]);
  const m = Number(timeMatch[2]);
  const s = Number(timeMatch[3] || 0);
  const ampm = (timeMatch[4] || "").toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;

  return new Date(year, month - 1, day, h, m, s);
}

function parseChat(rawText) {
  const lines = rawText.split(/\r?\n/);
  const messages = [];
  let current = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    let matched = false;
    for (const pattern of LINE_PATTERNS) {
      const m = line.match(pattern);
      if (m) {
        if (current) messages.push(current);
        const date = parseDate(m[1], m[2]);
        const sender = m[3].trim();
        const text = m[4].trim();
        current = {
          timestamp: date,
          sender,
          text,
          isSystem: SYSTEM_MESSAGES.some((re) => re.test(text)),
        };
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Continuation of previous message
      if (current) {
        current.text += "\n" + line;
      }
    }
  }
  if (current) messages.push(current);

  return messages;
}

function groupByDay(messages) {
  const days = {};
  for (const msg of messages) {
    if (msg.isSystem) continue;
    const key = msg.timestamp.toISOString().slice(0, 10);
    if (!days[key]) days[key] = [];
    days[key].push(msg);
  }
  return days;
}

function groupByWeek(messages) {
  const weeks = {};
  for (const msg of messages) {
    if (msg.isSystem) continue;
    const d = new Date(msg.timestamp);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay()); // start of week (Sunday)
    const key = d.toISOString().slice(0, 10);
    if (!weeks[key]) weeks[key] = [];
    weeks[key].push(msg);
  }
  return weeks;
}

export { parseChat, groupByDay, groupByWeek };
