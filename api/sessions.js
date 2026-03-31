const SUPABASE_URL = 'https://iwouaznczwhojuvmignr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3b3Vhem5jendob2p1dm1pZ25yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MDQzNTAsImV4cCI6MjA4OTk4MDM1MH0.FJ4hUYMGLkmiYcjYp8NnfsrtD-hHI8U59uYBWTtrEko';

async function verifyUser(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY }
  });
  if (!res.ok) return null;
  return await res.json();
}

async function supabase(method, path, token, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON_KEY,
      'Prefer': method === 'POST' ? 'return=representation' : 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyUser(req.headers['authorization']);
  if (!user) return res.status(401).json({ error: 'Authentication required.' });
  const token = req.headers['authorization'].replace('Bearer ', '');

  // ── GET /api/sessions — list all sessions for current user ───────────────
  if (req.method === 'GET') {
    const r = await supabase(
      'GET',
      `/forge_sessions?user_id=eq.${user.id}&select=id,product_name,product_description,phase,created_at,updated_at&order=updated_at.desc`,
      token
    );
    if (!r.ok) return res.status(500).json({ error: 'Failed to load sessions.' });
    return res.json(r.data);
  }

  // ── POST /api/sessions — create new session ──────────────────────────────
  if (req.method === 'POST') {
    const { product_name, product_description, phase, chat_history, messages_html, proposal, mockup_html, schematic, build_output, test_output } = req.body;
    const r = await supabase('POST', '/forge_sessions', token, {
      user_id: user.id,
      product_name: product_name || 'Untitled Project',
      product_description: product_description || '',
      phase: phase || 'discovery',
      chat_history: chat_history || [],
      messages_html: messages_html || '',
      proposal: proposal || null,
      mockup_html: mockup_html || null,
      schematic: schematic || null,
      build_output: build_output || null,
      test_output: test_output || null
    });
    if (!r.ok) return res.status(500).json({ error: 'Failed to create session.' });
    return res.status(201).json(r.data?.[0] || r.data);
  }

  // ── PUT /api/sessions?id=UUID — update session ───────────────────────────
  if (req.method === 'PUT') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'Session ID required.' });
    const { product_name, product_description, phase, chat_history, messages_html, proposal, mockup_html, schematic, build_output, test_output } = req.body;
    const r = await supabase(
      'PATCH',
      `/forge_sessions?id=eq.${id}&user_id=eq.${user.id}`,
      token,
      {
        product_name, product_description, phase,
        chat_history, messages_html, proposal,
        mockup_html, schematic, build_output, test_output,
        updated_at: new Date().toISOString()
      }
    );
    if (!r.ok) return res.status(500).json({ error: 'Failed to update session.' });
    return res.json({ success: true });
  }

  // ── DELETE /api/sessions?id=UUID — delete session ────────────────────────
  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'Session ID required.' });
    const r = await supabase(
      'DELETE',
      `/forge_sessions?id=eq.${id}&user_id=eq.${user.id}`,
      token
    );
    if (!r.ok) return res.status(500).json({ error: 'Failed to delete session.' });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
