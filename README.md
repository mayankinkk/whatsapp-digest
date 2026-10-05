# WhatsApp Group Digest

For the friend who mutes every college group. Upload a WhatsApp export and get a digest of deadlines, assignments, exams, and action items — powered entirely by open-source AI running locally via [Ollama](https://ollama.com).

## Why open?

- **Private**: Your chat never leaves your machine. No cloud, no server, no data collection.
- **Offline**: Works with no internet connection once the model is pulled.
- **Free**: Zero cost to run — no API keys, no usage limits.
- **Swappable**: Run Gemma, Qwen, Llama — any open-weight model you choose.

## Quick start

```bash
# 1. Install Ollama (if you haven't)
curl -fsSL https://ollama.com/install.sh | sh

# 2. Pull a model
ollama pull gemma3:4b

# 3. Start Ollama
ollama serve &

# 4. Install and run the app
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Export a chat from WhatsApp

1. Open the group → tap the group name
2. **Export chat** → **Without media**
3. Upload the `.txt` file on the web page

## Features

| Feature | Description |
|---|---|
| **Full Digest** | Deadlines, assignments, exams, action items, important updates, TL;DR |
| **What did I miss?** | Weekly catch-up: key announcements, missed deadlines, events, drama |
| **Date resolution** | "Submit by tomorrow" resolves correctly using message timestamps |
| **Stats** | Message count, senders, date range |

## Configuration

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API URL |
| `OLLAMA_MODEL` | `gemma3:4b` | Model to use |

Example with Qwen:

```bash
ollama pull qwen2.5:7b
OLLAMA_MODEL=qwen2.5:7b npm start
```

## Stack

- **Node.js + Express** — backend server
- **Ollama** — local inference with open-weight models (Gemma / Qwen / Llama)
- **Vanilla JS + HTML/CSS** — frontend, no framework needed
