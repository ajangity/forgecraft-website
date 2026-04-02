const SUPABASE_URL = 'https://iwouaznczwhojuvmignr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3b3Vhem5jendob2p1dm1pZ25yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MDQzNTAsImV4cCI6MjA4OTk4MDM1MH0.FJ4hUYMGLkmiYcjYp8NnfsrtD-hHI8U59uYBWTtrEko';

async function verifyUser(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY }
  });
  if (!res.ok) return null;
  const user = await res.json();
  return { user, token };
}

async function insert(table, token, payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON_KEY,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

async function upsert(table, token, payload, onConflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON_KEY,
      'Prefer': 'return=representation,resolution=merge-duplicates'
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  return { ok: res.ok, data: text ? JSON.parse(text) : null };
}

async function patch(table, token, id, payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON_KEY,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  return { ok: res.ok, data: text ? JSON.parse(text) : null };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth — analytics still requires login so we know who the data belongs to
  const auth = await verifyUser(req.headers['authorization']);
  if (!auth) return res.status(401).json({ error: 'Authentication required.' });
  const { user, token } = auth;

  const { event, data } = req.body;
  if (!event) return res.status(400).json({ error: 'event required' });

  // ── Fire-and-forget pattern: always return 200 quickly
  // Each event type writes to the appropriate table(s)

  switch (event) {

    // ── Proposal confirmed ─────────────────────────────────────────────────
    // Fires when user clicks "Yes, build this!" on a proposal card
    // Populates: fc_consumer_needs, fc_customer_problems, fc_product_ideas
    case 'proposal_confirmed': {
      const { session_id, proposal, conversation_summary, first_message } = data;
      const uid = user.id;

      // Consumer needs
      await insert('fc_consumer_needs', token, {
        session_id: session_id || null,
        user_id: uid,
        raw_description: first_message || null,
        distilled_needs: proposal?.key_features || [],
        target_audience: null,
        environment: proposal?.product_type?.includes('mobile') ? 'mobile' : 'web',
        must_haves: proposal?.key_features || [],
        nice_to_haves: [],
        product_category: deriveCategory(proposal)
      });

      // Customer problem
      await insert('fc_customer_problems', token, {
        session_id: session_id || null,
        user_id: uid,
        problem_statement: proposal?.problem_solved || '',
        problem_category: deriveCategory(proposal),
        raw_context: first_message || conversation_summary || null,
        current_workarounds: null,
        frequency: null,
        severity: null,
        environment: proposal?.product_type?.includes('mobile') ? 'mobile' : 'web'
      });

      // Product idea
      const r = await insert('fc_product_ideas', token, {
        session_id: session_id || null,
        user_id: uid,
        product_name: proposal?.product_name || 'Untitled',
        tagline: proposal?.tagline || null,
        description: proposal?.description || null,
        product_type: proposal?.product_type || null,
        is_software: proposal?.is_software !== false,
        key_features: proposal?.key_features || [],
        problem_solved: proposal?.problem_solved || null,
        tech_stack: proposal?.tech_stack || [],
        usage_scenarios: proposal?.usage_scenarios || [],
        user_confirmed: true,
        was_recommendation: data.was_recommendation || false,
        source_app: data.source_app || null
      });

      return res.status(200).json({ ok: true, product_idea_id: r.data?.[0]?.id });
    }

    // ── Proposal rejected ──────────────────────────────────────────────────
    // Fires when user clicks "Not quite right" — still capture the data
    case 'proposal_rejected': {
      const { session_id, proposal, first_message } = data;
      await insert('fc_product_ideas', token, {
        session_id: session_id || null,
        user_id: user.id,
        product_name: proposal?.product_name || 'Untitled',
        tagline: proposal?.tagline || null,
        description: proposal?.description || null,
        product_type: proposal?.product_type || null,
        is_software: proposal?.is_software !== false,
        key_features: proposal?.key_features || [],
        problem_solved: proposal?.problem_solved || null,
        tech_stack: proposal?.tech_stack || [],
        usage_scenarios: proposal?.usage_scenarios || [],
        user_confirmed: false
      });
      await insert('fc_consumer_needs', token, {
        session_id: session_id || null,
        user_id: user.id,
        raw_description: first_message || null,
        distilled_needs: proposal?.key_features || [],
        must_haves: [],
        nice_to_haves: proposal?.key_features || [],
        product_category: deriveCategory(proposal)
      });
      return res.status(200).json({ ok: true });
    }

    // ── Recommendation shown ───────────────────────────────────────────────
    // Fires when the AI shows an existing product recommendation card
    case 'recommendation_shown': {
      const { session_id, recommended_app, app_category, original_description } = data;
      const r = await insert('fc_recommendation_outcomes', token, {
        session_id: session_id || null,
        user_id: user.id,
        recommended_app,
        app_category: app_category || null,
        user_choice: null,        // not chosen yet
        original_description: original_description || null
      });
      return res.status(200).json({ ok: true, rec_id: r.data?.[0]?.id });
    }

    // ── Recommendation chosen ──────────────────────────────────────────────
    // Fires when user clicks "Build a clone" or "Customize it for me"
    case 'recommendation_chosen': {
      const { rec_id, choice } = data;  // choice: 'clone' | 'customize'
      if (rec_id) {
        await patch('fc_recommendation_outcomes', token, rec_id, { user_choice: choice });
      }
      return res.status(200).json({ ok: true });
    }

    // ── Tests generated ────────────────────────────────────────────────────
    // Fires after the testing phase completes
    case 'tests_generated': {
      const { session_id, product_name, product_type, is_software, test_data, usage_scenarios } = data;
      const categories = test_data?.test_categories || [];
      const total = categories.reduce((n, c) => n + (c.test_cases?.length || 0), 0);
      await insert('fc_testing_strategies', token, {
        session_id: session_id || null,
        user_id: user.id,
        product_name: product_name || null,
        product_type: product_type || null,
        is_software: is_software !== false,
        test_categories: categories,
        total_test_cases: total,
        category_count: categories.length,
        key_scenarios: usage_scenarios || []
      });
      return res.status(200).json({ ok: true });
    }

    // ── Build completed ────────────────────────────────────────────────────
    // Fires when the build phase succeeds
    case 'build_completed': {
      const { session_id, build_data, schematic } = data;
      const files = build_data?.files || [];
      await insert('fc_build_analytics', token, {
        session_id: session_id || null,
        user_id: user.id,
        product_name: build_data?.product_name || schematic?.product_name || null,
        product_type: schematic?.product_type || null,
        product_category: deriveCategory(schematic),
        tech_stack: schematic?.tech_stack || build_data?.tech_stack || [],
        file_count: files.length,
        build_success: true
      });
      // Also mark product idea as reached_build
      if (data.session_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/fc_product_ideas?session_id=eq.${data.session_id}&user_confirmed=eq.true`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': SUPABASE_ANON_KEY
          },
          body: JSON.stringify({ reached_build: true })
        });
      }
      return res.status(200).json({ ok: true });
    }

    // ── Build failed ───────────────────────────────────────────────────────
    case 'build_failed': {
      const { session_id, error_message, schematic } = data;
      await insert('fc_build_analytics', token, {
        session_id: session_id || null,
        user_id: user.id,
        product_name: schematic?.product_name || null,
        product_type: schematic?.product_type || null,
        product_category: deriveCategory(schematic),
        tech_stack: schematic?.tech_stack || [],
        file_count: 0,
        build_success: false,
        error_message: error_message || null
      });
      return res.status(200).json({ ok: true });
    }

    // ── Session engagement ─────────────────────────────────────────────────
    // Upserts engagement data keyed on session_id — called on phase changes
    case 'engagement_update': {
      const { session_id, phases_reached, dropped_at_phase, completed_full_flow,
              messages_sent, discovery_questions_asked, mockup_iterations, proposal_rejected } = data;

      // Try to update existing row for this session first
      if (session_id) {
        const existing = await fetch(
          `${SUPABASE_URL}/rest/v1/fc_session_engagement?session_id=eq.${session_id}`,
          { headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY } }
        );
        const rows = await existing.json();
        if (rows?.length > 0) {
          await patch('fc_session_engagement', token, rows[0].id, {
            phases_reached: phases_reached || rows[0].phases_reached,
            dropped_at_phase: dropped_at_phase || null,
            completed_full_flow: completed_full_flow || rows[0].completed_full_flow,
            messages_sent: messages_sent ?? rows[0].messages_sent,
            discovery_questions_asked: discovery_questions_asked ?? rows[0].discovery_questions_asked,
            mockup_iterations: mockup_iterations ?? rows[0].mockup_iterations,
            proposal_rejected: proposal_rejected ?? rows[0].proposal_rejected,
            last_activity_at: new Date().toISOString()
          });
          return res.status(200).json({ ok: true });
        }
      }

      // Create new engagement row
      await insert('fc_session_engagement', token, {
        session_id: session_id || null,
        user_id: user.id,
        phases_reached: phases_reached || [],
        dropped_at_phase: dropped_at_phase || null,
        completed_full_flow: completed_full_flow || false,
        messages_sent: messages_sent || 0,
        discovery_questions_asked: discovery_questions_asked || 0,
        mockup_iterations: mockup_iterations || 0,
        proposal_rejected: proposal_rejected || false,
        last_activity_at: new Date().toISOString()
      });

      return res.status(200).json({ ok: true });
    }

    default:
      return res.status(400).json({ error: `Unknown event type: ${event}` });
  }
}

// Derive a plain category string from proposal/schematic data
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
  return 'other';
}
