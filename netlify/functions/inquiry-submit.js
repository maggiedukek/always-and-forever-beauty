// ============================================================================
// Public endpoint for the booking form. Saves the inquiry to Baserow, then
// (best-effort) emails Colleen an alert and the bride an auto-reply — the
// same emails the site sent before, now built server-side so the endpoint
// can't be misused to send arbitrary mail.
//
// POST /api/inquiry-submit  { name, email, phone, wedding_date,
//                             services_needed, wedding_size, message }
// ============================================================================
'use strict';

const S = require('./_shared');
const esc = S.esc;

function prettyDate(d) {
  if (!d) return 'Not specified';
  const dt = new Date(d + 'T00:00:00');
  return isNaN(dt) ? d : dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function row(l, v) {
  return '<tr><td style="padding:6px 14px;color:#9a8b82;font:600 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;vertical-align:top">' + l +
    '</td><td style="padding:6px 14px;color:#4a322f;font:14px Georgia,serif">' + v + '</td></tr>';
}

function ownerHtml(p, dateStr) {
  return '<div style="max-width:560px;margin:0 auto;font-family:Georgia,serif;color:#4a322f">' +
    '<div style="background:#5b4042;color:#f6e7db;padding:18px 22px;border-radius:8px 8px 0 0">' +
    '<div style="font:700 13px Arial;letter-spacing:.12em">ALWAYS &amp; FOREVER BEAUTY</div>' +
    '<div style="font-size:19px;margin-top:4px">New wedding inquiry</div></div>' +
    '<div style="border:1px solid #e7d9cc;border-top:none;border-radius:0 0 8px 8px;padding:14px 8px">' +
    '<table style="width:100%;border-collapse:collapse">' +
    row('Name', esc(p.name)) + row('Email', esc(p.email)) + row('Phone', esc(p.phone)) +
    row('Wedding date', esc(dateStr)) + row('Package', esc(p.services_needed || 'Not specified')) +
    row('Party size', esc(p.wedding_size || 'Not specified')) + row('Message', esc(p.message || '—')) +
    '</table>' +
    '<p style="font:13px Arial;color:#9a8b82;padding:4px 14px 0">Reply to this email to respond directly to ' + esc(p.name) + '.</p>' +
    '</div></div>';
}

function brideHtml(p, dateStr) {
  const firstName = (p.name || '').split(' ')[0] || p.name || 'there';
  return '<div style="max-width:560px;margin:0 auto;font-family:Georgia,serif;color:#4a322f">' +
    '<div style="background:#5b4042;color:#f6e7db;padding:22px;border-radius:8px 8px 0 0;text-align:center">' +
    '<div style="font:700 13px Arial;letter-spacing:.12em">ALWAYS &amp; FOREVER BEAUTY</div>' +
    '<div style="font-size:22px;margin-top:6px;font-style:italic">Thank you!</div></div>' +
    '<div style="border:1px solid #e7d9cc;border-top:none;border-radius:0 0 8px 8px;padding:24px">' +
    '<p style="font-size:15px;line-height:1.6">Hi ' + esc(firstName) + ',</p>' +
    '<p style="font-size:15px;line-height:1.6">Thank you so much for reaching out to Always &amp; Forever Beauty! I\'ve received your inquiry and I\'ll personally be in touch within 48 hours with the next steps for your big day.</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:14px 0;background:#fbf5ee;border-radius:8px">' +
    row('Wedding date', esc(dateStr)) +
    row('Package', esc(p.services_needed || 'We can help you choose')) +
    row('Party size', esc(p.wedding_size || '—')) +
    '</table>' +
    '<p style="font-size:15px;line-height:1.6">I can\'t wait to hear more about your day.</p>' +
    '<p style="font-size:15px;line-height:1.6;margin-top:18px">With love,<br><span style="color:#a8843b;font-style:italic;font-size:17px">Colleen</span></p>' +
    '</div>' +
    '<p style="text-align:center;color:#9a8b82;font:12px Arial;margin-top:14px">Always &amp; Forever Beauty LLC · Pequot Lakes, MN</p></div>';
}

exports.handler = async (event) => {
  const pre = S.preflight(event); if (pre) return pre;
  if (event.httpMethod !== 'POST') return S.json(405, { error: 'POST only' });

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch (e) { return S.json(400, { error: 'Bad JSON' }); }

  // Only the fields the form collects — nothing else gets through
  const clean = (v, max) => { const s = String(v == null ? '' : v).trim().slice(0, max || 300); return s || null; };
  const inquiry = {
    name: clean(p.name, 120),
    email: clean(p.email, 200),
    phone: clean(p.phone, 40),
    wedding_date: clean(p.wedding_date, 10),
    services_needed: clean(p.services_needed, 120),
    wedding_size: clean(p.wedding_size, 60),
    message: clean(p.message, 4000),
    status: 'new'
  };
  if (!inquiry.name || !inquiry.email) return S.json(400, { error: 'Name and email are required.' });
  if (inquiry.wedding_date && !/^\d{4}-\d{2}-\d{2}$/.test(inquiry.wedding_date)) inquiry.wedding_date = null;

  try {
    await S.createRow('inquiries', inquiry);
  } catch (err) {
    return S.json(500, { error: 'Could not save your inquiry: ' + String(err.message || err) });
  }

  // Emails are best-effort — the inquiry is already saved either way
  const dateStr = prettyDate(inquiry.wedding_date);
  try {
    await S.sendEmail({
      to: S.notifyEmail(),
      subject: 'New inquiry — ' + inquiry.name + ' · ' + dateStr,
      html: ownerHtml(inquiry, dateStr),
      replyTo: inquiry.email || undefined
    });
    await S.sendEmail({
      to: inquiry.email,
      subject: 'Thank you for your inquiry — Always & Forever Beauty',
      html: brideHtml(inquiry, dateStr)
    });
  } catch (e) { /* non-blocking */ }

  return S.json(200, { ok: true });
};
