# PromptForge — backend proxy setup

This adds a minimal Express server that holds your OpenRouter API key
server-side and proxies requests for the frontend, so the key is never
sent to or visible in anyone's browser.

## Setup

```bash
npm install
cp .env.example .env
```

Open `.env` and paste your real key:

```
OPENROUTER_API_KEY=sk-or-v1-your-real-key-here
```

## Run

```bash
npm start
```

Visit `http://localhost:3000`. Everyone who uses the app gets AI-powered
results automatically — no configuration needed on their end.

## How it works

- `server.js` serves the frontend (`index.html`, `script.js`, `styles.css`)
  and exposes one endpoint: `POST /api/optimize`.
- The frontend calls that endpoint (same-origin, no CORS setup needed)
  instead of calling OpenRouter directly.
- The server attaches your `OPENROUTER_API_KEY` to the upstream request.
  It is read from the environment and never sent back to the client.
- If a visitor adds their own key in Settings, it's sent along with their
  request and used instead of your default key for that request only —
  their choice, their key, their quota.
- If the AI call fails for any reason (no key configured, rate limit,
  network issue), the frontend automatically falls back to the built-in
  offline optimizer so the app never just breaks.

## Deploying

Any Node host works (Render, Railway, Fly.io, a VPS, etc.) — deploy this
folder as-is and set `OPENROUTER_API_KEY` as an environment variable in
that platform's dashboard instead of a committed `.env` file.

### Render

1. Push the `prompt-editor` folder to a GitHub repository.
2. In Render, choose **New > Blueprint** and select the repository.
3. Set the `OPENROUTER_API_KEY` secret when Render prompts for it.
4. Deploy and open the generated `onrender.com` URL.

The included `render.yaml` supplies the build command, start command, and
`/health` check automatically. A public deployment needs a hosted model API
key; a local Ollama server on your own computer cannot be reached by Render.

**Do not** commit your real `.env` file or your key to a public repo —
add `.env` to `.gitignore`.
