// =========================================================
// PromptForge — backend proxy
// Keeps the OpenRouter API key on the server so it's never
// shipped to the browser.
// =========================================================

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(
    express.json({
        limit: "100kb",
    })
);

// Serve frontend
app.use(express.static(__dirname));

app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

const OPENROUTER_MODEL =
    "deepseek/deepseek-chat-v3-0324";

const OPENROUTER_URL =
    "https://openrouter.ai/api/v1/chat/completions";

const GOAL_INSTRUCTIONS = {
    balanced:
        "Balance clarity, structure and conciseness. Improve wording and organization without adding unnecessary detail.",

    quality:
        "Prioritize clarity, structure and completeness. Make requirements explicit and organize detailed prompts with useful sections or bullets, but do not invent facts, requirements, technical choices, or constraints.",

    tokens:
        "Prioritize brevity and token efficiency. Remove unnecessary wording and duplication while preserving every meaningful requirement and the original intent.",
};


// ---------------------------------------------------------
// Build refinement instruction
// ---------------------------------------------------------

function buildSystemPrompt(goal, isRegenerate, prompt) {

    let systemPrompt = `
You are an expert prompt engineer.

Refine the user's prompt so it is clearer, more structured,
precise, and effective while remaining faithful to what the
user actually asked for.

Optimization goal:
${GOAL_INSTRUCTIONS[goal]}

Rules:

- Preserve the user's intent and every meaningful piece of information.
- Preserve names, numbers, examples, technical choices, constraints, requested outputs, and important wording where meaning depends on it.
- Remove noise, repetition, filler, ambiguity, and poor organization.
- Normalize inconsistent wording or formatting when doing so does not change meaning.
- Improve structure when useful with concise headings, bullets, or clearly separated requirements.
- Do not invent facts, requirements, features, technologies, budgets, timelines, or constraints.
- Do not silently remove meaningful information just to make the prompt shorter.
- Do not turn a simple request into an unnecessarily large specification.
- Do not add features simply because they are common or considered best practice.
- Do not assume technologies or requirements that the user did not provide.
- Do not change the user's desired outcome.
- The result must be a usable prompt, not an explanation of the editing process.
- Return ONLY the refined prompt.
- Do not include a preamble.
- Do not include commentary.
- Do not explain what you changed.
- Do not wrap the entire response in quotation marks.
`;

    if (isRegenerate) {
        systemPrompt += `
- Produce a genuinely different but equally faithful structure or wording.
- Do not add new requirements merely to make it different.
`;
    }

    if (/\b(website|web site|web app|web application|landing page|frontend|front[- ]end|dashboard|site)\b/i.test(prompt)) {
        systemPrompt += `
This is a website or web application request. Preserve the user's specific features, then turn the request into a professional implementation brief. Include, when relevant and without pretending they were explicitly requested: responsive behavior, semantic accessible UI, keyboard navigation and focus states, input validation, loading/empty/error states, secure handling of data and secrets, maintainable project structure, performance considerations, focused tests, and concrete acceptance criteria. State assumptions instead of silently inventing business requirements. The output should tell an engineer how to deliver a working product, not just describe a visual mockup.
`;
    }

    return systemPrompt;
}


// ---------------------------------------------------------
// Optimization endpoint
// ---------------------------------------------------------

app.post("/api/optimize", async (req, res) => {

    try {

        const {
            prompt,
            goal,
            isRegenerate,
            apiKey: userKey,
        } = req.body || {};

        // Validate prompt
        if (
            !prompt ||
            typeof prompt !== "string" ||
            !prompt.trim()
        ) {
            return res.status(400).json({
                error: "Missing prompt.",
            });
        }

        // Validate goal
        const goalKey =
            GOAL_INSTRUCTIONS[goal]
                ? goal
                : "balanced";

        // User key takes priority for that request.
        // Otherwise use the server key.
        const apiKey =
            (userKey && String(userKey).trim()) ||
            process.env.OPENROUTER_API_KEY;

        if (!apiKey) {
            return res.status(400).json({
                error:
                    "No API key configured. Set OPENROUTER_API_KEY in the server's .env file, or add a personal key in Settings.",
            });
        }

        const systemPrompt = buildSystemPrompt(
            goalKey,
            Boolean(isRegenerate),
            prompt
        );

        // -------------------------------------------------
        // Upstream timeout
        // -------------------------------------------------

        const controller =
            new AbortController();

        const timeout = setTimeout(() => {
            controller.abort();
        }, 45000);

        let upstream;

        try {

            upstream = await fetch(
                OPENROUTER_URL,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Authorization":
                            `Bearer ${apiKey}`,

                        "HTTP-Referer":
                            req.headers.origin ||
                            "http://localhost",

                        "X-Title":
                            "PromptForge",
                    },

                    body: JSON.stringify({
                        model: OPENROUTER_MODEL,

                        messages: [
                            {
                                role: "system",
                                content: systemPrompt,
                            },
                            {
                                role: "user",
                                content: prompt,
                            },
                        ],

                        temperature:
                            isRegenerate
                                ? 0.65
                                : 0.25,

                        max_tokens: 3000,
                    }),

                    signal: controller.signal,
                }
            );

        } catch (err) {

            if (err?.name === "AbortError") {
                return res.status(504).json({
                    error:
                        "The refinement service timed out.",
                });
            }

            console.error(
                "OpenRouter request failed:",
                err
            );

            return res.status(502).json({
                error:
                    "The refinement service could not be reached.",
            });

        } finally {
            clearTimeout(timeout);
        }


        // -------------------------------------------------
        // Handle upstream failure
        // -------------------------------------------------

        if (!upstream.ok) {

            const errBody =
                await upstream
                    .json()
                    .catch(() => null);

            return res
                .status(upstream.status)
                .json({
                    error:
                        errBody?.error?.message ||
                        `Upstream request failed (${upstream.status})`,
                });
        }


        // -------------------------------------------------
        // Parse response
        // -------------------------------------------------

        const data =
            await upstream.json();

        const choice =
            data.choices?.[0];

        const content =
            choice?.message?.content?.trim();


        // -------------------------------------------------
        // Detect truncation
        // -------------------------------------------------

        if (
            choice?.finish_reason ===
            "length"
        ) {

            return res.status(502).json({
                error:
                    "The refinement service returned a truncated response.",
            });
        }


        // -------------------------------------------------
        // Empty response
        // -------------------------------------------------

        if (!content) {

            return res.status(502).json({
                error:
                    "The model returned an empty response.",
            });
        }


        // -------------------------------------------------
        // Return clean result
        // -------------------------------------------------

        return res.json({
            content,
        });

    } catch (err) {

        console.error(err);

        return res.status(500).json({
            error:
                "Server error while contacting OpenRouter.",
        });
    }
});


// ---------------------------------------------------------
// Start server
// ---------------------------------------------------------

const PORT =
    process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(
        `PromptForge server running at http://localhost:${PORT}`
    );

    if (
        !process.env.OPENROUTER_API_KEY
    ) {
        console.warn(
            "Warning: OPENROUTER_API_KEY is not set — requests will fail unless a visitor adds their own key in Settings."
        );
    }
});