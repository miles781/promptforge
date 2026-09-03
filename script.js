const input = document.querySelector('#promptInput');
const output = document.querySelector('#promptOutput');
const rewriteBtn = document.querySelector('#rewriteBtn');
const copyBtn = document.querySelector('#copyBtn');
const status = document.querySelector('#status');
const inputCount = document.querySelector('#inputCount');
const goal = document.querySelector('#goal');
const dialog = document.querySelector('#settingsDialog');
const apiKey = document.querySelector('#apiKey');

const estimateTokens = text => Math.ceil(text.trim().length / 4);
const updateCount = () => inputCount.textContent = `${estimateTokens(input.value)} tokens est.`;
input.addEventListener('input', updateCount);

function fallbackRewrite(text) {
  return `Rewrite the following request into a concise, high-quality AI prompt.\n\nGoal: ${goal.value === 'quality' ? 'maximize output quality and completeness' : goal.value === 'tokens' ? 'maximize clarity while minimizing unnecessary tokens' : 'balance quality, clarity, and token efficiency'}.\n\nRequirements:\n- Preserve the user's original intent and important constraints.\n- Remove repetition, filler, vague wording, and unnecessary context.\n- Make the expected output explicit and actionable.\n- Use concise language and a logical structure.\n\nOriginal request:\n${text.trim()}`;
}

async function rewriteWithAI(text, key) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json', 'Authorization':`Bearer ${key}`},
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b:free',
      messages: [{ role:'system', content:'You are an expert prompt editor. Rewrite user prompts to be clearer, more precise and token-efficient. Preserve intent and constraints. Return only the improved prompt.' }, { role:'user', content:`Optimization goal: ${goal.value}.\n\nPrompt to improve:\n${text}` }],
      temperature: 0.2
    })
  });
  if (!response.ok) throw new Error(`API request failed (${response.status})`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

rewriteBtn.addEventListener('click', async () => {
  const text = input.value.trim();
  if (!text) { status.textContent = 'Enter a prompt first.'; input.focus(); return; }
  rewriteBtn.disabled = true; rewriteBtn.textContent = 'Rewriting...'; status.textContent = 'Optimizing your prompt...';
  try {
    const key = localStorage.getItem('promptforge_api_key');
    output.value = key ? await rewriteWithAI(text, key) : fallbackRewrite(text);
    status.textContent = key ? 'AI rewrite complete.' : 'Demo rewrite complete. Add an OpenRouter key for live AI rewriting.';
  } catch (error) {
    output.value = fallbackRewrite(text);
    status.textContent = `${error.message}. Showing the local fallback instead.`;
  } finally { rewriteBtn.disabled = false; rewriteBtn.textContent = 'Rewrite Prompt'; }
});

copyBtn.addEventListener('click', async () => {
  if (!output.value) return;
  await navigator.clipboard.writeText(output.value);
  copyBtn.textContent = 'Copied!';
  setTimeout(() => copyBtn.textContent = 'Copy', 1200);
});

document.querySelector('#settingsBtn').addEventListener('click', () => { apiKey.value = localStorage.getItem('promptforge_api_key') || ''; dialog.showModal(); });
document.querySelector('#settingsForm').addEventListener('submit', () => { localStorage.setItem('promptforge_api_key', apiKey.value.trim()); status.textContent = 'API key saved locally.'; });
updateCount();
