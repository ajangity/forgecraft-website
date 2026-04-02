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

// Derive category string from proposal data (mirrors analytics.js)
function deriveCategory(obj) {
  if (!obj) return null;
  const text = [obj.product_name, obj.tagline, obj.description, obj.problem_solved,
    ...(obj.key_features || [])].join(' ').toLowerCase();
  if (text.match(/habit|streak|routine|daily check/)) return 'habit_tracking';
  if (text.match(/budget|expense|spend|finance|money|saving/)) return 'personal_finance';
  if (text.match(/workout|fitness|exercise|gym|training/)) return 'fitness';
  if (text.match(/nutrition|calor|meal|food|diet|macro/)) return 'nutrition';
  if (text.match(/task|todo|project|kanban|deadline/)) return 'task_management';
  if (text.match(/note|journal|diary|writing|knowledge/)) return 'notes_journaling';
  if (text.match(/sleep|wake|rest|bedtime/)) return 'sleep';
  if (text.match(/social|post|content|schedule|instagram|twitter/)) return 'social_media';
  if (text.match(/automat|script|workflow|trigger|cron/)) return 'automation';
  if (text.match(/dashboard|analytic|report|metric|data/)) return 'analytics_dashboard';
  if (text.match(/ecommerce|shop|product|cart|inventory|store/)) return 'ecommerce';
  if (text.match(/health|medical|symptom|wellness/)) return 'health_wellness';
  if (text.match(/learn|study|flash|quiz|course|education/)) return 'education';
  if (text.match(/crm|contact|customer|lead|sales/)) return 'crm_sales';
  if (text.match(/map|location|navigate|route|gps/)) return 'navigation';
  return null;
}

// Fetch schematic context: confirmed products + top tech stacks for this category/type
async function fetchSchematicContext(category, productType) {
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  try {
    const categoryFilter = category ? `&product_category=eq.${encodeURIComponent(category)}` : '';
    const typeFilter = productType ? `&product_type=eq.${encodeURIComponent(productType)}` : '';

    // Confirmed products in same category/type (most recent 5)
    const [confirmedRes, typeRes] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/fc_product_ideas?user_confirmed=eq.true${categoryFilter}${typeFilter}&order=recorded_at.desc&limit=5&select=product_name,key_features,tech_stack,problem_solved`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      ),
      // Broader type query for tech stack frequency (up to 30 confirmed products)
      fetch(
        `${SUPABASE_URL}/rest/v1/fc_product_ideas?user_confirmed=eq.true${typeFilter}&limit=30&select=tech_stack`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      )
    ]);

    const confirmedProducts = confirmedRes.ok ? await confirmedRes.json() : [];
    const typeProducts = typeRes.ok ? await typeRes.json() : [];

    if (!confirmedProducts.length && !typeProducts.length) return null;

    // Aggregate tech stack frequencies
    const stackCounts = {};
    for (const p of typeProducts) {
      for (const t of (p.tech_stack || [])) {
        stackCounts[t] = (stackCounts[t] || 0) + 1;
      }
    }
    const topStacks = Object.entries(stackCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tech]) => tech);

    // Aggregate feature frequencies
    const featureCounts = {};
    for (const p of confirmedProducts) {
      for (const f of (p.key_features || [])) {
        featureCounts[f] = (featureCounts[f] || 0) + 1;
      }
    }
    const topFeatures = Object.entries(featureCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([feature]) => feature);

    return { confirmedProducts, topStacks, topFeatures };
  } catch {
    return null;
  }
}

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

  // Fetch platform intelligence from historical confirmed products
  const category = deriveCategory(proposal);
  const platformCtx = await fetchSchematicContext(category, proposal.product_type);

  // Build platform intelligence block if we have data
  let platformBlock = '';
  if (platformCtx && (platformCtx.confirmedProducts.length > 0 || platformCtx.topStacks.length > 0)) {
    const lines = ['\nPLATFORM INTELLIGENCE — patterns from previously confirmed ForgeCraft products:'];
    if (platformCtx.topStacks.length > 0) {
      lines.push(`Proven tech stacks for ${proposal.product_type || 'this type'}: ${platformCtx.topStacks.join(', ')}`);
    }
    if (platformCtx.topFeatures.length > 0) {
      lines.push(`Commonly requested features in this category: ${platformCtx.topFeatures.join(', ')}`);
    }
    if (platformCtx.confirmedProducts.length > 0) {
      lines.push('Similar confirmed products for reference:');
      for (const p of platformCtx.confirmedProducts.slice(0, 3)) {
        lines.push(`  • ${p.product_name}: ${p.problem_solved || ''} — stack: ${(p.tech_stack || []).join(', ')}`);
      }
    }
    lines.push('Use these patterns as grounding — prefer proven stacks unless there is a strong reason to deviate.');
    platformBlock = lines.join('\n');
  }

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
${platformBlock}

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
