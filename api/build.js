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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'] || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(401).json({ error: 'No API key provided. Enter your Anthropic API key in the platform.' });

  const { schematic, conversation_summary } = req.body;
  if (!schematic) return res.status(400).json({ error: 'Missing schematic' });

  const buildPrompt = `Build this product completely:

PRODUCT: ${schematic.product_name}
TAGLINE: ${schematic.tagline}
PROBLEM: ${schematic.problem}
SOLUTION: ${schematic.solution}
TYPE: ${schematic.product_type}

FEATURES TO BUILD:
${(schematic.pages_or_features || []).map(f => `- ${f.name}: ${f.description}\n  Elements: ${(f.key_elements || []).join(', ')}`).join('\n')}

KEY COMPONENTS:
${(schematic.components || []).map(c => `- ${c.name}: ${c.purpose} (${c.specs})`).join('\n')}

HOW IT WORKS:
${(schematic.how_it_works || []).map(s => `${s.step}. ${s.title}: ${s.description}`).join('\n')}

DATA MODEL:
${(schematic.data_model || []).map(d => `- ${d.entity}: ${(d.fields || []).join(', ')}`).join('\n')}

${conversation_summary ? `USER CONTEXT:\n${conversation_summary}` : ''}

Build the complete, working product now. Return only the JSON.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        system: BUILD_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildPrompt }]
      })
    });

    const raw = await response.json();
    if (!response.ok) return res.status(500).json({ error: raw.error?.message || 'Build service error' });

    const text = raw.content[0].text;

    let parsed;
    try {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/s);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse build output', raw: text.substring(0, 500) });
    }

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
