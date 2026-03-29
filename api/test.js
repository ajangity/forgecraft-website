const TEST_SYSTEM_PROMPT = `You are ForgeCraft's QA and testing expert. Given a product spec and its built artifact, you generate the most comprehensive testing strategy possible.

Your job has two parts:
1. Cover every use case the USER explicitly described (their real-world workflows, day-to-day usage, success criteria, and any edge cases they mentioned)
2. Synthesize and add a large number of additional test cases that the user did NOT specify — edge cases, failure modes, boundary conditions, security issues, accessibility gaps, and stress scenarios that could occur in real-world usage even if the user never thought of them

The goal is a product that works FLAWLESSLY for the user's specific use AND for any realistic scenario that could arise.

Return a single JSON object:
{
  "product_name": "...",
  "testing_summary": "2–3 sentence overview of the testing approach",
  "user_scenarios_covered": [
    {
      "scenario": "Exactly what the user said they'd do",
      "test_cases": [
        { "name": "Test name", "steps": ["Step 1", "Step 2"], "expected": "Expected result", "priority": "critical|high|medium|low" }
      ]
    }
  ],
  "synthesized_edge_cases": [
    {
      "category": "Category name (e.g. 'Data persistence', 'Concurrency', 'Invalid input', 'Empty state')",
      "rationale": "Why this edge case matters even though the user didn't mention it",
      "test_cases": [
        { "name": "Test name", "steps": ["Step 1", "Step 2"], "expected": "Expected result", "priority": "critical|high|medium|low" }
      ]
    }
  ],
  "risk_areas": [
    { "area": "Risk area name", "severity": "high|medium|low", "description": "Why this is a risk" }
  ],
  "test_categories": [
    {
      "category": "Unit Tests | Integration Tests | E2E Tests | User Acceptance | Performance | Security | Accessibility",
      "description": "What this category covers",
      "test_cases": [
        {
          "name": "Test case name",
          "type": "automated|manual",
          "steps": ["Step 1", "Step 2"],
          "expected": "Expected result",
          "priority": "critical|high|medium|low"
        }
      ]
    }
  ],
  "automated_tests": {
    "language": "javascript | python",
    "framework": "Jest | Playwright | Pytest | etc.",
    "code": "complete test code here as a string"
  },
  "manual_test_protocol": [
    {
      "scenario": "Test scenario name",
      "persona": "Who performs this test",
      "steps": ["Step 1", "Step 2"],
      "success_criteria": "How you know it passed",
      "estimated_time": "X minutes"
    }
  ],
  "trial_case": {
    "title": "Trial case title",
    "objective": "What we're trying to prove",
    "participants": "Who should participate",
    "duration": "How long",
    "methodology": "How to run the trial",
    "metrics": ["Metric 1", "Metric 2"],
    "success_threshold": "What constitutes success"
  },
  "testing_writeup": "Comprehensive markdown-formatted writeup on how to test this specific product. Cover: why these tests matter, methodology, tools, how to interpret results, and how to iterate based on findings.",
  "acceptance_criteria": [
    { "criterion": "...", "measurement": "How to measure this" }
  ],
  "estimated_testing_time": "X hours total",
  "recommended_tools": ["Tool 1: purpose", "Tool 2: purpose"]
}

REQUIREMENTS:
1. Generate REAL, RUNNABLE test code — not pseudocode.
2. Tests must be specific to THIS product, not generic.
3. Include edge cases and failure modes.
4. The trial_case should be realistic and actionable.
5. The testing_writeup should be comprehensive (500+ words) and specific.
6. Return ONLY the JSON. No text outside it.`;

const SUPABASE_URL_T = 'https://iwouaznczwhojuvmignr.supabase.co';
const SUPABASE_ANON_KEY_T = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3b3Vhem5jendob2p1dm1pZ25yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MDQzNTAsImV4cCI6MjA4OTk4MDM1MH0.FJ4hUYMGLkmiYcjYp8NnfsrtD-hHI8U59uYBWTtrEko';

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
  const userRes = await fetch(`${SUPABASE_URL_T}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${userToken}`, 'apikey': SUPABASE_ANON_KEY_T }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Session expired. Please sign in again.' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const { schematic, build_result, is_software, usage_scenarios } = req.body;
  if (!schematic) return res.status(400).json({ error: 'Missing schematic' });

  const testPrompt = `Generate exhaustive testing for this product.

PRODUCT: ${schematic.product_name}
TYPE: ${schematic.product_type}
IS SOFTWARE: ${is_software}
PROBLEM SOLVED: ${schematic.problem}
SOLUTION: ${schematic.solution}

FEATURES:
${(schematic.pages_or_features || schematic.components || []).map(f => `- ${f.name || f.entity}: ${f.description || f.purpose}`).join('\n')}

HOW IT WORKS:
${(schematic.how_it_works || []).map(s => `${s.step}. ${s.title}: ${s.description}`).join('\n')}

${usage_scenarios && usage_scenarios.length ? `USER'S STATED USAGE SCENARIOS (test these explicitly — they represent the user's real-world workflows):
${usage_scenarios.map((s, i) => `${i+1}. ${s}`).join('\n')}

These must all work flawlessly. Generate specific test cases for each one.` : ''}

${build_result ? `WHAT WAS BUILT:\n${build_result.description}\nFeatures built: ${(build_result.features_built || []).join(', ')}\nTech used: ${(build_result.tech_used || []).join(', ')}` : ''}

${!is_software ? `HARDWARE COMPONENTS:\n${(schematic.electrical_components || []).map(c => `- ${c.name} (${c.quantity}x): ${c.purpose}`).join('\n')}` : ''}

INSTRUCTIONS:
1. First, cover every user scenario listed above with dedicated test cases
2. Then synthesize at least 15–20 additional edge cases the user didn't mention — boundary conditions, invalid input, empty states, data loss scenarios, concurrent access, accessibility, performance under load, security vulnerabilities, etc.
3. Generate real, runnable automated test code (Playwright for web, Jest for unit tests, etc.)
4. Be extremely specific to THIS product

Return only JSON.`;

  // ── Primary: Claude Opus ─────────────────────────────────────────────────
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
          max_tokens: 12000,
          system: TEST_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: testPrompt }]
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
        console.error('Test Anthropic error:', raw.error?.message);
      }
    } catch (err) {
      console.error('Test Anthropic call failed, falling back to Gemini:', err.message);
    }
  }

  // ── Fallback: Gemini 2.5 Flash ────────────────────────────────────────────
  if (!geminiKey) return res.status(503).json({ error: 'AI service not configured.' });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: TEST_SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: testPrompt }] }],
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
      return res.status(isQuota ? 429 : 500).json({ error: raw.error?.message || 'Test service error' });
    }
    const parts = raw.candidates?.[0]?.content?.parts || [];
    const responsePart = parts.find(p => !p.thought && p.text) || parts[0];
    const text = responsePart?.text;
    if (!text) return res.status(500).json({ error: 'Empty response from AI' });
    const parsed = extractJSON(text);
    if (parsed) return res.json(parsed);
    return res.status(500).json({ error: 'Failed to parse test output' });
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
  } catch { return null; }
}
