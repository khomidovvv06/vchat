// VChat 2 — Firebase bilan ishlovchi qatlam. Serverga faqat shifrlangan ma'lumot yoziladi.
const V = '10.12.2';
const BASE = `https://www.gstatic.com/firebasejs/${V}/`;

let A, F, auth, db;

export async function init(cfg) {
  const appMod = await import(BASE + 'firebase-app.js');
  A = await import(BASE + 'firebase-auth.js');
  F = await import(BASE + 'firebase-firestore.js');
  const app = appMod.initializeApp(cfg.firebase);
  auth = A.initializeAuth(app, { persistence: A.indexedDBLocalPersistence });
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentSingleTabManager() }) });
  } catch (e) {
    db = F.getFirestore(app);
  }
}

const userOf = u => u && { uid: u.uid, email: (u.email || '').toLowerCase(), name: u.displayName || (u.email || '').split('@')[0], photo: u.photoURL || '' };

export function onAuth(cb) { return A.onAuthStateChanged(auth, u => cb(userOf(u))); }
export async function signInWithGoogleToken(idToken) {
  const cred = A.GoogleAuthProvider.credential(idToken);
  const r = await A.signInWithCredential(auth, cred);
  return userOf(r.user);
}
export async function signOut() { await A.signOut(auth); }

/* users */
export async function getUser(uid) { const s = await F.getDoc(F.doc(db, 'users', uid)); return s.exists() ? { uid, ...s.data() } : null; }
export async function getUserFresh(uid) { const s = await F.getDocFromServer(F.doc(db, 'users', uid)).catch(() => F.getDoc(F.doc(db, 'users', uid))); return s.exists() ? { uid, ...s.data() } : null; }
export async function saveProfile(uid, data) { await F.setDoc(F.doc(db, 'users', uid), data, { merge: true }); }
export async function findUserByEmail(email) {
  const q = F.query(F.collection(db, 'users'), F.where('email', '==', email.toLowerCase()), F.limit(1));
  const s = await F.getDocs(q);
  return s.empty ? null : { uid: s.docs[0].id, ...s.docs[0].data() };
}

/* chats */
export async function upsertChat(chatId, data) { await F.setDoc(F.doc(db, 'chats', chatId), data, { merge: true }); }
export function listenChats(uid, cb) {
  const q = F.query(F.collection(db, 'chats'), F.where('members', 'array-contains', uid));
  return F.onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => console.warn('chats', e));
}
export async function sendMessage(chatId, msg) { await F.addDoc(F.collection(db, 'chats', chatId, 'messages'), msg); }
export function listenMessages(chatId, cb) {
  const q = F.query(F.collection(db, 'chats', chatId, 'messages'), F.orderBy('ts'), F.limitToLast(300));
  return F.onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => console.warn('msgs', e));
}

/* calls (signalling) */
export async function createCall(data) { const r = await F.addDoc(F.collection(db, 'calls'), data); return r.id; }
export async function updateCall(id, data) { await F.updateDoc(F.doc(db, 'calls', id), data); }
export function listenCall(id, cb) { return F.onSnapshot(F.doc(db, 'calls', id), s => s.exists() && cb({ id, ...s.data() })); }
export function listenIncomingCalls(uid, cb) {
  const q = F.query(F.collection(db, 'calls'), F.where('to', '==', uid), F.where('status', '==', 'ringing'));
  return F.onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => console.warn('calls', e));
}
export async function addCand(callId, data) { await F.addDoc(F.collection(db, 'calls', callId, 'cands'), data); }
export function listenCands(callId, byUid, cb) {
  const q = F.query(F.collection(db, 'calls', callId, 'cands'), F.where('by', '==', byUid));
  return F.onSnapshot(q, s => s.docChanges().forEach(ch => { if (ch.type === 'added') cb({ id: ch.doc.id, ...ch.doc.data() }); }));
}
