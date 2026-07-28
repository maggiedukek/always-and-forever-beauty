// ============================================================================
// Admin file upload → Baserow file storage (replaces Supabase Storage).
// The browser sends the file as base64 JSON; we push it into Baserow and hand
// back { name, url }. The `name` is what a row's file field needs; the `url`
// is the permanent public link.
//
// POST /api/upload  { filename, contentType, contentBase64 }   (Bearer token)
//
// Note: Netlify functions accept request bodies up to ~6 MB, so files should
// stay under ~4 MB. The admin pages shrink photos before uploading, so this
// is only a practical limit for hand-uploaded PDFs.
// ============================================================================
'use strict';

const S = require('./_shared');

exports.handler = async (event) => {
  const pre = S.preflight(event); if (pre) return pre;
  if (event.httpMethod !== 'POST') return S.json(405, { error: 'POST only' });
  if (!S.requireAdmin(event)) return S.json(401, { error: 'Please sign in again.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return S.json(400, { error: 'Bad JSON' }); }

  const filename = String(body.filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!body.contentBase64) return S.json(400, { error: 'No file content received' });

  try {
    const buf = Buffer.from(body.contentBase64, 'base64');
    if (!buf.length) return S.json(400, { error: 'Empty file' });
    const info = await S.uploadFile(filename, buf, body.contentType);
    return S.json(200, { data: { name: info.name, url: info.url } });
  } catch (err) {
    return S.json(500, { error: String(err.message || err) });
  }
};
