const promptInput = document.getElementById("prompt");
const resultOutput = document.getElementById("result");
const goalSelect = document.getElementById("goal");

const rewriteButton = document.getElementById("rewriteBtn");
const copyButton = document.getElementById("copyBtn");
const clearButton = document.getElementById("clearBtn");

const characterCount = document.getElementById("characterCount");
const tokenEstimate = document.getElementById("tokenEstimate");


// =========================
// API Settings
// =========================

const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeModal = document.getElementById("closeModal");

const apiKeyInput = document.getElementById("apiKey");
const saveApiKey = document.getElementById("saveApiKey");


// Load saved API key

const savedApiKey = localStorage.getItem("promptforge_api_key");

if (savedApiKey) {
    apiKeyInput.value = savedApiKey;
}


// Open settings

settingsBtn.addEventListener("click", () => {
    settingsModal.classList.add("active");
});


// Close settings

closeModal.addEventListener("click", () => {
    settingsModal.classList.remove("active");
});


// Close when clicking outside

settingsModal.addEventListener("click", (event) => {

    if (event.target === settingsModal) {
        settingsModal.classList.remove("active");
    }

});


// Save API key

saveApiKey.addEventListener("click", () => {

    const key = apiKeyInput.value.trim();

    if (!key) {
        alert("Please enter an API key.");
        return;
    }

    localStorage.setItem(
        "promptforge_api_key",
        key
    );

    saveApiKey.textContent = "Saved!";

    setTimeout(() => {

        saveApiKey.textContent = "Save API Key";

        settingsModal.classList.remove("active");

    }, 800);

});


// =========================
// Character Counter
// =========================

promptInput.addEventListener("input", () => {

    const length = promptInput.value.length;

    characterCount.textContent =
        `${length} character${length === 1 ? "" : "s"}`;

});


// =========================
// Clear Prompt
// =========================

clearButton.addEventListener("click", () => {

    promptInput.value = "";
    resultOutput.value = "";

    characterCount.textContent = "0 characters";
    tokenEstimate.textContent = "Estimated tokens: —";

});


// =========================
// AI Prompt Optimization
// =========================

rewriteButton.addEventListener("click", async () => {

    const prompt = promptInput.value.trim();
    const goal = goalSelect.value;

    if (!prompt) {

        resultOutput.value =
            "Please enter a prompt before optimizing it.";

        return;
    }


    const apiKey =
        localStorage.getItem("promptforge_api_key");


    if (!apiKey) {

        resultOutput.value =
            "Please add your OpenRouter API key in Settings first.";

        settingsModal.classList.add("active");

        return;
    }


    rewriteButton.disabled = true;

    rewriteButton.innerHTML =
        "✦ Optimizing...";

    resultOutput.value =
        "AI is analyzing your prompt...";


    const systemPrompt = `
You are an expert prompt engineer.

Your task is to rewrite the user's prompt to make it:

- Clear
- Specific
- Well structured
- Effective
- Concise
- Token efficient

Optimization goal:
${goal}

Preserve the original intent.

Do not explain your changes.

Return ONLY the improved prompt.
`;


    try {

        const response = await fetch(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                    "HTTP-Referer": window.location.href,
                    "X-Title": "PromptForge"
                },

                body: JSON.stringify({

                    model:
                        "deepseek/deepseek-chat-v3-0324:free",

                    messages: [

                        {
                            role: "system",
                            content: systemPrompt
                        },

                        {
                            role: "user",
                            content: prompt
                        }

                    ],

                    temperature: 0.3

                })

            }
        );


        if (!response.ok) {

            const errorData =
                await response.json().catch(() => null);

            throw new Error(
                errorData?.error?.message ||
                `API request failed (${response.status})`
            );

        }


        const data = await response.json();

        const optimizedPrompt =
            data.choices?.[0]?.message?.content?.trim();


        if (!optimizedPrompt) {
            throw new Error(
                "The AI returned an empty response."
            );
        }


        resultOutput.value =
            optimizedPrompt;


        const estimatedTokens =
            Math.ceil(optimizedPrompt.length / 4);

        tokenEstimate.textContent =
            `Estimated tokens: ${estimatedTokens}`;


    } catch (error) {

        console.error(error);

        resultOutput.value =
            `Unable to optimize the prompt.\n\n${error.message}`;

    } finally {

        rewriteButton.disabled = false;

        rewriteButton.innerHTML =
            "✦ Rewrite Prompt";

    }

});


// =========================
// Copy
// =========================

copyButton.addEventListener("click", async () => {

    const text =
        resultOutput.value.trim();

    if (!text) {
        return;
    }


    try {

        await navigator.clipboard.writeText(text);

        copyButton.textContent = "Copied!";

        setTimeout(() => {

            copyButton.textContent = "Copy";

        }, 1500);

    } catch (error) {

        console.error(
            "Copy failed:",
            error
        );

    }

});