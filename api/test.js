const TEST_SYSTEM_PROMPT = `You are ForgeCraft's QA and testing expert. Given a product spec and its built artifact, you generate comprehensive testing strategies and actual test code.

Return a single JSON object:
{
  "product_name": "...",
  "testing_summary": "2–3 sentence overview of the testing approach",
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured.' });

  const { schematic, build_result, is_software } = req.body;
  if (!schematic) return res.status(400).json({ error: 'Missing schematic' });

  const testPrompt = `Generate comprehensive testing for this product:

PRODUCT: ${schematic.product_name}
TYPE: ${schematic.product_type}
IS SOFTWARE: ${is_software}
PROBLEM SOLVED: ${schematic.problem}
SOLUTION: ${schematic.solution}

FEATURES:
${(schematic.pages_or_features || schematic.components || []).map(f => `- ${f.name || f.entity}: ${f.description || f.purpose}`).join('\n')}

HOW IT WORKS:
${(schematic.how_it_works || []).map(s => `${s.step}. ${s.title}: ${s.description}`).join('\n')}

${build_result ? `WHAT WAS BUILT:\n${build_result.description}\nFeatures built: ${(build_result.features_built || []).join(', ')}\nTech used: ${(build_result.tech_used || []).join(', ')}` : ''}

${!is_software ? `HARDWARE COMPONENTS:\n${(schematic.electrical_components || []).map(c => `- ${c.name} (${c.quantity}x): ${c.purpose}`).join('\n')}` : ''}

Generate the complete testing strategy and test code. Return only JSON.`;

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
        max_tokens: 8000,
        system: TEST_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: testPrompt }]
      })
    });

    const raw = await response.json();
    if (!response.ok) return res.status(500).json({ error: raw.error?.message || 'Test service error' });

    const text = raw.content[0].text;

    let parsed;
    try {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/s);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
      parsed = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({ error: 'Failed to parse test output' });
    }

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
