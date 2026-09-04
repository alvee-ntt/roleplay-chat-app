# Roleplay Chat App

A React + Vite roleplay chat frontend backed by a small Express proxy that talks to
Azure OpenAI. The proxy holds the API key server-side so it is never exposed to the browser.

## Stack

- **Frontend:** React 18, Vite, Tailwind CSS
- **Backend:** Express proxy (`server.js`) calling Azure OpenAI via the `openai` SDK
- **Supervisor:** `run-api.mjs` restarts the proxy if it exits

## Setup

```bash
npm install
cp .env.example .env   # then fill in your Azure OpenAI values
```

## Running

```bash
npm run dev
```

This starts the Vite dev server and the API proxy together (via `concurrently`).
The frontend POSTs prompts to `/api/chat`, which the proxy forwards to Azure OpenAI.

## Environment variables

See `.env.example`. All secrets live in `.env`, which is git-ignored.

| Variable | Description |
| --- | --- |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint (`.../openai/v1`) |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | Chat model deployment name |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Embedding model deployment name |
| `PORT` | Port the API proxy listens on (default `8791`) |

## Build

```bash
npm run build     # outputs to dist/
npm run preview
```
