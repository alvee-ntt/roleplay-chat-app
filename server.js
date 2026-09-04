import express from "express";
import OpenAI from "openai";
import "dotenv/config";

// The frontend was written to call Anthropic directly. That can't work from a
// browser (CORS + the key would be exposed), so this little server holds the
// Azure OpenAI key and does the call. The frontend just POSTs a prompt here.
const client = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: process.env.AZURE_OPENAI_ENDPOINT, // .../openai/v1
});

const MODEL = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || "gpt-5-mini";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.post("/api/chat", async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "missing prompt" });
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      // The prompts all ask for a JSON object back; this makes that reliable.
      response_format: { type: "json_object" },
      max_completion_tokens: 4000,
    });
    const text = completion.choices?.[0]?.message?.content ?? "";
    res.json({ text });
  } catch (e) {
    console.error("Azure call failed:", e.status || "", e.message);
    res.status(500).json({ error: e.message });
  }
});

// If a previous instance is still releasing the port, wait and retry rather
// than crashing the supervisor into a tight restart loop.
const port = process.env.PORT || 8791;
function listen(attempt = 0) {
  const server = app.listen(port, () =>
    console.log(`API proxy listening on http://localhost:${port}`)
  );
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && attempt < 10) {
      console.log(`Port ${port} busy, retrying in 1s… (${attempt + 1}/10)`);
      setTimeout(() => listen(attempt + 1), 1000);
    } else {
      console.error("Could not start server:", err.message);
      process.exit(1);
    }
  });
}
listen();

// Log and keep running instead of dying on an unexpected error.
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
