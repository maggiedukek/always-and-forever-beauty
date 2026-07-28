// ============================================================================
// Admin login for Colleen's dashboard (replaces Supabase Auth).
// The password hash lives in the Baserow admin_settings table, so it can be
// changed from the dashboard and reset by email — no code changes needed.
//
// POST /api/auth   { action: 'login', email, password }
//                  { action: 'forgot', email, origin }
//                  { action: 'change_password', password }        (Bearer token)
//                  { action: 'session' }                          (Bearer token)
// ============================================================================
'use strict';

const S = require('./_shared');

const SESSION_SECONDS = 60 * 60 * 24 * 7; // signed in for a week
const RESET_SECONDS = 60 * 30;            // reset links live 30 minutes

function adminEmail() { return (process.env.ADMIN_EMAIL || '').trim().toLowerCase(); }

async function buildSession(mustChange) {
  const token = S.signToken({ role: 'admin', email: adminEmail() }, SESSION_SECONDS);
  return {
    token,
    user: { email: adminEmail(), user_metadata: { must_change_password: !!mustChange } },
    expires_at: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  };
}

exports.handler = async (event) => {
  const pre = S.preflight(event); if (pre) return pre;
  if (event.httpMethod !== 'POST') return S.json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return S.json(400, { error: 'Bad JSON' }); }

  try {
    // -- Sign in ------------------------------------------------------------
    if (body.action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || !password) return S.json(400, { error: 'Email and password are required.' });
      if (email !== adminEmail()) return S.json(401, { error: 'Invalid login credentials' });
      const hashRow = await S.getSetting('password_hash');
      if (!hashRow || !S.verifyPassword(password, hashRow.value)) {
        return S.json(401, { error: 'Invalid login credentials' });
      }
      const mustRow = await S.getSetting('must_change_password');
      return S.json(200, { session: await buildSession(mustRow && mustRow.value === 'true') });
    }

    // -- Forgot password: email a 30-minute reset link ----------------------
    if (body.action === 'forgot') {
      const email = String(body.email || '').trim().toLowerCase();
      // Always answer OK so the form can't be used to probe the login email
      if (email === adminEmail()) {
        const reset = S.signToken({ role: 'reset', email }, RESET_SECONDS);
        const origin = String(body.origin || process.env.URL || '').replace(/\/$/, '');
        const link = origin + '/admin/reset-password.html?reset=' + reset;
        await S.sendEmail({
          to: adminEmail(),
          subject: 'Reset your Always & Forever Beauty dashboard password',
          html: '<div style="font-family:Georgia,serif;color:#4a322f;max-width:520px;margin:0 auto">' +
            '<h2 style="color:#5b4042">Password reset</h2>' +
            '<p>Click the link below to choose a new dashboard password. It works for 30 minutes.</p>' +
            '<p><a href="' + link + '" style="background:#C49A38;color:#fff;text-decoration:none;padding:12px 26px;border-radius:4px;display:inline-block">Choose a new password</a></p>' +
            '<p style="font-size:12px;color:#9a8b82">If you didn\'t ask for this, you can ignore this email.</p></div>'
        });
      }
      return S.json(200, { ok: true });
    }

    // -- Change password (from the dashboard, or a reset link) --------------
    if (body.action === 'change_password') {
      const auth = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
      const payload = S.verifyToken(auth);
      if (!payload || (payload.role !== 'admin' && payload.role !== 'reset')) {
        return S.json(401, { error: 'This link has expired. Please log in (or use “Forgot password” again).' });
      }
      const pw = String(body.password || '');
      if (pw.length < 6) return S.json(400, { error: 'Please use at least 6 characters.' });
      await S.setSetting('password_hash', S.hashPassword(pw));
      await S.setSetting('must_change_password', 'false');
      return S.json(200, { session: await buildSession(false) });
    }

    // -- Validate an existing token -----------------------------------------
    if (body.action === 'session') {
      const admin = S.requireAdmin(event);
      if (!admin) return S.json(401, { error: 'Not signed in' });
      const mustRow = await S.getSetting('must_change_password');
      return S.json(200, { session: await buildSession(mustRow && mustRow.value === 'true') });
    }

    return S.json(400, { error: 'Unknown action' });
  } catch (err) {
    return S.json(500, { error: String(err.message || err) });
  }
};
