// =========================================================
// PromptForge — app logic
// Vanilla JS, no build step. OpenRouter for live AI,
// a deterministic local fallback when no key is configured
// or the request fails.
// =========================================================

const STORAGE_KEYS = {
    apiKey: "promptforge_api_key",
    theme: "promptforge_theme",
    history: "promptforge_history",
};

const OPENROUTER_MODEL = "deepseek/deepseek-chat-v3-0324:free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const GOAL_INSTRUCTIONS = {
    balanced: "Balance clarity, structure and conciseness. Don't heavily favor brevity or added detail over the other.",
    quality: "Prioritize clarity, structure and completeness. Add helpful structure (short sections or bullet points) and make requirements explicit, even if the result is longer.",
    tokens: "Prioritize brevity and token efficiency above everything else. Remove every non-essential word while keeping the instruction unambiguous.",
};

const EXAMPLES = [
    { category: "Coding", title: "Debug a script", prompt: "my python script keeps crashing when i run it on big files, can someone help me figure out whats wrong and fix it" },
    { category: "Coding", title: "Build a feature", prompt: "add a login page to my app with email and password, needs validation and should show error messages" },
    { category: "Writing", title: "Blog outline", prompt: "write me a blog post about staying productive while working from home, keep it friendly and practical" },
    { category: "Writing", title: "Email rewrite", prompt: "help me write an email to my landlord about a broken heater, i want to be firm but polite" },
    { category: "Research", title: "Compare options", prompt: "i need to understand the differences between postgres and mongodb for a new project that is mostly relational data" },
    { category: "Research", title: "Summarize a topic", prompt: "explain how carbon capture technology works and what the main challenges are right now" },
    { category: "Business", title: "Pitch summary", prompt: "write a short pitch for a subscription box service for dog owners, aimed at small budget startups" },
    { category: "Business", title: "Meeting notes", prompt: "turn these rough notes into a clean summary for my team: talked about q3 budget, need new hires in support, deadline moved to october" },
    { category: "Studying", title: "Explain a concept", prompt: "explain photosynthesis to me like im studying for a high school biology exam" },
    { category: "Studying", title: "Practice questions", prompt: "make me some practice questions about the french revolution for my history test" },
    { category: "Content creation", title: "Video script", prompt: "write a short script for a 60 second video about why people should learn to cook at home" },
    { category: "Content creation", title: "Social caption", prompt: "write an instagram caption for a photo of a sunset over the beach, casual and a bit poetic" },
];

// ---------------------------------------------------------
// DOM refs
// ---------------------------------------------------------

const $ = (id) => document.getElementById(id);

const el = {
    toastStack: $("toastStack"),
    themeToggle: $("themeToggle"),
    settingsBtn: $("settingsBtn"),
    tabs: document.querySelectorAll(".tab"),
    views: {
        editor: $("view-editor"),
        history: $("view-history"),
        examples: $("view-examples"),
    },
    goalButtons: document.querySelectorAll(".goal-btn"),
    forgeBtn: $("forgeBtn"),
    promptInput: $("promptInput"),
    clearBtn: $("clearBtn"),
    inputStats: $("inputStats"),
    resultOutput: $("resultOutput"),
    outputStatus: $("outputStatus"),
    outputStats: $("outputStats"),
    regenerateBtn: $("regenerateBtn"),
    copyBtn: $("copyBtn"),
    saveHistoryBtn: $("saveHistoryBtn"),
    gauge: $("gauge"),
    gaugeSavings: $("gaugeSavings"),
    gaugePercent: $("gaugePercent"),
    gaugeSource: $("gaugeSource"),
    gaugeFill: $("gaugeFill"),
    historyList: $("historyList"),
    historyEmpty: $("historyEmpty"),
    clearHistoryBtn: $("clearHistoryBtn"),
    examplesList: $("examplesList"),
    settingsModal: $("settingsModal"),
    closeModal: $("closeModal"),
    keyStatus: $("keyStatus"),
    keyStatusDot: $("keyStatusDot"),
    keyStatusText: $("keyStatusText"),
    apiKeyInput: $("apiKeyInput"),
    saveApiKey: $("saveApiKey"),
    removeApiKey: $("removeApiKey"),
};

let currentGoal = "balanced";
let lastResult = null;
let regenerateToggle = false;

// ---------------------------------------------------------
// Utilities
// ---------------------------------------------------------

function estimateTokens(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return 0;
    return Math.max(1, Math.ceil(trimmed.length / 4));
}

function escapeHtml(str) {
    return (str || "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function readJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
        console.error(`Could not read ${key} from storage`, err);
        return fallback;
    }
}

function writeJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (err) {
        console.error(`Could not write ${key} to storage`, err);
        return false;
    }
}

// ---------------------------------------------------------
// Toasts
// ---------------------------------------------------------

function showToast(message, type = "info", duration = 3200) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.setAttribute("role", "status");
    toast.textContent = message;
    el.toastStack.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

// ---------------------------------------------------------
// Theme
// ---------------------------------------------------------

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    el.themeToggle.setAttribute("aria-pressed", String(theme === "light"));
    el.themeToggle.setAttribute("aria-label", `Switch to ${theme === "light" ? "dark" : "light"} theme`);
}

function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEYS.theme);
    if (saved) {
        applyTheme(saved);
        return;
    }
    const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    applyTheme(prefersLight ? "light" : "dark");
}

el.themeToggle.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(next);
    localStorage.setItem(STORAGE_KEYS.theme, next);
});

// ---------------------------------------------------------
// View switching
// ---------------------------------------------------------

function switchView(name) {
    el.tabs.forEach((tab) => {
        const isActive = tab.dataset.view === name;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", String(isActive));
    });
    Object.entries(el.views).forEach(([key, view]) => {
        const isActive = key === name;
        view.hidden = !isActive;
        view.classList.toggle("is-active", isActive);
    });
    if (name === "history") renderHistory();
}

el.tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
});

// ---------------------------------------------------------
// Settings modal
// ---------------------------------------------------------

function maskKey(key) {
    if (key.length <= 6) return "••••";
    return `sk-or-••••${key.slice(-4)}`;
}

function updateKeyStatus() {
    const key = localStorage.getItem(STORAGE_KEYS.apiKey);
    el.apiKeyInput.value = "";
    if (key) {
        el.keyStatusDot.classList.add("is-configured");
        el.keyStatusText.textContent = `API key configured — ${maskKey(key)}`;
        el.apiKeyInput.placeholder = "Enter a new key to replace it";
        el.removeApiKey.hidden = false;
    } else {
        el.keyStatusDot.classList.remove("is-configured");
        el.keyStatusText.textContent = "No API key configured — using local fallback";
        el.apiKeyInput.placeholder = "sk-or-v1-...";
        el.removeApiKey.hidden = true;
    }
}

function openModal() {
    updateKeyStatus();
    el.settingsModal.hidden = false;
    el.apiKeyInput.focus();
    document.addEventListener("keydown", onModalKeydown);
}

function closeModalFn() {
    el.settingsModal.hidden = true;
    el.apiKeyInput.value = "";
    el.settingsBtn.focus();
    document.removeEventListener("keydown", onModalKeydown);
}

function onModalKeydown(e) {
    if (e.key === "Escape") closeModalFn();
}

el.settingsBtn.addEventListener("click", openModal);
el.closeModal.addEventListener("click", closeModalFn);
el.settingsModal.addEventListener("click", (e) => {
    if (e.target === el.settingsModal) closeModalFn();
});

el.saveApiKey.addEventListener("click", () => {
    const value = el.apiKeyInput.value.trim();
    if (!value) {
        showToast("Enter an API key first.", "error");
        return;
    }
    localStorage.setItem(STORAGE_KEYS.apiKey, value);
    updateKeyStatus();
    showToast("API key saved.", "success");
    setTimeout(closeModalFn, 700);
});

el.removeApiKey.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEYS.apiKey);
    updateKeyStatus();
    showToast("API key removed — back to local fallback.", "info");
});

// ---------------------------------------------------------
// Goal selector
// ---------------------------------------------------------

el.goalButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        currentGoal = btn.dataset.goal;
        el.goalButtons.forEach((b) => {
            const active = b === btn;
            b.classList.toggle("is-active", active);
            b.setAttribute("aria-checked", String(active));
        });
    });
});

function setGoalUI(goal) {
    currentGoal = goal;
    el.goalButtons.forEach((b) => {
        const active = b.dataset.goal === goal;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-checked", String(active));
    });
}

// ---------------------------------------------------------
// Editor stats
// ---------------------------------------------------------

function updateInputStats() {
    const text = el.promptInput.value;
    const chars = text.length;
    const tokens = estimateTokens(text);
    el.inputStats.textContent = `${chars} character${chars === 1 ? "" : "s"} · ~${tokens} token${tokens === 1 ? "" : "s"}`;
}

function updateOutputStats(text) {
    const chars = text.length;
    const tokens = estimateTokens(text);
    el.outputStats.textContent = `${chars} character${chars === 1 ? "" : "s"} · ~${tokens} token${tokens === 1 ? "" : "s"}`;
}

el.promptInput.addEventListener("input", updateInputStats);

el.promptInput.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        runOptimization();
    }
});

el.clearBtn.addEventListener("click", () => {
    el.promptInput.value = "";
    el.resultOutput.value = "";
    updateInputStats();
    updateOutputStats("");
    el.gauge.hidden = true;
    el.copyBtn.disabled = true;
    el.regenerateBtn.disabled = true;
    el.saveHistoryBtn.disabled = true;
    lastResult = null;
    el.promptInput.focus();
});

// ---------------------------------------------------------
// Local fallback optimizer (rule-based, deterministic)
// ---------------------------------------------------------

function normalizeWhitespace(s) {
    return s.replace(/\s+/g, " ").trim();
}

function splitSentences(s) {
    const parts = s.match(/[^.!?]+[.!?]*/g) || [s];
    return parts.map((p) => p.trim()).filter(Boolean);
}

function stripFillers(s, aggressive) {
    let out = s;
    const mild = [
        /\bkind of\b/gi, /\bsort of\b/gi, /\bjust\b/gi, /\breally\b/gi,
        /\bvery\b/gi, /\bbasically\b/gi, /\bactually\b/gi, /\bliterally\b/gi,
        /\bi think\b/gi, /\bi guess\b/gi, /\bmaybe\b/gi, /\bperhaps\b/gi,
    ];
    mild.forEach((re) => { out = out.replace(re, ""); });

    if (aggressive) {
        const strong = [
            /\bplease\b/gi, /\bcould you\b/gi, /\bcan you\b/gi, /\bwould you\b/gi,
            /\bi want you to\b/gi, /\bi would like you to\b/gi, /\bi need you to\b/gi,
            /\bi'd like\b/gi,
        ];
        strong.forEach((re) => { out = out.replace(re, ""); });
        out = out
            .replace(/\bin order to\b/gi, "to")
            .replace(/\bdue to the fact that\b/gi, "because")
            .replace(/\ba large number of\b/gi, "many")
            .replace(/\bat this point in time\b/gi, "now")
            .replace(/\bfor the purpose of\b/gi, "to");
    }

    return out.replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

function capitalizeAndPunctuate(s) {
    if (!s) return s;
    let out = s.charAt(0).toUpperCase() + s.slice(1);
    if (!/[.!?]$/.test(out)) out += ".";
    return out;
}

function toBullets(sentences) {
    const items = [];
    sentences.forEach((sent) => {
        const clean = sent.replace(/[.!?]+$/, "").trim();
        if (!clean) return;
        const subparts = clean.split(/,\s+| and \s*/i).map((p) => p.trim()).filter(Boolean);
        if (subparts.length > 1) {
            // Merge short trailing fragments (e.g. "clean" from "...modern and clean")
            // back into the previous bullet instead of leaving an orphan one-word bullet.
            const merged = [];
            subparts.forEach((part) => {
                if (merged.length && part.split(/\s+/).length <= 2) {
                    merged[merged.length - 1] += ` and ${part}`;
                } else {
                    merged.push(part);
                }
            });
            items.push(...merged);
        } else {
            items.push(clean);
        }
    });
    return items.filter(Boolean);
}

function dropArticles(s) {
    return s.replace(/\b(a|an|the)\b\s*/gi, "").replace(/\s+/g, " ").trim();
}

function localOptimize(raw, goal, variant) {
    const normalized = normalizeWhitespace(raw);
    const sentences = splitSentences(normalized);
    const bullets = toBullets(sentences);

    if (goal === "tokens") {
        let combined = stripFillers(normalized, true);
        combined = combined.replace(/\b(\w+)( \1\b)+/gi, "$1");
        if (variant) combined = dropArticles(combined);
        return capitalizeAndPunctuate(combined);
    }

    if (goal === "quality") {
        const goalLabel = variant ? "Objective" : "Goal";
        const detailLabel = variant ? "Requirements" : "Details";
        const objective = bullets[0] ? stripFillers(bullets[0], true) : stripFillers(normalized, true);
        const details = bullets.slice(1).map((b) => stripFillers(b, true));
        let out = `${goalLabel}: ${capitalizeAndPunctuate(objective)}`;
        if (details.length) {
            out += `\n\n${detailLabel}:\n` + details.map((b) => `- ${capitalizeAndPunctuate(b)}`).join("\n");
        }
        out += `\n\nReturn a complete, well-structured response that satisfies all of the above.`;
        return out;
    }

    // balanced
    let combined = capitalizeAndPunctuate(stripFillers(normalized, false));
    if (bullets.length > 2) {
        const lead = capitalizeAndPunctuate(stripFillers(bullets[0], false));
        let rest = bullets.slice(1).map((b) => capitalizeAndPunctuate(stripFillers(b, false)));
        if (variant) rest = rest.slice().reverse();
        combined = `${lead}\n\n` + rest.map((b) => `- ${b}`).join("\n");
    }
    return combined;
}

// ---------------------------------------------------------
// OpenRouter call
// ---------------------------------------------------------

async function callOpenRouter(prompt, goal, isRegenerate, apiKey) {
    let systemPrompt = `You are an expert prompt engineer. Rewrite the user's prompt to make it clearer, better structured and more effective.

Optimization goal: ${GOAL_INSTRUCTIONS[goal]}

Rules:
- Preserve the user's original intent, requirements, names, numbers, technical details and constraints exactly.
- Do not invent requirements or facts that were not implied by the original prompt.
- Do not explain your changes or add commentary.
- Return ONLY the rewritten prompt, nothing else.`;

    if (isRegenerate) {
        systemPrompt += "\n- Provide a noticeably different phrasing and structure from a typical single rewrite, while still following the rules above.";
    }

    const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "HTTP-Referer": window.location.href,
            "X-Title": "PromptForge",
        },
        body: JSON.stringify({
            model: OPENROUTER_MODEL,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt },
            ],
            temperature: isRegenerate ? 0.85 : 0.3,
        }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error?.message || `API request failed (${response.status})`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("The model returned an empty response.");
    return content;
}

// ---------------------------------------------------------
// Optimize / regenerate flow
// ---------------------------------------------------------

function setLoading(isLoading) {
    el.forgeBtn.disabled = isLoading;
    el.forgeBtn.classList.toggle("is-loading", isLoading);
    el.regenerateBtn.disabled = isLoading || !lastResult;
    el.outputStatus.textContent = isLoading ? "Forging your prompt…" : "";
    el.outputStatus.classList.toggle("is-visible", isLoading);
    el.outputStatus.classList.toggle("is-loading", isLoading);
}

function updateGauge(original, optimized, source) {
    const tOrig = estimateTokens(original);
    const tOpt = estimateTokens(optimized);
    const savings = tOrig - tOpt;
    const percent = tOrig > 0 ? Math.round((savings / tOrig) * 100) : 0;

    el.gauge.hidden = false;
    el.gaugeSavings.textContent = savings === 0
        ? "No change"
        : savings > 0
            ? `${savings} token${savings === 1 ? "" : "s"} saved`
            : `${Math.abs(savings)} token${Math.abs(savings) === 1 ? "" : "s"} added`;

    el.gaugePercent.textContent = percent === 0
        ? "0% change"
        : percent > 0
            ? `${percent}% shorter`
            : `${Math.abs(percent)}% more detailed`;

    el.gaugeSource.textContent = source === "ai" ? "OpenRouter AI" : "Local fallback";
    el.gaugeFill.style.width = `${Math.min(100, Math.max(4, Math.abs(percent)))}%`;
}

async function runOptimization(options = {}) {
    const isRegenerate = Boolean(options.isRegenerate);
    const original = el.promptInput.value.trim();

    if (!original) {
        showToast("Enter a prompt to forge first.", "error");
        el.promptInput.focus();
        return;
    }

    setLoading(true);

    let optimized = "";
    let source = "local";
    const apiKey = localStorage.getItem(STORAGE_KEYS.apiKey);

    try {
        if (apiKey) {
            optimized = await callOpenRouter(original, currentGoal, isRegenerate, apiKey);
            source = "ai";
        } else {
            if (isRegenerate) regenerateToggle = !regenerateToggle;
            optimized = localOptimize(original, currentGoal, isRegenerate && regenerateToggle);
            source = "local";
        }
    } catch (err) {
        console.error(err);
        showToast(`AI request failed — used local fallback. (${err.message})`, "error", 4500);
        if (isRegenerate) regenerateToggle = !regenerateToggle;
        optimized = localOptimize(original, currentGoal, isRegenerate && regenerateToggle);
        source = "local";
    }

    el.resultOutput.value = optimized;
    updateOutputStats(optimized);
    updateGauge(original, optimized, source);

    el.copyBtn.disabled = false;
    el.regenerateBtn.disabled = false;
    el.saveHistoryBtn.disabled = false;

    lastResult = { original, optimized, goal: currentGoal, source };

    setLoading(false);

    if (source === "ai") {
        showToast(isRegenerate ? "New variation forged with OpenRouter AI." : "Prompt forged with OpenRouter AI.", "success");
    } else if (!apiKey) {
        showToast("Prompt forged locally — add an API key in Settings for live AI rewrites.", "info");
    }
}

el.forgeBtn.addEventListener("click", () => runOptimization());
el.regenerateBtn.addEventListener("click", () => runOptimization({ isRegenerate: true }));

// ---------------------------------------------------------
// Copy
// ---------------------------------------------------------

el.copyBtn.addEventListener("click", async () => {
    const text = el.resultOutput.value.trim();
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        const original = el.copyBtn.textContent;
        el.copyBtn.textContent = "Copied!";
        setTimeout(() => { el.copyBtn.textContent = original; }, 1400);
    } catch (err) {
        console.error("Copy failed:", err);
        showToast("Couldn't copy — select and copy manually.", "error");
    }
});

// ---------------------------------------------------------
// History
// ---------------------------------------------------------

function loadHistory() {
    return readJSON(STORAGE_KEYS.history, []);
}

function persistHistory(list) {
    return writeJSON(STORAGE_KEYS.history, list);
}

el.saveHistoryBtn.addEventListener("click", () => {
    if (!lastResult) return;
    const entry = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        goal: lastResult.goal,
        source: lastResult.source,
        original: lastResult.original,
        optimized: lastResult.optimized,
    };
    const history = loadHistory();
    history.unshift(entry);
    persistHistory(history);
    showToast("Saved to history.", "success");
});

function renderHistory() {
    const history = loadHistory();
    el.historyEmpty.classList.toggle("is-visible", history.length === 0);
    el.historyList.innerHTML = "";

    history.forEach((item) => {
        const card = document.createElement("div");
        card.className = "history-item";
        card.innerHTML = `
            <div class="history-item-top">
                <div class="history-meta">
                    <span class="history-badge">${escapeHtml(item.goal)}</span>
                    <span>${formatDate(item.timestamp)}</span>
                    <span class="history-source">${item.source === "ai" ? "OpenRouter AI" : "Local fallback"}</span>
                </div>
                <div class="history-actions">
                    <button class="text-button" data-action="restore">Restore</button>
                    <button class="text-button" data-action="copy">Copy</button>
                    <button class="text-button danger" data-action="delete">Delete</button>
                </div>
            </div>
            <p class="history-snippet">${escapeHtml(item.optimized)}</p>
        `;

        card.querySelector('[data-action="restore"]').addEventListener("click", () => restoreHistoryItem(item));
        card.querySelector('[data-action="copy"]').addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(item.optimized);
                showToast("Copied to clipboard.", "success");
            } catch (err) {
                showToast("Couldn't copy — select and copy manually.", "error");
            }
        });
        card.querySelector('[data-action="delete"]').addEventListener("click", () => {
            const updated = loadHistory().filter((h) => h.id !== item.id);
            persistHistory(updated);
            renderHistory();
            showToast("Removed from history.", "info");
        });

        el.historyList.appendChild(card);
    });
}

el.clearHistoryBtn.addEventListener("click", () => {
    if (loadHistory().length === 0) return;
    if (!window.confirm("Clear all saved history? This can't be undone.")) return;
    persistHistory([]);
    renderHistory();
    showToast("History cleared.", "info");
});

function restoreHistoryItem(item) {
    el.promptInput.value = item.original;
    el.resultOutput.value = item.optimized;
    setGoalUI(item.goal);
    updateInputStats();
    updateOutputStats(item.optimized);
    updateGauge(item.original, item.optimized, item.source);
    el.copyBtn.disabled = false;
    el.regenerateBtn.disabled = false;
    el.saveHistoryBtn.disabled = false;
    lastResult = { ...item };
    switchView("editor");
    showToast("Restored from history.", "info");
    el.promptInput.focus();
}

// ---------------------------------------------------------
// Examples
// ---------------------------------------------------------

function renderExamples() {
    el.examplesList.innerHTML = "";
    let lastCategory = null;

    EXAMPLES.forEach((example) => {
        if (example.category !== lastCategory) {
            const label = document.createElement("div");
            label.className = "example-category";
            label.textContent = example.category;
            el.examplesList.appendChild(label);
            lastCategory = example.category;
        }

        const card = document.createElement("button");
        card.type = "button";
        card.className = "example-card";
        card.innerHTML = `
            <h3>${escapeHtml(example.title)}</h3>
            <p>${escapeHtml(example.prompt)}</p>
        `;
        card.addEventListener("click", () => {
            el.promptInput.value = example.prompt;
            updateInputStats();
            switchView("editor");
            el.promptInput.focus();
        });

        el.examplesList.appendChild(card);
    });
}

// ---------------------------------------------------------
// Init
// ---------------------------------------------------------

initTheme();
renderExamples();
updateInputStats();
updateOutputStats("");
updateKeyStatus();