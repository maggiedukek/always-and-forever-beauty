// ============================================================================
// Always & Forever Beauty — shared helpers for the Netlify Functions API layer
// Talks to Baserow with a secret token; nothing sensitive ever reaches the
// browser. See BASEROW-SETUP.md for the environment variables this needs.
// ============================================================================
'use strict';

const crypto = require('crypto');

const BASEROW_API_URL = (process.env.BASEROW_API_URL || 'https://api.baserow.io').replace(/\/$/, '');
const BASEROW_TOKEN = process.env.BASEROW_TOKEN || '';

// Baserow table IDs (numbers) — printed by setup_baserow.py
const TABLE_IDS = {
  inquiries:      process.env.BASEROW_TABLE_INQUIRIES,
  gallery_photos: process.env.BASEROW_TABLE_GALLERY,
  contracts:      process.env.BASEROW_TABLE_CONTRACTS,
  contract_files: process.env.BASEROW_TABLE_CONTRACT_FILES,
  email_logs:     process.env.BASEROW_TABLE_EMAIL_LOGS,
  admin_settings: process.env.BASEROW_TABLE_SETTINGS
};

// Per-table quirks: which fields hold uploaded files, which hold JSON,
// and which timestamp to stamp on insert when the client didn't send one.
const TABLE_META = {
  inquiries:      { jsonFields: [], fileFields: [], numberFields: [], createdField: 'created_at' },
  gallery_photos: { jsonFields: [], fileFields: ['file_path'], numberFields: ['sort_order'], createdField: 'created_at' },
  contracts:      { jsonFields: ['line_items'], fileFields: [], createdField: 'created_at',
                    numberFields: ['package_price', 'subtotal', 'travel_fee', 'total', 'retainer', 'balance'] },
  contract_files: { jsonFields: [], fileFields: ['file_path'], numberFields: [], createdField: 'uploaded_at' },
  email_logs:     { jsonFields: [], fileFields: [], numberFields: [], createdField: null }, // sent_at set by caller
  admin_settings: { jsonFields: [], fileFields: [], numberFields: [], createdField: null }
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function json(statusCode, body) {
  return { statusCode, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS), body: JSON.stringify(body) };
}

function preflight(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  return null;
}

// ---------------------------------------------------------------------------
// Baserow REST client
// ---------------------------------------------------------------------------
async function baserow(path, options) {
  const opts = options || {};
  const headers = Object.assign({ Authorization: 'Token ' + BASEROW_TOKEN }, opts.headers || {});
  if (opts.body && !(opts.body instanceof Buffer) && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(BASEROW_API_URL + path, { method: opts.method || 'GET', headers, body: opts.body });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) ? JSON.stringify(data.detail || data.error) : ('Baserow error ' + res.status);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

function tableId(table) {
  const id = TABLE_IDS[table];
  if (!id) throw new Error("Table '" + table + "' is not configured (missing BASEROW_TABLE_* env var).");
  return id;
}

// Map a Baserow row → the shape the website expects (same field names as Supabase had)
function rowFromBaserow(table, row) {
  const meta = TABLE_META[table] || {};
  const out = Object.assign({}, row);
  (meta.fileFields || []).forEach(f => {
    const v = row[f];
    if (Array.isArray(v)) out[f] = v.length ? v[0].url : null; // file field → public URL string
  });
  (meta.jsonFields || []).forEach(f => {
    if (typeof out[f] === 'string' && out[f].trim()) {
      try { out[f] = JSON.parse(out[f]); } catch (e) { /* leave as-is */ }
    } else if (!out[f]) { out[f] = []; }
  });
  (meta.numberFields || []).forEach(f => {
    if (out[f] != null && out[f] !== '') { const n = Number(out[f]); if (!isNaN(n)) out[f] = n; }
  });
  delete out.order; // Baserow internal
  return out;
}

// Map website row values → what Baserow accepts
function rowToBaserow(table, row) {
  const meta = TABLE_META[table] || {};
  const out = {};
  Object.keys(row || {}).forEach(k => {
    if (k === 'id' || k === 'order') return;
    let v = row[k];
    if ((meta.fileFields || []).indexOf(k) >= 0) {
      // Accept: {name:..} from our upload endpoint, or null. Plain URL strings are ignored
      // (the file already lives on the row; you can't set a file field from a URL string).
      if (v && typeof v === 'object' && v.name) { out[k] = [{ name: v.name }]; }
      else if (v === null) { out[k] = []; }
      return;
    }
    if ((meta.jsonFields || []).indexOf(k) >= 0 && v && typeof v === 'object') v = JSON.stringify(v);
    if (v === undefined) return;
    out[k] = v;
  });
  return out;
}

// List every row of a table (pages through Baserow's 200-row limit)
async function listRows(table, opts) {
  const o = opts || {};
  const params = new URLSearchParams({ user_field_names: 'true', size: '200' });
  if (o.orderBy && o.orderBy.length) {
    params.set('order_by', o.orderBy.map(s => (s.asc === false ? '-' : '') + s.col).join(','));
  }
  (o.filters || []).forEach(f => params.set('filter__' + f.col + '__' + (f.op || 'equal'), String(f.val)));
  let page = 1, rows = [];
  for (;;) {
    params.set('page', String(page));
    const data = await baserow('/api/database/rows/table/' + tableId(table) + '/?' + params.toString());
    rows = rows.concat(data.results || []);
    if (!data.next || rows.length >= (o.limit || 5000)) break;
    page++;
  }
  if (o.limit) rows = rows.slice(0, o.limit);
  return rows.map(r => rowFromBaserow(table, r));
}

async function createRow(table, row) {
  const meta = TABLE_META[table] || {};
  const payload = rowToBaserow(table, row);
  if (meta.createdField && !payload[meta.createdField]) payload[meta.createdField] = new Date().toISOString();
  const data = await baserow('/api/database/rows/table/' + tableId(table) + '/?user_field_names=true', { method: 'POST', body: payload });
  return rowFromBaserow(table, data);
}

async function updateRow(table, id, patch) {
  const data = await baserow('/api/database/rows/table/' + tableId(table) + '/' + id + '/?user_field_names=true', { method: 'PATCH', body: rowToBaserow(table, patch) });
  return rowFromBaserow(table, data);
}

async function deleteRow(table, id) {
  await baserow('/api/database/rows/table/' + tableId(table) + '/' + id + '/', { method: 'DELETE' });
}

// Upload a file into Baserow's file storage. Returns { name, url, ... }
async function uploadFile(filename, buffer, contentType) {
  const boundary = '----afb' + crypto.randomBytes(12).toString('hex');
  const head = Buffer.from(
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="file"; filename="' + filename.replace(/"/g, '') + '"\r\n' +
    'Content-Type: ' + (contentType || 'application/octet-stream') + '\r\n\r\n');
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([head, buffer, tail]);
  return baserow('/api/user-files/upload-file/', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
    body
  });
}

// ---------------------------------------------------------------------------
// Admin settings (key/value rows in the admin_settings table)
// ---------------------------------------------------------------------------
async function getSetting(key) {
  const rows = await listRows('admin_settings', { filters: [{ col: 'key', val: key }] });
  return rows.length ? rows[0] : null;
}

async function setSetting(key, value) {
  const existing = await getSetting(key);
  if (existing) return updateRow('admin_settings', existing.id, { value: String(value) });
  return createRow('admin_settings', { key, value: String(value) });
}

// ---------------------------------------------------------------------------
// Passwords + tokens (no dependencies — Node's crypto only)
// ---------------------------------------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return 'pbkdf2$120000$' + salt + '$' + hash;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts[0] !== 'pbkdf2') return false;
    const iter = parseInt(parts[1], 10);
    const hash = crypto.pbkdf2Sync(password, parts[2], iter, 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(parts[3]));
  } catch (e) { return false; }
}

function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

function signToken(payload, expiresInSeconds) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set.');
  const body = Object.assign({}, payload, { exp: Math.floor(Date.now() / 1000) + expiresInSeconds });
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify(body));
  const sig = b64url(crypto.createHmac('sha256', secret).update(h + '.' + p).digest());
  return h + '.' + p + '.' + sig;
}

function verifyToken(token) {
  try {
    const secret = process.env.AUTH_SECRET;
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const expect = b64url(crypto.createHmac('sha256', secret).update(parts[0] + '.' + parts[1]).digest());
    if (!crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expect))) return null;
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) { return null; }
}

// Returns the token payload if the request carries a valid admin token, else null
function requireAdmin(event) {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const payload = verifyToken(m[1]);
  return (payload && payload.role === 'admin') ? payload : null;
}

// ---------------------------------------------------------------------------
// Email via Resend (same behavior as the old Supabase edge function)
// ---------------------------------------------------------------------------
async function sendEmail(opts) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not set in Netlify environment variables.' };
  const FROM = process.env.FROM_EMAIL || 'Always & Forever Beauty <onboarding@resend.dev>';
  const REPLY = process.env.REPLY_TO_EMAIL || 'alwaysandforeverbeautycolleen@gmail.com';
  const body = {
    from: FROM,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
    reply_to: opts.replyTo || REPLY
  };
  if (Array.isArray(opts.attachments) && opts.attachments.length) body.attachments = opts.attachments;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: (data && data.message) || 'Resend rejected the request.' };
  return { ok: true, id: data && data.id };
}

function notifyEmail() {
  return process.env.NOTIFY_EMAIL || 'alwaysandforeverbeautycolleen@gmail.com';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = {
  json, preflight, CORS,
  listRows, createRow, updateRow, deleteRow, uploadFile,
  getSetting, setSetting,
  hashPassword, verifyPassword, signToken, verifyToken, requireAdmin,
  sendEmail, notifyEmail, esc,
  TABLE_META
};
