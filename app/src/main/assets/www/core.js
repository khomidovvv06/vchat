/* VChat core: shifrlash, xona ID, server (ntfy.sh) bilan aloqa.
   Xabarlar telefonda AES-256-GCM bilan shifrlanadi; kalit = PBKDF2(kod, xona).
   Server faqat shifrlangan matnni ko'radi. */
(function (G) {
  const NTFY = 'https://ntfy.sh/';
  const PREFIX = 'vchat-';
  const ALPH32 = 'abcdefghijklmnopqrstuvwxyz234567';
  const CODE_ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O, 1/I yo'q
  const te = new TextEncoder(), td = new TextDecoder();
  const keyCache = {};

  function rand(n) { return crypto.getRandomValues(new Uint8Array(n)); }
  function newRoomId() { return Array.from(rand(16), b => ALPH32[b & 31]).join(''); }
  function newCode() { return Array.from(rand(12), b => CODE_ALPH[b & 31]).join(''); }
  function newId() { return Array.from(rand(8), b => b.toString(16).padStart(2, '0')).join(''); }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function prettyCode(c) { c = normCode(c); return (c.match(/.{1,4}/g) || []).join('-'); }

  function parseRoom(input) {
    const s = String(input || '').trim();
    let m = s.match(/#([a-z2-7]{16})(?![a-z2-7])/) || s.match(/join\/([a-z2-7]{16})(?![a-z2-7])/);
    if (m) return m[1];
    m = s.toLowerCase().match(/^[a-z2-7]{16}$/);
    return m ? m[0] : null;
  }

  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(str) {
    const s = atob(str), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  async function getKey(room, code) {
    const c = normCode(code), k = room + '|' + c;
    if (keyCache[k]) return keyCache[k];
    const base = await crypto.subtle.importKey('raw', te.encode(c), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: te.encode('vchat-salt:' + room), iterations: 200000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    keyCache[k] = key;
    return key;
  }

  async function encrypt(key, obj) {
    const iv = rand(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))));
    const all = new Uint8Array(12 + ct.length);
    all.set(iv); all.set(ct, 12);
    return 'v1.' + b64(all);
  }

  async function decrypt(key, str) {
    if (typeof str !== 'string' || !str.startsWith('v1.')) throw new Error('format');
    const all = unb64(str.slice(3));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12));
    return JSON.parse(td.decode(pt));
  }

  // PIN xeshi (PIN telefonda ochiq holda saqlanmaydi)
  async function hashPin(pin, salt) {
    const base = await crypto.subtle.importKey('raw', te.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: te.encode('vchat-pin:' + salt), iterations: 150000, hash: 'SHA-256' }, base, 256);
    return b64(new Uint8Array(bits));
  }

  function topicUrl(room) { return NTFY + PREFIX + room; }

  async function publish(room, code, payload) {
    const body = await encrypt(await getKey(room, code), payload);
    const r = await fetch(topicUrl(room), { method: 'POST', body });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  }

  // Serverdagi barcha (oxirgi ~12 soatlik) xabarlarni oladi
  async function poll(room) {
    const r = await fetch(topicUrl(room) + '/json?poll=1&since=all');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = await r.text();
    return txt.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(e => e && e.event === 'message');
  }

  // Kodni tekshirish: 'ok' | 'wrong' | 'empty'
  async function verify(room, code) {
    const events = await poll(room);
    if (!events.length) return { status: 'empty' };
    const key = await getKey(room, code);
    for (const e of events) {
      try { const p = await decrypt(key, e.message); return { status: 'ok', payload: p, events }; } catch (err) { }
    }
    return { status: 'wrong' };
  }

  function subscribe(room, code, since, onPayload, onState) {
    let es, closed = false, retry = 2000, last = since || 'all';
    const open = () => {
      if (closed) return;
      es = new EventSource(topicUrl(room) + '/sse?since=' + encodeURIComponent(last));
      es.onopen = () => { retry = 2000; onState && onState(true); };
      es.onmessage = async ev => {
        let e; try { e = JSON.parse(ev.data); } catch (x) { return; }
        if (e.event !== 'message') return;
        last = e.id;
        try { const p = await decrypt(await getKey(room, code), e.message); onPayload(p, e); } catch (x) { /* begona xabar */ }
      };
      es.onerror = () => {
        onState && onState(false);
        es.close();
        if (!closed) setTimeout(open, retry);
        retry = Math.min(retry * 2, 30000);
      };
    };
    open();
    return { close() { closed = true; es && es.close(); } };
  }

  G.VCore = { newRoomId, newCode, newId, normCode, prettyCode, parseRoom, getKey, encrypt, decrypt, publish, poll, verify, subscribe, hashPin };
})(typeof window !== 'undefined' ? window : globalThis);
