const SUPABASE_URL = 'https://iwouaznczwhojuvmignr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3b3Vhem5jendob2p1dm1pZ25yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MDQzNTAsImV4cCI6MjA4OTk4MDM1MH0.FJ4hUYMGLkmiYcjYp8NnfsrtD-hHI8U59uYBWTtrEko';

const MOCKUP_SYSTEM = `You are a world-class UI/UX designer and front-end engineer. Given a product proposal, you generate a complete, polished, interactive single-file HTML prototype that shows exactly what the finished app will look like.

REQUIREMENTS:
- Output ONLY a complete, valid HTML file. No explanation, no markdown fences, no extra text — just raw HTML.
- Include ALL CSS and JS inline (no external dependencies except Tailwind CDN).
- Use: <script src="https://cdn.tailwindcss.com"></script>
- The VERY FIRST tag inside <head> must be: <base target="_blank">
- Build a REALISTIC, PROFESSIONAL app prototype — not a wireframe. It should look like a real shipped product.
- Show ALL key screens/pages from the proposal. EVERY screen must be fully built out with realistic content.
- Include realistic placeholder data (real-looking names, values, entries — not "Lorem ipsum").
- Mobile-responsive layout (375px width for mobile apps, desktop-first for dashboards/web apps).
- Include the product's name and a matching color theme.
- Use smooth CSS transitions between screens.
- Show at least 3–5 distinct screens covering ALL core features.
- App should feel "alive" — hover states, realistic data, proper spacing, emoji/SVG icons.

════════════════════════════════════════════════════════════
MANDATORY NAVIGATION PATTERN — COPY THIS EXACTLY, NO EXCEPTIONS
════════════════════════════════════════════════════════════

You MUST use this exact JavaScript navigation system. Do not invent your own.

STEP 1 — Give every screen div an id like "screen-NAME" and the class "screen":
  <div id="screen-dashboard" class="screen">...dashboard content...</div>
  <div id="screen-habits"    class="screen">...habits content...</div>
  <div id="screen-nutrition" class="screen">...nutrition content...</div>

STEP 2 — In your <style> tag, add this CSS:
  .screen { display: none; }
  .screen.active { display: block; }

STEP 3 — Add this EXACT JavaScript function in your <script> tag:
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(function(s) {
      s.classList.remove('active');
    });
    var target = document.getElementById('screen-' + name);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-link').forEach(function(n) {
      n.classList.toggle('nav-active', n.getAttribute('data-screen') === name);
    });
  }

STEP 4 — On page load, show the first screen:
  document.addEventListener('DOMContentLoaded', function() { showScreen('dashboard'); });
  (replace 'dashboard' with whatever your first screen's name is)

STEP 5 — Every nav link MUST look exactly like this:
  <button class="nav-link" data-screen="habits" onclick="showScreen('habits')">🌿 Habits</button>
  — Use <button> elements (NOT <a> tags) for ALL navigation
  — The data-screen attribute MUST match the screen name exactly
  — The onclick MUST call showScreen() with the exact same name

FORBIDDEN — these will break the preview and must NEVER appear:
  ✗ <a href="habits.html">  ← breaks iframe
  ✗ window.location = ...   ← breaks iframe
  ✗ location.href = ...     ← breaks iframe
  ✗ history.pushState(...)  ← breaks iframe
  ✗ Any href pointing to a file path

════════════════════════════════════════════════════════════

DESIGN GUIDELINES BY TYPE:
- Habit/wellness tracker: clean white/pastel background, progress rings, streak counters, checklist items
- Dashboard/analytics: dark sidebar, card grid, charts as CSS/HTML visuals (no Chart.js needed)
- Task manager: kanban or list view, priorities, due dates
- E-commerce/marketplace: product grid, cart, profile
- Social/community: feed, profile card, post composer
- Fitness/workout: dark theme, exercise cards, timers
- Finance/budget: clean mint/green accents, spending breakdowns
- Navigation/maps: card-based POI list, clean search bar

The product name, color scheme, and content must EXACTLY match the product described in the proposal.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify Supabase JWT
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required.' });
  const userToken = authHeader.replace('Bearer ', '');
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${userToken}`, 'apikey': SUPABASE_ANON_KEY }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Session expired. Please sign in again.' });

  const { proposal, conversation_summary, feedback, previous_html, self_inspect } = req.body;
  if (!proposal) return res.status(400).json({ error: 'Proposal required.' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Build the user prompt from proposal + optional feedback/inspect + previous HTML
  const userPrompt = buildPrompt(proposal, conversation_summary, feedback, previous_html, self_inspect);

  // ── Primary: Claude Sonnet (quality HTML generation) ─────────────────────
  if (anthropicKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 12000,
          system: MOCKUP_SYSTEM,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });
      const raw = await response.json();
      if (response.ok) {
        const html = raw.content?.[0]?.text;
        if (html && html.includes('<html')) {
          return res.json({ html, product_name: proposal.product_name });
        }
        // If not valid HTML, fall through
        console.error('Mockup: Sonnet returned non-HTML, falling back');
      } else {
        console.error('Mockup Anthropic error:', raw.error?.message);
      }
    } catch (err) {
      console.error('Mockup Anthropic call failed:', err.message);
    }
  }

  // ── Fallback: Gemini 2.5 Flash ────────────────────────────────────────────
  if (!geminiKey) {
    return res.status(503).json({ error: 'AI service not configured.' });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: MOCKUP_SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            maxOutputTokens: 8192,
            temperature: 0.7,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      }
    );

    const raw = await response.json();
    if (!response.ok) {
      const isQuota = response.status === 429 || (raw.error?.message || '').toLowerCase().includes('quota');
      return res.status(isQuota ? 429 : 500).json({ error: raw.error?.message || 'AI service error' });
    }

    const parts = raw.candidates?.[0]?.content?.parts || [];
    const responsePart = parts.find(p => !p.thought && p.text) || parts[0];
    let html = responsePart?.text || '';

    // Strip any markdown fences if Gemini wrapped it
    html = html.replace(/^```html\s*/i, '').replace(/\s*```$/, '').trim();

    if (!html.includes('<html')) {
      return res.status(500).json({ error: 'Could not generate mockup. Please try again.' });
    }

    return res.json({ html, product_name: proposal.product_name });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function buildPrompt(proposal, summary, feedback, previousHtml, selfInspect) {
  const meta = [
    `Product Name: ${proposal.product_name}`,
    `Type: ${proposal.product_type || 'web_app'}`,
    `Tagline: ${proposal.tagline || ''}`,
    `Description: ${proposal.description || ''}`,
    `Key Features: ${(proposal.key_features || []).join(', ')}`,
    `Problem Solved: ${proposal.problem_solved || ''}`,
    summary ? `User Context: ${summary}` : '',
  ].filter(Boolean).join('\n');

  // Self-inspect: audit the existing HTML and fix all bugs automatically
  if (selfInspect && previousHtml) {
    return `You are a QA engineer auditing an HTML prototype for bugs. Here is the CURRENT HTML:

\`\`\`html
${previousHtml}
\`\`\`

This prototype is for the following product:
${meta}

AUDIT CHECKLIST — find and fix every issue you spot:
1. Navigation: does every nav button call showScreen() with the correct screen ID? Are all referenced screen IDs actually defined as <div id="screen-NAME"> elements?
2. Missing screens: does the prototype show ALL the key features listed above? Add any missing screens.
3. Broken JS: any onclick handlers referencing undefined functions? Any syntax errors? Fix them.
4. Dead links: any <a href="..."> pointing to a file path that doesn't exist? Replace with showScreen() calls.
5. CSS issues: any screen that should be visible but is hidden? Any .screen divs missing the right display logic?
6. DOMContentLoaded: is there a handler that shows the first screen on load?

OUTPUT: the fully corrected HTML file with all bugs fixed and all screens present and navigable. Do not explain — just output the fixed HTML.`;
  }

  // Feedback with previous HTML = surgical edit, not full regeneration
  if (feedback && previousHtml) {
    return `You are editing an existing HTML prototype. Here is the CURRENT HTML that is already working and has all screens with functioning navigation:

\`\`\`html
${previousHtml}
\`\`\`

The user has reviewed this prototype and wants the following changes:
"${feedback}"

INSTRUCTIONS:
- Start from the HTML above as your base. DO NOT regenerate from scratch.
- Make ONLY the changes needed to fulfill the user's feedback.
- Keep ALL existing screens intact — do not remove any screens or navigation items.
- Keep ALL existing navigation working — every nav button must still call showScreen() correctly.
- Keep the same color theme, layout structure, and overall design unless the user explicitly asked to change those.
- Output the complete updated HTML file (all screens, all navigation, all styles).`;
  }

  // First generation
  return `${meta}\n\nGenerate a complete, realistic, interactive HTML prototype for this product. Show all key screens with working navigation.`;
}
