const SUPABASE_URL = 'https://iwouaznczwhojuvmignr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3b3Vhem5jendob2p1dm1pZ25yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MDQzNTAsImV4cCI6MjA4OTk4MDM1MH0.FJ4hUYMGLkmiYcjYp8NnfsrtD-hHI8U59uYBWTtrEko';

const BUILD_SYSTEM_PROMPT = `You are ForgeCraft's master software engineer. Given a product spec, you build complete, working, production-quality software.

You MUST return a single JSON object with this structure:
{
  "product_name": "...",
  "build_type": "single_html" | "multi_file",
  "description": "Brief description of what was built",
  "files": [
    {
      "filename": "index.html",
      "language": "html",
      "content": "complete file content here",
      "description": "What this file does"
    }
  ],
  "setup_instructions": ["Step 1", "Step 2"],
  "features_built": ["Feature 1", "Feature 2"],
  "tech_used": ["HTML", "CSS", "JavaScript"],
  "preview_file": "index.html",
  "notes": "Any important notes about the build"
}

REQUIREMENTS:
1. Build a COMPLETE, WORKING product. Every button must do something. Every feature must work.
2. For web apps: produce a single self-contained index.html with embedded CSS and JS (no external dependencies except CDN links).
3. Use modern, beautiful dark UI by default (dark background, clean typography, smooth animations).
4. Include ALL features from the spec — not stubs or placeholders.
5. For data-driven apps: use localStorage for persistence so data survives page refresh.
6. For automation scripts: produce a Python or JavaScript file with clear CLI instructions.
7. For dashboards: include realistic sample data and functional charts/tables.
8. Add error handling, loading states, and empty states.
9. Make it mobile-responsive.
10. The code must be production-quality: well-commented, clean, no console errors.
11. For single HTML files: all CSS in <style>, all JS in <script>. CDN libraries (Chart.js, etc.) via cdnjs.cloudflare.com.
12. Return ONLY the JSON object. No text outside the JSON.

IMPORTANT: The "content" field of each file must be the COMPLETE file content as a JSON string. Escape all quotes and newlines properly.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Supabase JWT auth
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required.' });
  const userToken = authHeader.replace('Bearer ', '');
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${userToken}`, 'apikey': SUPABASE_ANON_KEY }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Session expired. Please sign in again.' });

  const { schematic, conversation_summary } = req.body;
  if (!schematic) return res.status(400).json({ error: 'Missing schematic' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const buildPrompt = `Build this product completely:

PRODUCT: ${schematic.product_name}
TAGLINE: ${schematic.tagline || ''}
PROBLEM: ${schematic.problem || ''}
SOLUTION: ${schematic.solution || ''}
TYPE: ${schematic.product_type || 'web_app'}

FEATURES TO BUILD:
${(schematic.pages_or_features || []).map(f => `- ${f.name}: ${f.description}\n  Elements: ${(f.key_elements || []).join(', ')}`).join('\n')}

KEY COMPONENTS:
${(schematic.components || []).map(c => `- ${c.name}: ${c.purpose} (${c.specs || ''})`).join('\n')}

HOW IT WORKS:
${(schematic.how_it_works || []).map(s => `${s.step}. ${s.title}: ${s.description}`).join('\n')}

DATA MODEL:
${(schematic.data_model || []).map(d => `- ${d.entity}: ${(d.fields || []).join(', ')}`).join('\n')}

${conversation_summary ? `USER CONTEXT:\n${conversation_summary}` : ''}

Build the complete, working product now. Return only the JSON.`;

  // ── Primary: Claude Opus (best code generation) ──────────────────────────
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
          model: 'claude-opus-4-6',
          max_tokens: 16000,
          system: BUILD_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildPrompt }]
        })
      });

      const raw = await response.json();
      if (response.ok) {
        const text = raw.content?.[0]?.text;
        if (text) {
          const parsed = extractJSON(text);
          if (parsed) return res.json(parsed);
        }
      } else {
        console.error('Build Anthropic error:', raw.error?.message);
        // Fall through to Gemini
      }
    } catch (err) {
      console.error('Build Anthropic call failed, falling back to Gemini:', err.message);
    }
  }

  // ── Fallback: Gemini 2.5 Flash ───────────────────────────────────────────
  if (!geminiKey) {
    return res.status(503).json({ error: 'AI service not configured. Please add an API key.' });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: BUILD_SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: buildPrompt }] }],
          generationConfig: {
            maxOutputTokens: 8192,
            temperature: 0.3,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      }
    );

    const raw = await response.json();
    if (!response.ok) {
      const isQuota = response.status === 429 || (raw.error?.message || '').toLowerCase().includes('quota');
      const msg = isQuota
        ? 'Daily AI build limit reached. Try again after midnight PT, or add an Anthropic API key for unlimited builds.'
        : (raw.error?.message || 'Build service error');
      return res.status(isQuota ? 429 : 500).json({ error: msg });
    }

    const parts = raw.candidates?.[0]?.content?.parts || [];
    const responsePart = parts.find(p => !p.thought && p.text) || parts[0];
    const text = responsePart?.text;
    if (!text) return res.status(500).json({ error: 'Empty response from AI builder' });

    const parsed = extractJSON(text);
    if (parsed) return res.json(parsed);
    return res.status(500).json({ error: 'Failed to parse build output', raw: text.substring(0, 500) });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function extractJSON(text) {
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/s);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}
