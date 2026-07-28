// ============================================================================
// Generic table access for the site, backed by Baserow.
//
// POST /api/db  { table, op, ... }
//   op: 'select'  { order: [{col, asc}], limit }
//       'insert'  { rows: [ {...} ] }
//       'update'  { id, patch }
//       'delete'  { id }  or  { all: true }
//
// Public (no login):  select on gallery_photos — that's it.
// Everything else requires Colleen's admin token.
// ============================================================================
'use strict';

const S = require('./_shared');

const ADMIN_TABLES = ['inquiries', 'gallery_photos', 'contracts', 'contract_files', 'email_logs'];
const PUBLIC_SELECT = ['gallery_photos'];

exports.handler = async (event) => {
  const pre = S.preflight(event); if (pre) return pre;
  if (event.httpMethod !== 'POST') return S.json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return S.json(400, { error: 'Bad JSON' }); }

  const table = String(body.table || '');
  const op = String(body.op || '');
  if (ADMIN_TABLES.indexOf(table) < 0) return S.json(400, { error: 'Unknown table' });

  const isPublicRead = op === 'select' && PUBLIC_SELECT.indexOf(table) >= 0;
  if (!isPublicRead && !S.requireAdmin(event)) return S.json(401, { error: 'Please sign in again.' });

  try {
    if (op === 'select') {
      const rows = await S.listRows(table, { orderBy: body.order || [], limit: body.limit || 0 });
      return S.json(200, { data: rows });
    }

    if (op === 'insert') {
      const rows = Array.isArray(body.rows) ? body.rows : [body.rows];
      const created = [];
      for (const r of rows) created.push(await S.createRow(table, r || {}));
      return S.json(200, { data: created });
    }

    if (op === 'update') {
      if (!body.id) return S.json(400, { error: 'id required' });
      const updated = await S.updateRow(table, body.id, body.patch || {});
      return S.json(200, { data: updated });
    }

    if (op === 'delete') {
      if (body.all === true) {
        const rows = await S.listRows(table, {});
        for (const r of rows) await S.deleteRow(table, r.id);
        return S.json(200, { data: { deleted: rows.length } });
      }
      if (!body.id) return S.json(400, { error: 'id required' });
      await S.deleteRow(table, body.id);
      return S.json(200, { data: { deleted: 1 } });
    }

    return S.json(400, { error: 'Unknown op' });
  } catch (err) {
    return S.json(500, { error: String(err.message || err) });
  }
};
