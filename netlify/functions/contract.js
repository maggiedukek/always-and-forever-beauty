// ============================================================================
// Public contract signing (replaces the two Supabase RPC functions).
// A contract is only ever reachable through its secret token from the
// signing link — there is no way to list or browse contracts from here.
//
// GET  /api/contract?token=...            → the contract (signature data excluded)
// POST /api/contract { action:'sign', token, signer_name, signature_type,
//                      signature_data, consent, user_agent }
//                                          → { result: 'signed' | 'not_found' |
//                                              'already_signed' | 'already_void' | 'invalid' }
// POST /api/contract { action:'email', token, kind:'owner_notify'|'client_copy',
//                      html, attachments? }
//        Sends the after-signing emails. Recipients are locked server-side to
//        Colleen and the client email already on the contract.
// ============================================================================
'use strict';

const S = require('./_shared');

// The same fields the old get_contract_by_token RPC returned (no signature_data)
const PUBLIC_FIELDS = ['client_name', 'client_email', 'wedding_date', 'venue', 'start_time',
  'package_name', 'package_price', 'line_items', 'subtotal', 'travel_fee', 'total', 'retainer',
  'balance', 'balance_due_date', 'no_changes_date', 'notes', 'contract_html', 'status',
  'signer_name', 'signed_at'];

async function findByToken(token) {
  if (!token) return null;
  const rows = await S.listRows('contracts', { filters: [{ col: 'token', val: token }], limit: 1 });
  return rows.length ? rows[0] : null;
}

function publicView(c) {
  const out = {};
  PUBLIC_FIELDS.forEach(f => { out[f] = c[f] === undefined ? null : c[f]; });
  return out;
}

exports.handler = async (event) => {
  const pre = S.preflight(event); if (pre) return pre;

  try {
    // ---- Read one contract by its token ----------------------------------
    if (event.httpMethod === 'GET') {
      const token = (event.queryStringParameters || {}).token;
      const c = await findByToken(token);
      if (!c) return S.json(200, { data: [] }); // same shape as the old RPC: empty = invalid link
      return S.json(200, { data: [publicView(c)] });
    }

    if (event.httpMethod !== 'POST') return S.json(405, { error: 'GET or POST only' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (e) { return S.json(400, { error: 'Bad JSON' }); }

    // ---- Sign -------------------------------------------------------------
    if (body.action === 'sign') {
      const c = await findByToken(body.token);
      if (!c) return S.json(200, { data: 'not_found' });
      if (c.status !== 'sent') return S.json(200, { data: 'already_' + c.status });
      const name = String(body.signer_name || '').trim();
      if (!body.consent || !name) return S.json(200, { data: 'invalid' });

      const ip = event.headers['x-nf-client-connection-ip'] ||
        (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;

      await S.updateRow('contracts', c.id, {
        status: 'signed',
        signer_name: name.slice(0, 200),
        signature_type: body.signature_type === 'drawn' ? 'drawn' : 'typed',
        signature_data: String(body.signature_data || '').slice(0, 400000),
        consent: true,
        signed_at: new Date().toISOString(),
        signer_ip: ip,
        signer_user_agent: String(body.user_agent || '').slice(0, 500)
      });
      return S.json(200, { data: 'signed' });
    }

    // ---- After-signing emails (recipients locked to the contract) --------
    if (body.action === 'email') {
      const c = await findByToken(body.token);
      if (!c || c.status !== 'signed') return S.json(400, { ok: false, error: 'Contract not found or not signed.' });
      const html = String(body.html || '');
      if (!html) return S.json(400, { ok: false, error: 'Missing email body.' });

      if (body.kind === 'owner_notify') {
        const r = await S.sendEmail({
          to: S.notifyEmail(),
          subject: 'Contract signed — ' + (c.signer_name || c.client_name || ''),
          html,
          replyTo: c.client_email || undefined
        });
        return S.json(200, r);
      }

      if (body.kind === 'client_copy') {
        if (!c.client_email) return S.json(200, { ok: false, error: 'No client email on file.' });
        const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 1).map(a => ({
          filename: String(a.filename || 'contract.pdf').replace(/[^a-zA-Z0-9._-]/g, '_'),
          content: String(a.content || '')
        })) : undefined;
        const r = await S.sendEmail({
          to: c.client_email,
          subject: 'Your signed contract — Always & Forever Beauty',
          html,
          replyTo: S.notifyEmail(),
          attachments
        });
        return S.json(200, r);
      }

      return S.json(400, { ok: false, error: 'Unknown email kind' });
    }

    return S.json(400, { error: 'Unknown action' });
  } catch (err) {
    return S.json(500, { error: String(err.message || err) });
  }
};
