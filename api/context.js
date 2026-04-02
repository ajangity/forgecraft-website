/**
 * ForgeCraft Context API
 *
 * Queries the analytics database to surface patterns from past confirmed
 * products and test strategies. This data is injected into schematic and
 * test generation prompts so every new product benefits from everything
 * ForgeCraft has already built and learned.
 *
 * GET /api/context?mode=schematic&category=habit_tracking&product_type=web_app
 * GET /api/context?mode=testing&product_type=web_app&category=habit_tracking
 */

const SUPABASE_URL = 'https://iwouaznczwhojuvmignr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3b3Vhem5jendob2p1dm1pZ25yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MDQzNTAsImV4cCI6MjA4OTk4MDM1MH0.FJ4hUYMGLkmiYcjYp8NnfsrtD-hHI8U59uYBWTtrEko';

// Service role key — needed to SELECT across all users' analytics rows
// Falls back to anon key (returns empty results if RLS blocks cross-user reads)
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

async function query(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY
    },
    body: JSON.stringify({ query: sql })
  });
  if (!res.ok) return null;
  return await res.json();
}

async function select(table, params, token) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: {
      'Authorization': `Bearer ${token || SERVICE_KEY}`,
      'apikey': SERVICE_KEY
    }
  });
  if (!res.ok) return [];
  return await res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { mode, category, product_type, limit = '5' } = req.query;
  const n = Math.min(parseInt(limit) || 5, 10);

  // ── SCHEMATIC MODE ─────────────────────────────────────────────────────────
  // Returns: confirmed product patterns, common tech stacks, common features
  // Used to: inject proven architectural context into schematic generation
  if (mode === 'schematic') {
    try {
      // 1. Confirmed products in same category → real examples
      const categoryFilter = category ? `product_category=eq.${encodeURIComponent(category)}` : '';
      const typeFilter = product_type ? `product_type=eq.${encodeURIComponent(product_type)}` : '';
      const filters = [categoryFilter, typeFilter, 'user_confirmed=eq.true', `limit=${n}`, 'order=recorded_at.desc']
        .filter(Boolean).join('&');

      const confirmedProducts = await fetch(
        `${SUPABASE_URL}/rest/v1/fc_product_ideas?${filters}&select=product_name,key_features,tech_stack,problem_solved,usage_scenarios,reached_build`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      ).then(r => r.ok ? r.json() : []).catch(() => []);

      // 2. All confirmed products of this type (broader, for tech stack frequency)
      const typeProducts = await fetch(
        `${SUPABASE_URL}/rest/v1/fc_product_ideas?product_type=eq.${encodeURIComponent(product_type || 'web_app')}&user_confirmed=eq.true&select=tech_stack,key_features&limit=30`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      ).then(r => r.ok ? r.json() : []).catch(() => []);

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
        .map(([tech, count]) => ({ tech, count }));

      // Aggregate feature frequencies for this category
      const featureCounts = {};
      for (const p of confirmedProducts) {
        for (const f of (p.key_features || [])) {
          featureCounts[f] = (featureCounts[f] || 0) + 1;
        }
      }
      const topFeatures = Object.entries(featureCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([feature, count]) => ({ feature, count }));

      // Built products (reached full build) — highest quality signal
      const builtProducts = confirmedProducts.filter(p => p.reached_build);

      return res.json({
        mode: 'schematic',
        has_data: confirmedProducts.length > 0,
        confirmed_count: confirmedProducts.length,
        confirmed_products: confirmedProducts.slice(0, n),
        built_products: builtProducts.slice(0, 3),
        top_tech_stacks: topStacks,
        top_features: topFeatures,
        category,
        product_type
      });
    } catch (err) {
      console.error('Context (schematic) error:', err.message);
      return res.json({ mode: 'schematic', has_data: false });
    }
  }

  // ── TESTING MODE ───────────────────────────────────────────────────────────
  // Returns: proven test category patterns, common edge cases, risk areas
  // Used to: inject historical test coverage into test generation
  if (mode === 'testing') {
    try {
      const typeFilter = product_type ? `product_type=eq.${encodeURIComponent(product_type)}` : '';
      const filters = [typeFilter, `limit=${n * 2}`, 'order=recorded_at.desc', 'total_test_cases=gte.5']
        .filter(Boolean).join('&');

      const testStrategies = await fetch(
        `${SUPABASE_URL}/rest/v1/fc_testing_strategies?${filters}&select=product_name,product_type,test_categories,total_test_cases,key_scenarios`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      ).then(r => r.ok ? r.json() : []).catch(() => []);

      // Aggregate category names and their test case patterns across all historical strategies
      const categoryPatterns = {};
      for (const strategy of testStrategies) {
        for (const cat of (strategy.test_categories || [])) {
          const name = cat.category || cat.name;
          if (!name) continue;
          if (!categoryPatterns[name]) {
            categoryPatterns[name] = { count: 0, test_names: [], total_cases: 0 };
          }
          categoryPatterns[name].count++;
          categoryPatterns[name].total_cases += (cat.test_cases?.length || 0);
          // Sample up to 3 test case names from this category
          const sample = (cat.test_cases || []).slice(0, 3).map(tc => tc.name).filter(Boolean);
          categoryPatterns[name].test_names.push(...sample);
        }
      }

      // Top categories by frequency
      const topCategories = Object.entries(categoryPatterns)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 8)
        .map(([category, data]) => ({
          category,
          seen_in_products: data.count,
          avg_test_cases: Math.round(data.total_cases / data.count),
          example_test_names: [...new Set(data.test_names)].slice(0, 5)
        }));

      // Aggregate scenarios that appear across multiple strategies
      const scenarioCounts = {};
      for (const strategy of testStrategies) {
        for (const s of (strategy.key_scenarios || [])) {
          const key = String(s).toLowerCase().slice(0, 80);
          scenarioCounts[key] = (scenarioCounts[key] || 0) + 1;
        }
      }
      const recurringScenarios = Object.entries(scenarioCounts)
        .filter(([, count]) => count > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([scenario]) => scenario);

      // Find the highest-coverage strategy as a gold standard example
      const goldStandard = testStrategies
        .sort((a, b) => (b.total_test_cases || 0) - (a.total_test_cases || 0))[0];

      return res.json({
        mode: 'testing',
        has_data: testStrategies.length > 0,
        strategies_analyzed: testStrategies.length,
        top_test_categories: topCategories,
        recurring_scenarios: recurringScenarios,
        gold_standard: goldStandard ? {
          product_name: goldStandard.product_name,
          total_test_cases: goldStandard.total_test_cases,
          categories: (goldStandard.test_categories || []).map(c => c.category || c.name).filter(Boolean)
        } : null,
        product_type
      });
    } catch (err) {
      console.error('Context (testing) error:', err.message);
      return res.json({ mode: 'testing', has_data: false });
    }
  }

  // ── DISCOVERY MODE ─────────────────────────────────────────────────────────
  // Returns: top needs/problems for a category — used to sharpen discovery questions
  if (mode === 'discovery') {
    try {
      const needs = await fetch(
        `${SUPABASE_URL}/rest/v1/fc_consumer_needs?product_category=eq.${encodeURIComponent(category || '')}&select=distilled_needs,must_haves&limit=20`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      ).then(r => r.ok ? r.json() : []).catch(() => []);

      const problems = await fetch(
        `${SUPABASE_URL}/rest/v1/fc_customer_problems?problem_category=eq.${encodeURIComponent(category || '')}&select=problem_statement&limit=20`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      ).then(r => r.ok ? r.json() : []).catch(() => []);

      // Count most-requested features across needs
      const featureCounts = {};
      for (const n of needs) {
        for (const f of [...(n.distilled_needs || []), ...(n.must_haves || [])]) {
          featureCounts[f] = (featureCounts[f] || 0) + 1;
        }
      }
      const topRequested = Object.entries(featureCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([feature, count]) => ({ feature, count }));

      return res.json({
        mode: 'discovery',
        has_data: needs.length > 0 || problems.length > 0,
        top_requested_features: topRequested,
        common_problems: problems.slice(0, 5).map(p => p.problem_statement),
        category
      });
    } catch (err) {
      return res.json({ mode: 'discovery', has_data: false });
    }
  }

  return res.status(400).json({ error: 'mode must be schematic | testing | discovery' });
}
