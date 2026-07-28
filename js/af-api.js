// ============================================================================
// Always & Forever Beauty — tiny API client for the admin pages.
// Looks and feels like the old supabase-js client (sb.from / sb.auth /
// sb.storage / sb.functions) but talks to our own Netlify Functions, which
// hold the Baserow token securely on the server.
// ============================================================================
(function () {
  'use strict';

  var SESSION_KEY = 'af_admin_session';
  var uploads = {}; // path → { name, url } from /api/upload, used within a page

  function readSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s || !s.token) return null;
      if (s.expires_at && s.expires_at * 1000 < Date.now()) { localStorage.removeItem(SESSION_KEY); return null; }
      return s;
    } catch (e) { return null; }
  }
  function writeSession(s) {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }
  function resetTokenFromUrl() {
    try { return new URLSearchParams(location.search).get('reset'); } catch (e) { return null; }
  }
  function authHeaders() {
    var s = readSession();
    var t = (s && s.token) || resetTokenFromUrl();
    return t ? { Authorization: 'Bearer ' + t } : {};
  }

  async function post(path, body, extraHeaders) {
    var res, data;
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(), extraHeaders || {}),
        body: JSON.stringify(body || {})
      });
      data = await res.json().catch(function () { return null; });
    } catch (e) {
      return { ok: false, status: 0, data: null, error: { message: 'Network error — please check your connection.' } };
    }
    if (!res.ok) return { ok: false, status: res.status, data: data, error: { message: (data && data.error) || ('Request failed (' + res.status + ')') } };
    return { ok: true, status: res.status, data: data, error: null };
  }

  // ---- sb.from(table) query builder ---------------------------------------
  function QueryBuilder(table) {
    this._table = table;
    this._op = 'select';
    this._order = [];
    this._limit = 0;
    this._id = null;
    this._all = false;
    this._rows = null;
    this._patch = null;
  }
  QueryBuilder.prototype.select = function () { this._op = 'select'; return this; };
  QueryBuilder.prototype.insert = function (rows) { this._op = 'insert'; this._rows = rows; return this; };
  QueryBuilder.prototype.update = function (patch) { this._op = 'update'; this._patch = patch; return this; };
  QueryBuilder.prototype.delete = function () { this._op = 'delete'; return this; };
  QueryBuilder.prototype.eq = function (col, val) { if (col === 'id') this._id = val; return this; };
  QueryBuilder.prototype.neq = function () { if (this._op === 'delete') this._all = true; return this; };
  QueryBuilder.prototype.order = function (col, opts) {
    this._order.push({ col: col, asc: !opts || opts.ascending !== false });
    return this;
  };
  QueryBuilder.prototype.limit = function (n) { this._limit = n; return this; };

  function swapUploadRefs(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    var out = Array.isArray(obj) ? [] : {};
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (typeof v === 'string' && uploads[v]) out[k] = { name: uploads[v].name, url: uploads[v].url };
      else if (v && typeof v === 'object') out[k] = swapUploadRefs(v);
      else out[k] = v;
    });
    return out;
  }

  QueryBuilder.prototype._run = async function () {
    var body = { table: this._table, op: this._op };
    if (this._op === 'select') { body.order = this._order; if (this._limit) body.limit = this._limit; }
    if (this._op === 'insert') body.rows = swapUploadRefs(this._rows);
    if (this._op === 'update') { body.id = this._id; body.patch = swapUploadRefs(this._patch); }
    if (this._op === 'delete') { if (this._all) body.all = true; else body.id = this._id; }
    var r = await post('/api/db', body);
    if (r.error) return { data: null, error: r.error };
    return { data: r.data.data, error: null };
  };
  QueryBuilder.prototype.then = function (onOk, onErr) { return this._run().then(onOk, onErr); };
  QueryBuilder.prototype.catch = function (fn) { return this._run().catch(fn); };

  // ---- image shrink before upload (keeps files well under function limits) --
  function shrinkImage(file) {
    return new Promise(function (resolve) {
      if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size < 700 * 1024) return resolve(file);
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var MAX = 1600;
        var scale = Math.min(1, MAX / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          resolve(blob && blob.size < file.size ? blob : file);
        }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  function fileToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1] || ''); };
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  // ---- the client ----------------------------------------------------------
  function createClient() {
    var client = {};

    client.from = function (table) { return new QueryBuilder(table); };

    client.auth = {
      getSession: async function () {
        var s = readSession();
        if (s) return { data: { session: { access_token: s.token, user: s.user, expires_at: s.expires_at } } };
        // A password-reset link counts as a temporary session for the reset page
        if (resetTokenFromUrl()) {
          return { data: { session: { access_token: resetTokenFromUrl(), user: { email: '', user_metadata: {} }, __reset: true } } };
        }
        return { data: { session: null } };
      },
      signInWithPassword: async function (creds) {
        var r = await post('/api/auth', { action: 'login', email: creds.email, password: creds.password });
        if (r.error) return { data: null, error: r.error };
        writeSession(r.data.session);
        return { data: r.data, error: null };
      },
      signOut: async function () { writeSession(null); return { error: null }; },
      resetPasswordForEmail: async function (email) {
        var r = await post('/api/auth', { action: 'forgot', email: email, origin: location.origin });
        return { data: r.data, error: r.error };
      },
      updateUser: async function (attrs) {
        var r = await post('/api/auth', { action: 'change_password', password: attrs.password });
        if (r.error) return { data: null, error: r.error };
        writeSession(r.data.session);
        return { data: r.data, error: null };
      }
    };

    client.storage = {
      from: function () {
        return {
          upload: async function (path, file) {
            var blob = await shrinkImage(file);
            var base64 = await fileToBase64(blob);
            var r = await post('/api/upload', {
              filename: (file.name || path).split('/').pop(),
              contentType: blob.type || file.type || 'application/octet-stream',
              contentBase64: base64
            });
            if (r.error) return { data: null, error: r.error };
            uploads[path] = r.data.data; // { name, url }
            return { data: { path: path }, error: null };
          },
          remove: async function () { return { data: null, error: null }; }, // file is removed with its row
          createSignedUrl: async function (path) {
            var url = /^https?:/.test(path) ? path : (uploads[path] && uploads[path].url);
            if (!url) return { data: null, error: { message: 'File not found.' } };
            return { data: { signedUrl: url }, error: null };
          },
          getPublicUrl: function (path) {
            var url = /^https?:/.test(path) ? path : ((uploads[path] && uploads[path].url) || path);
            return { data: { publicUrl: url } };
          }
        };
      }
    };

    client.functions = {
      invoke: async function (name, opts) {
        var r = await post('/api/' + name, (opts && opts.body) || {});
        if (r.status === 0) return { data: null, error: r.error };
        return { data: r.data, error: null }; // pages inspect data.ok themselves
      }
    };

    return client;
  }

  window.afApi = { createClient: createClient };
})();
