import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { parseChat, groupByWeek } from "./src/parser.js";
import { generateDigest, generateWeeklyDigest } from "./src/digest.js";
import { listModels, resolveModel, PREFERRED_MODEL, OLLAMA_URL } from "./src/ollama.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", async (_req, res) => {
  try {
    const models = await listModels();
    res.json({
      ollama: true,
      model: await resolveModel(),
      models: models.models.map((m) => m.name),
    });
  } catch (err) {
    res.json({ ollama: false, error: err.message });
  }
});

app.post("/api/digest", upload.single("chat"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const raw = req.file.buffer.toString("utf-8");
    const messages = parseChat(raw);

    if (messages.length === 0) {
      return res.status(422).json({ error: "Could not parse any messages from the file. Is this a WhatsApp chat export?" });
    }

    const digest = await generateDigest(messages);
    const stats = {
      totalMessages: messages.length,
      senders: [...new Set(messages.filter(m => !m.isSystem).map(m => m.sender))],
      days: [...new Set(messages.map(m => m.timestamp.toISOString().slice(0, 10)))].length,
      dateRange: {
        from: messages[0].timestamp.toISOString().slice(0, 10),
        to: messages[messages.length - 1].timestamp.toISOString().slice(0, 10),
      },
    };

    res.json({ digest, stats });
  } catch (err) {
    console.error("Digest error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/weekly", upload.single("chat"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const raw = req.file.buffer.toString("utf-8");
    const messages = parseChat(raw);

    if (messages.length === 0) {
      return res.status(422).json({ error: "Could not parse any messages from the file." });
    }

    // Get messages from the most recent week in the chat
    const weeks = groupByWeek(messages);
    const weekKeys = Object.keys(weeks).sort();
    const lastWeek = weeks[weekKeys[weekKeys.length - 1]];

    const digest = await generateWeeklyDigest(lastWeek);

    res.json({
      digest,
      stats: {
        weekOf: weekKeys[weekKeys.length - 1],
        messageCount: lastWeek.length,
      },
    });
  } catch (err) {
    console.error("Weekly digest error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WhatsApp Digest running at http://localhost:${PORT}`);
  console.log(`Ollama: ${OLLAMA_URL} | Preferred model: ${PREFERRED_MODEL}`);
});
