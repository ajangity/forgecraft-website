const SUPABASE_URL = 'https://iwouaznczwhojuvmignr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3b3Vhem5jendob2p1dm1pZ25yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MDQzNTAsImV4cCI6MjA4OTk4MDM1MH0.FJ4hUYMGLkmiYcjYp8NnfsrtD-hHI8U59uYBWTtrEko';

const MOCKUP_SYSTEM = `You are a world-class UI/UX designer and front-end engineer. Given a product proposal, you generate a complete, polished, interactive single-file HTML prototype that shows exactly what the finished app will look like.

REQUIREMENTS:
- Output ONLY a complete, valid HTML file. No explanation, no markdown fences, no extra text — just raw HTML.
- Include ALL CSS and JS inline (no external dependencies except Tailwind CDN).
- Use: <script src="https://cdn.tailwindcss.com"></script>
- The VERY FIRST tag inside <head> must be: <base target="_blank"> — this prevents any accidental link navigation.
- Build a REALISTIC, PROFESSIONAL app prototype — not a wireframe. It should look like a real shipped product.
- Show ALL key screens/pages from the proposal, each navigable via sidebar, tab bar, or bottom nav.
- Include realistic placeholder data that matches the product's purpose (real-looking names, values, entries — not "Lorem ipsum").
- Mobile-responsive layout (works at 375px width, designed mobile-first for mobile apps, desktop-first for dashboards/web apps).
- Working screen navigation using JS (clicking nav items shows/hides screens — no page reloads).
- Include the product's name and a matching color theme appropriate to its category.
- Use smooth transitions between screens (CSS transitions).
- Show at least 3–5 distinct screens covering the product's core features.
- App should feel "alive" — hover states, realistic data, proper spacing, icons (use emoji or simple SVG).

CRITICAL NAVIGATION RULES — YOU MUST FOLLOW THESE OR THE PREVIEW WILL BREAK:
- ALL screen navigation MUST use JavaScript show/hide logic ONLY. Example: onclick="showScreen('dashboard')"
- NEVER use <a href="pagename.html"> or any href that points to a file/path. Those URLs don't exist and will break the preview.
- NEVER use window.location, location.href, location.replace(), or ANY navigation API.
- NEVER use history.pushState() or history.replaceState().
- For any link-style element, use: <a href="javascript:void(0)" onclick="showScreen('name')"> or a <button> with onclick.
- The entire app must live in one HTML file with all screens as hidden <div> elements toggled by JS.
- The showScreen() function should add/remove a CSS class to show/hide screen divs — no redirects ever.

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

  const { proposal, conversation_summary, feedback } = req.body;
  if (!proposal) return res.status(400).json({ error: 'Proposal required.' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Build the user prompt from proposal + optional feedback
  const userPrompt = buildPrompt(proposal, conversation_summary, feedback);

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

function buildPrompt(proposal, summary, feedback) {
  const lines = [
    `Product Name: ${proposal.product_name}`,
    `Type: ${proposal.product_type || 'web_app'}`,
    `Tagline: ${proposal.tagline || ''}`,
    `Description: ${proposal.description || ''}`,
    `Key Features: ${(proposal.key_features || []).join(', ')}`,
    `Problem Solved: ${proposal.problem_solved || ''}`,
    summary ? `User Context: ${summary}` : '',
  ].filter(Boolean).join('\n');

  if (feedback) {
    return `${lines}\n\nThe user reviewed the previous mockup and requested these changes:\n"${feedback}"\n\nGenerate an updated HTML prototype incorporating this feedback.`;
  }

  return `${lines}\n\nGenerate a complete, realistic, interactive HTML prototype for this product. Show all key screens with working navigation.`;
}
