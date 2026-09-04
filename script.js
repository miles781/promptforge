import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "deepseek/deepseek-chat-v3-0324:free";

app.use(express.json({ limit: "100kb" }));

app.use(express.static(__dirname));

/* =========================================================
   Prompt refinement instructions
   ========================================================= */

const SYSTEM_PROMPT = `
You are PromptForge, a prompt refinement assistant.

Your job is to improve the user's prompt while preserving its original
intent and all meaningful information.

Rules:

1. Preserve the user's original intent.
2. Preserve meaningful names, numbers, examples, technical choices,
   requirements, constraints, and requested outputs.
3. Remove unnecessary filler, repetition, ambiguity, and poor wording.
4. Improve grammar, clarity, organization, and readability.
5. You may restructure a prompt when doing so makes it clearer.
6. Do not invent facts, requirements, features, technologies, budgets,
   timelines, constraints, or user preferences.
7. Do not silently remove meaningful information.
8. Do not turn a simple request into an unnecessarily large specification.
9. If the original prompt is already clear, make only useful improvements.
10. Return ONLY the refined prompt. Do not explain what you changed.
11. Do not surround the response with markdown code fences.
`.trim();

/* =========================================================
   Validation
   ========================================================= */

function validatePrompt(prompt) {
    if (typeof prompt !== "string") {
        return "Prompt must be a string.";
    }

    const trimmed = prompt.trim();

    if (!trimmed) {
        return "Missing prompt.";
    }

    if (trimmed.length > 30000) {
        return "Prompt is too long. Please keep it below 30,000 characters.";
    }

    return null;
}

function normalizeGoal(goal) {
    const allowed = ["balanced", "quality", "tokens"];

    return allowed.includes(goal) ? goal : "balanced";
}

function getGoalInstruction(goal) {
    switch (goal) {
        case "quality":
            return `
Prioritize clarity, structure, and completeness.
Make requirements explicit and organize detailed prompts with useful
sections or bullets when appropriate.
Do not invent requirements or technical decisions.
`.trim();

        case "tokens":
            return `
Prioritize brevity and token efficiency.
Remove unnecessary wording and duplication while preserving every
meaningful requirement and the original intent.
`.trim();

        case "balanced":
        default:
            return `
Balance clarity, structure, and conciseness.
Improve wording and organization without adding unnecessary detail.
`.trim();
    }
}

/* =========================================================
   OpenRouter request
   ========================================================= */

async function requestOpenRouter({
    prompt,
    goal,
    apiKey,
    isRegenerate,
}) {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort();
    }, 45000);

    try {
        const userInstruction = `
Refine the following prompt.

Optimization goal:
${getGoalInstruction(goal)}

${
    isRegenerate
        ? `
This is a regeneration request.
Produce a meaningfully different refinement from a previous attempt,
but do not add new requirements or assumptions.
`.trim()
        : ""
}

Original prompt:
---
${prompt}
---
`.trim();

        const response = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:${PORT}",
                "X-Title": "PromptForge",
            },
            body: JSON.stringify({
                model: MODEL,

                messages: [
                    {
                        role: "system",
                        content: SYSTEM_PROMPT,
                    },
                    {
                        role: "user",
                        content: userInstruction,
                    },
                ],

                temperature: isRegenerate ? 0.65 : 0.25,
                max_tokens: 3000,
            }),

            signal: controller.signal,
        });

        let data;

        try {
            data = await response.json();
        } catch {
            throw new Error(
                "OpenRouter returned an invalid response."
            );
        }

        if (!response.ok) {
            const upstreamMessage =
                data?.error?.message ||
                data?.error ||
                `OpenRouter returned HTTP ${response.status}.`;

            const error = new Error(String(upstreamMessage));

            error.status = response.status;

            throw error;
        }

        const choice = data?.choices?.[0];

        const content = choice?.message?.content;

        if (
            choice?.finish_reason === "length"
        ) {
            const error = new Error(
                "The refined prompt was truncated. Please try again."
            );

            error.status = 502;

            throw error;
        }

        if (
            typeof content !== "string" ||
            !content.trim()
        ) {
            const error = new Error(
                "OpenRouter returned an empty refinement."
            );

            error.status = 502;

            throw error;
        }

        return content
            .trim()
            .replace(/^```(?:text|markdown)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
    } catch (error) {
        if (error?.name === "AbortError") {
            const timeoutError = new Error(
                "The optimization request timed out."
            );

            timeoutError.status = 504;

            throw timeoutError;
        }

        /*
         * Node's fetch can surface DNS/network errors here.
         * Convert them into a useful server error without exposing
         * internal implementation details to the browser.
         */
        if (
            error?.cause?.code === "ENOTFOUND" ||
            error?.cause?.code === "EAI_AGAIN" ||
            error?.cause?.code === "ECONNRESET" ||
            error?.cause?.code === "ETIMEDOUT"
        ) {
            const networkError = new Error(
                "The AI optimization service is temporarily unreachable."
            );

            networkError.status = 502;

            throw networkError;
        }

        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

/* =========================================================
   Optimization endpoint
   ========================================================= */

app.post("/api/optimize", async (req, res) => {
    const { prompt, goal, isRegenerate, apiKey } = req.body || {};

    const validationError = validatePrompt(prompt);

    if (validationError) {
        return res.status(400).json({
            error: validationError,
        });
    }

    const normalizedGoal = normalizeGoal(goal);

    /*
     * A user-provided key takes priority.
     * Otherwise the server uses OPENROUTER_API_KEY.
     */
    const effectiveApiKey =
        typeof apiKey === "string" && apiKey.trim()
            ? apiKey.trim()
            : process.env.OPENROUTER_API_KEY;

    if (!effectiveApiKey) {
        return res.status(503).json({
            error:
                "No OpenRouter API key is configured. Add a key in Settings or configure OPENROUTER_API_KEY on the server.",
        });
    }

    try {
        const content = await requestOpenRouter({
            prompt: prompt.trim(),
            goal: normalizedGoal,
            apiKey: effectiveApiKey,
            isRegenerate: Boolean(isRegenerate),
        });

        return res.json({
            content,
            goal: normalizedGoal,
        });
    } catch (error) {
        console.error("PromptForge optimization error:", error);

        const status =
            Number.isInteger(error?.status) &&
            error.status >= 400 &&
            error.status < 600
                ? error.status
                : 502;

        /*
         * Don't expose upstream API internals or credentials.
         */
        if (status === 401 || status === 403) {
            return res.status(502).json({
                error:
                    "The configured OpenRouter API key was rejected.",
            });
        }

        if (status === 429) {
            return res.status(429).json({
                error:
                    "The AI service is temporarily rate-limited. Please try again shortly.",
            });
        }

        return res.status(status).json({
            error:
                error?.message ||
                "The optimization service is temporarily unavailable.",
        });
    }
});

/* =========================================================
   Health endpoint
   ========================================================= */

app.get("/api/health", (_req, res) => {
    res.json({
        ok: true,
        service: "PromptForge",
        model: MODEL,
        apiConfigured: Boolean(
            process.env.OPENROUTER_API_KEY
        ),
    });
});

/* =========================================================
   SPA fallback
   ========================================================= */

app.get("*", (_req, res) => {
    res.sendFile(
        path.join(__dirname, "index.html")
    );
});

/* =========================================================
   Server
   ========================================================= */

app.listen(PORT, () => {
    console.log(
        `PromptForge running at http://localhost:${PORT}`
    );

    console.log(
        `OpenRouter server key configured: ${
            process.env.OPENROUTER_API_KEY
                ? "yes"
                : "no"
        }`
    );
});