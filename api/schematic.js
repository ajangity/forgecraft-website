// ForgeCraft Schematic API
// Uses Claude claude-opus-4-6 (most capable model for technical architecture design).
// Falls back to Gemini 2.5 Flash if ANTHROPIC_API_KEY is not set.

const SCHEMATIC_PROMPT = `You are ForgeCraft's principal architect. Given a confirmed product proposal, you produce a deeply detailed, buildable technical schematic.

Return a single JSON object ONLY — no text outside it:

{
  "product_name": "...",
  "tagline": "...",
  "problem": "Clear problem statement",
  "solution": "How this product solves it",
  "product_type": "web_app" | "mobile_web" | "browser_extension" | "automation_script" | "api" | "dashboard" | "hardware" | "hybrid",
  "is_software": true | false,

  "components": [
    {
      "name": "Component Name",
      "purpose": "What it does in the system",
      "specs": "Technical specs — library versions, frameworks, protocols",
      "cost_estimate": "$0" or "$X–Y/mo"
    }
  ],

  "architecture_mermaid": "graph TD\\n    A[User] --> B[Web App]\\n    B --> C[API]\\n    C --> D[Database]",

  "how_it_works": [
    { "step": 1, "title": "Step Title", "description": "Detailed description of what happens" }
  ],

  "build_plan": [
    { "phase": 1, "title": "Phase Title", "duration": "X days", "tasks": ["Specific task 1", "Specific task 2"] }
  ],

  "why_it_works": "Deep technical and UX reasoning for why this solution works. Reference specific technologies and design decisions.",

  "estimated_cost": {
    "range": "$0 – $50/mo",
    "notes": "Breakdown of cost drivers. Free tier details."
  },

  "build_time": "X–Y days",
  "difficulty": "beginner" | "intermediate" | "advanced" | "expert",

  "pages_or_features": [
    {
      "name": "Feature/Page Name",
      "description": "What it does",
      "key_elements": ["UI element or function 1", "UI element or function 2"]
    }
  ],

  "data_model": [
    { "entity": "EntityName", "fields": ["id: uuid", "name: string", "created_at: timestamp"] }
  ],

  "api_endpoints": [
    { "method": "GET|POST|PUT|DELETE", "path": "/api/endpoint", "description": "Purpose and payload" }
  ]
}

RULES:
- Be highly specific — reference exact libraries, frameworks, and implementation patterns
- Include every feature from the proposal in pages_or_features
- Make architecture_mermaid a valid Mermaid graph TD diagram
- The schematic must be complete enough that a developer can build it without ambiguity
- Return ONLY the JSON object`;

const SUPABASE_URL = 'https://iwouaznczwhojuvmignr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3b3Vhem5jendob2p1dm1pZ25yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MDQzNTAsImV4cCI6MjA4OTk4MDM1MH0.FJ4hUYMGLkmiYcjYp8NnfsrtD-hHI8U59uYBWTtrEko';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: verify Supabase session
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  const userToken = authHeader.replace('Bearer ', '');
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${userToken}`, 'apikey': SUPABASE_ANON_KEY }
  });
  if (!userRes.ok) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  const { proposal, conversation_summary } = req.body;
  if (!proposal) return res.status(400).json({ error: 'Missing proposal data' });

  const userPrompt = `Generate a complete technical schematic for this confirmed product proposal:

PRODUCT: ${proposal.product_name}
TAGLINE: ${proposal.tagline}
TYPE: ${proposal.product_type}
IS SOFTWARE: ${proposal.is_software}
DESCRIPTION: ${proposal.description}
PROBLEM SOLVED: ${proposal.problem_solved}

KEY FEATURES:
${(proposal.key_features || []).map(f => `- ${f}`).join('\n')}

TECH STACK HINTS:
${(proposal.tech_stack || []).join(', ')}

${conversation_summary ? `USER CONTEXT FROM CONVERSATION:\n${conversation_summary}` : ''}

Generate the full schematic now. Return only the JSON object.`;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // ── Primary: Claude claude-opus-4-6 (best for complex architecture) ──────────────────
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
          max_tokens: 8000,
          system: SCHEMATIC_PROMPT,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });

      const raw = await response.json();
      if (!response.ok) {
        console.error('Anthropic schematic error:', raw.error?.message);
        // Fall through to Gemini fallback
      } else {
        const text = raw.content?.[0]?.text;
        if (text) {
          const parsed = extractJSON(text);
          if (parsed) return res.json(parsed);
        }
      }
    } catch (err) {
      console.error('Anthropic call failed, falling back to Gemini:', err.message);
    }
  }

  // ── Fallback: Gemini 2.5 Flash ──────────────────────────────────────────────
  if (!geminiKey) {
    return res.status(503).json({ error: 'No AI service configured. Set ANTHROPIC_API_KEY or GEMINI_API_KEY.' });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SCHEMATIC_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            maxOutputTokens: 8000,
            temperature: 0.4,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 8000 }  // Enable deep thinking for architecture design
          }
        })
      }
    );

    const raw = await response.json();
    if (!response.ok) {
      console.error('Gemini schematic error:', JSON.stringify(raw));
      return res.status(500).json({ error: raw.error?.message || 'AI service error' });
    }

    const parts = raw.candidates?.[0]?.content?.parts || [];
    const responsePart = parts.find(p => !p.thought && p.text) || parts[0];
    const text = responsePart?.text;
    if (!text) return res.status(500).json({ error: 'Empty response from AI' });

    const parsed = extractJSON(text);
    if (!parsed) return res.status(500).json({ error: 'Could not parse schematic JSON' });

    return res.json(parsed);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function extractJSON(text) {
  try {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/);
    const str = match ? (match[1] || match[0]) : text;
    return JSON.parse(str);
  } catch {
    return null;
  }
}
