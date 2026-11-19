// VChat 2 — uchidan-uchiga shifrlash.
// Har bir telefon o'z ECDH (P-256) kalit juftini yaratadi. Maxfiy kalit telefondan chiqmaydi
// (IndexedDB'da "extractable: false" holda saqlanadi). Serverga faqat ochiq kalit yoziladi.
// Ikki kishi o'rtasidagi chat kaliti: HKDF(ECDH(menin_maxfiy, uning_ochiq), chatId) -> AES-256-GCM.

const te = new TextEncoder(), td = new TextDecoder();
export const DEV = new URLSearchParams(location.search).get('dev') || '';

function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(str) { const s = atob(str), o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
async function sha256(data) { return new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? te.encode(data) : data)); }
const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

/* ---------- IndexedDB: telefon kaliti ---------- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('vchat-keys' + DEV, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('k');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) { const d = await idb(); return new Promise((res, rej) => { const q = d.transaction('k').objectStore('k').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function idbPut(key, val) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('k', 'readwrite'); t.objectStore('k').put(val, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
export async function idbDel(key) { const d = await idb(); return new Promise(res => { const t = d.transaction('k', 'readwrite'); t.objectStore('k').delete(key); t.oncomplete = () => res(); t.onerror = () => res(); }); }

export async function keyIdOf(pubJwk) { return hex(await sha256(pubJwk.x + '.' + pubJwk.y)).slice(0, 16); }

export async function deviceKey(uid) {
  let k = await idbGet('dev:' + uid);
  if (k && k.priv && k.pubJwk) return k;
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const full = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const pubJwk = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
  k = { priv: pair.privateKey, pubJwk, keyId: await keyIdOf(pubJwk), created: Date.now() };
  await idbPut('dev:' + uid, k);
  return k;
}

/* ---------- chat kaliti ---------- */
const keyCache = new Map();
export async function chatKey(myPriv, myKeyId, theirPubJwk, chatId) {
  const theirId = await keyIdOf(theirPubJwk);
  const ck = chatId + '|' + myKeyId + '|' + theirId;
  if (keyCache.has(ck)) return keyCache.get(ck);
  const pub = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: theirPubJwk.x, y: theirPubJwk.y }, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, myPriv, 256);
  const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('vchat2:' + chatId), info: te.encode('vchat-chat-v2') }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  keyCache.set(ck, key);
  return key;
}

/* ---------- shifrlash ---------- */
async function enc(key, bytes, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, bytes));
  const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
  return b64(all);
}
async function dec(key, str, aad) {
  const all = unb64(str);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12), additionalData: te.encode(aad) }, key, all.slice(12)));
}
export async function encStr(key, s, aad) { return enc(key, te.encode(s), aad); }
export async function decStr(key, s, aad) { return td.decode(await dec(key, s, aad)); }
export async function encBytes(key, bytes, aad) { return enc(key, bytes, aad); }
export async function decBytes(key, s, aad) { return dec(key, s, aad); }

/* ---------- xavfsizlik raqami (yuzma-yuz solishtirish uchun) ---------- */
export async function safetyNumber(uidA, pubA, uidB, pubB) {
  const parts = [[uidA, pubA], [uidB, pubB]].sort((p, q) => p[0] < q[0] ? -1 : 1).map(p => p[0] + ':' + p[1].x + '.' + p[1].y).join('|');
  const h = await sha256('vchat-safety|' + parts);
  let digits = '';
  for (let i = 0; i < 30; i += 2) digits += String(((h[i] << 8) | h[i + 1]) % 100000).padStart(5, '0').slice(1);
  return digits.slice(0, 60).match(/.{5}/g).join(' ');
}

/* ---------- PIN xeshi ---------- */
export async function hashPin(pin, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: te.encode('vchat-pin:' + salt), iterations: 150000, hash: 'SHA-256' }, base, 256);
  return b64(new Uint8Array(bits));
}
export function randId(n = 8) { return hex(crypto.getRandomValues(new Uint8Array(n))); }
