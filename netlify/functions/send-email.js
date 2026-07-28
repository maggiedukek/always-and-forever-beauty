// ============================================================================
// Email sender for the admin dashboard (booking confirmations, contract
// links). Requires Colleen's login token — the public pages have their own
// locked-down endpoints (inquiry-submit, contract) so this can never be used
// as an open relay.
//
// POST /api/send-email  { to, subject, html, replyTo?, attachments? }
// ============================================================================
'use strict';

const S = require('./_shared');

exports.handler = async (event) => {
  const pre = S.preflight(event); if (pre) return pre;
  if (event.httpMethod !== 'POST') return S.json(405, { ok: false, error: 'POST only' });
  if (!S.requireAdmin(event)) return S.json(401, { ok: false, error: 'Please sign in again.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return S.json(400, { ok: false, error: 'Bad JSON' }); }

  const { to, subject, html, replyTo, attachments } = body;
  if (!to || !subject || !html) {
    return S.json(400, { ok: false, error: "Missing field: 'to', 'subject', and 'html' are all required." });
  }

  const result = await S.sendEmail({ to, subject, html, replyTo, attachments });
  return S.json(result.ok ? 200 : 502, result);
};
