/**
 * ROLEAK client — local IndexedDB mode (GitHub Pages) + optional server API.
 */
const API = '/api';
const SESSION_KEY = 'roleak_session_user';
const USERS_KEY = 'roleak_users';
const DB_NAME = 'roleak_local_db';
const DB_VERSION = 1;

let useServer = false;
let serverChecked = false;

async function checkServer() {
    if (serverChecked) return useServer;
    serverChecked = true;
    try {
        const r = await fetch(API + '/health', { credentials: 'include' });
        useServer = r.ok;
    } catch { useServer = false; }
    console.log(useServer ? '[ROLEAK] Server backend' : '[ROLEAK] Static/local mode');
    return useServer;
}

function loadUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY) || '{}'); } catch { return {}; }
}
function saveUsers(users) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }
function hashPassword(pw) {
    let h = 0;
    for (let i = 0; i < pw.length; i++) { h = ((h << 5) - h) + pw.charCodeAt(i); h |= 0; }
    return 'h' + (h >>> 0).toString(16);
}
function getSessionUser() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function setSessionUser(user) {
    if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_KEY);
}
function uid() { return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('collections')) {
                const store = db.createObjectStore('collections', { keyPath: 'id' });
                store.createIndex('type', 'type', { unique: false });
            }
            if (!db.objectStoreNames.contains('blobs')) {
                db.createObjectStore('blobs', { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbGetAllByType(type) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction('collections', 'readonly').objectStore('collections').index('type').getAll(type);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}
async function idbPut(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('collections', 'readwrite');
        tx.objectStore('collections').put(record);
        tx.oncomplete = () => resolve(record);
        tx.onerror = () => reject(tx.error);
    });
}
async function idbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('collections', 'readwrite');
        tx.objectStore('collections').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
async function idbPutBlob(id, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').put({ id, blob, type: blob.type || 'application/octet-stream' });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
async function idbGetBlob(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction('blobs', 'readonly').objectStore('blobs').get(id);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error);
    });
}

const blobUrlCache = new Map();

export async function resolveMediaUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (!url.startsWith('localblob://')) return url;
    const id = url.slice('localblob://'.length);
    if (blobUrlCache.has(id)) return blobUrlCache.get(id);
    try {
        const blob = await idbGetBlob(id);
        if (!blob) return url;
        const objectUrl = URL.createObjectURL(blob);
        blobUrlCache.set(id, objectUrl);
        return objectUrl;
    } catch (e) {
        console.warn('resolveMediaUrl', e);
        return url;
    }
}

async function resolveDomMedia() {
    const nodes = document.querySelectorAll(
        'img[src^="localblob://"], video[src^="localblob://"], source[src^="localblob://"], img[data-localblob], video[data-localblob]'
    );
    for (const el of nodes) {
        const raw = el.getAttribute('data-localblob') || el.getAttribute('src');
        if (!raw || !raw.startsWith('localblob://')) continue;
        try {
            const resolved = await resolveMediaUrl(raw);
            if (resolved && resolved !== raw) {
                el.src = resolved;
                el.removeAttribute('data-localblob');
            }
        } catch (e) { console.warn(e); }
    }
}

if (typeof MutationObserver !== 'undefined') {
    const obs = new MutationObserver(() => resolveDomMedia());
    const start = () => {
        if (document.documentElement) {
            obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-localblob'] });
            resolveDomMedia();
        }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
    setInterval(resolveDomMedia, 800);
}

export async function registerUser(username, password) {
    await checkServer();
    username = (username || '').trim();
    if (!username || username.length < 2) throw new Error('Username must be at least 2 characters.');
    if (!password || password.length < 3) throw new Error('Password must be at least 3 characters.');
    if (useServer) {
        const r = await fetch(API + '/register', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Register failed');
        const session = { username: data.username, avatarUrl: data.avatarUrl, isAdmin: data.isAdmin };
        setSessionUser(session);
        return session;
    }
    const users = loadUsers();
    const key = username.toLowerCase();
    if (users[key]) throw new Error('Username already taken.');
    users[key] = {
        username, passwordHash: hashPassword(password),
        avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username)}`,
    };
    saveUsers(users);
    const session = { username: users[key].username, avatarUrl: users[key].avatarUrl };
    setSessionUser(session);
    return session;
}

export async function loginUser(username, password) {
    await checkServer();
    username = (username || '').trim();
    if (useServer) {
        const r = await fetch(API + '/login', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Login failed');
        const session = { username: data.username, avatarUrl: data.avatarUrl, isAdmin: data.isAdmin };
        setSessionUser(session);
        return session;
    }
    const users = loadUsers();
    const u = users[username.toLowerCase()];
    if (!u || u.passwordHash !== hashPassword(password)) throw new Error('Invalid username or password.');
    const session = { username: u.username, avatarUrl: u.avatarUrl };
    setSessionUser(session);
    return session;
}

export async function logoutUser() {
    await checkServer();
    if (useServer) {
        try { await fetch(API + '/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
    }
    setSessionUser(null);
}

export function getCurrentUser() { return getSessionUser(); }

class LocalCollection {
    constructor(type, room) {
        this.type = type;
        this.room = room;
        this._list = [];
        this._subs = new Set();
        this._ready = this._load();
        this._poll = null;
    }
    async _load() {
        await checkServer();
        if (useServer) {
            await this._loadServer();
            if (!this._poll) this._poll = setInterval(() => this._loadServer(), 4000);
            return;
        }
        this._list = await idbGetAllByType(this.type);
        this._list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        this._notify();
    }
    async _loadServer() {
        try {
            if (this.type === 'video_v1') {
                const r = await fetch(API + '/videos', { credentials: 'include' });
                const data = await r.json();
                this._list = data.videos || [];
            } else if (this.type === 'message_v1') {
                const r = await fetch(API + '/chat', { credentials: 'include' });
                const data = await r.json();
                this._list = data.messages || [];
            }
            this._notify();
        } catch (e) { console.warn('poll failed', e); }
    }
    getList() { return [...this._list]; }
    subscribe(cb) {
        this._subs.add(cb);
        try { cb(this.getList()); } catch (e) { console.error(e); }
        return () => this._subs.delete(cb);
    }
    _notify() {
        const list = this.getList();
        this._subs.forEach(cb => { try { cb(list); } catch (e) { console.error(e); } });
    }
    async create(data) {
        await this._ready;
        await checkServer();
        const session = getSessionUser();
        if (useServer && this.type === 'message_v1') {
            const r = await fetch(API + '/chat', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: data.text }),
            });
            const out = await r.json();
            if (!r.ok) throw new Error(out.error || 'Send failed');
            await this._loadServer();
            return out.message;
        }
        const username = session?.username || 'Anonymous';
        const record = {
            id: uid(), type: this.type, ...data, username,
            clientId: this.room.clientId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        await idbPut(record);
        this._list.unshift(record);
        this._notify();
        return record;
    }
    async update(id, patch) {
        await this._ready;
        await checkServer();
        if (useServer && this.type === 'video_v1') {
            // View counts have their own endpoint (any visitor may bump them; PUT is owner/admin only)
            const keys = Object.keys(patch || {});
            if (keys.length === 1 && keys[0] === 'views') {
                try { await fetch(API + '/videos/' + id + '/view', { method: 'POST', credentials: 'include' }); } catch (_) {}
                await this._loadServer();
                return this._list.find(v => v.id === id);
            }
            const r = await fetch(API + '/videos/' + id, {
                method: 'PUT', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            const out = await r.json();
            if (!r.ok) throw new Error(out.error || 'Update failed');
            await this._loadServer();
            return out.video;
        }
        const idx = this._list.findIndex(r => r.id === id);
        if (idx === -1) throw new Error('Record not found: ' + id);
        const updated = { ...this._list[idx], ...patch, id, type: this.type, updated_at: new Date().toISOString() };
        await idbPut(updated);
        this._list[idx] = updated;
        this._notify();
        return updated;
    }
    async delete(id) {
        await this._ready;
        await checkServer();
        if (useServer && this.type === 'video_v1') {
            const r = await fetch(API + '/videos/' + id, { method: 'DELETE', credentials: 'include' });
            if (!r.ok) { const out = await r.json().catch(() => ({})); throw new Error(out.error || 'Delete failed'); }
            await this._loadServer();
            return;
        }
        if (useServer && this.type === 'message_v1') {
            const r = await fetch(API + '/chat/' + id, { method: 'DELETE', credentials: 'include' });
            if (!r.ok) { const out = await r.json().catch(() => ({})); throw new Error(out.error || 'Delete failed'); }
            await this._loadServer();
            return;
        }
        await idbDelete(id);
        this._list = this._list.filter(r => r.id !== id);
        this._notify();
    }
    filter(query = {}) {
        const match = (rec) => {
            for (const [k, v] of Object.entries(query || {})) {
                if (rec[k] !== v) return false;
            }
            return true;
        };
        const self = this;
        return {
            getList() { return self.getList().filter(match); },
            subscribe(cb) {
                return self.subscribe(() => {
                    try { cb(self.getList().filter(match)); } catch (e) { console.error(e); }
                });
            }
        };
    }
}

class WebsimSocket {
    constructor() {
        this.clientId = 'local_' + Math.random().toString(36).slice(2, 10);
        this.peers = {};
        this._collections = {};
        this._presenceSubs = new Set();
        this._initialized = false;
    }
    collection(type) {
        if (!this._collections[type]) this._collections[type] = new LocalCollection(type, this);
        return this._collections[type];
    }
    subscribePresence(cb) {
        this._presenceSubs.add(cb);
        try { cb(); } catch (e) { console.error(e); }
        return () => this._presenceSubs.delete(cb);
    }
    _notifyPresence() {
        this._presenceSubs.forEach(cb => { try { cb(); } catch (e) { console.error(e); } });
    }
    refreshUser() {
        const user = getSessionUser();
        if (user && user.username && user.username !== 'Guest') {
            this.peers[this.clientId] = {
                username: user.username,
                avatarUrl: user.avatarUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(user.username)}`,
            };
        } else {
            this.peers[this.clientId] = { username: 'Guest', avatarUrl: 'https://api.dicebear.com/7.x/identicon/svg?seed=Guest' };
        }
        this._notifyPresence();
    }
    async initialize() {
        if (this._initialized) return this;
        await checkServer();
        if (useServer) {
            try {
                const r = await fetch(API + '/me', { credentials: 'include' });
                const data = await r.json();
                if (data.user) setSessionUser(data.user);
            } catch (_) {}
        }
        this.refreshUser();
        await Promise.all(['video_v1', 'message_v1', 'comment_v1', 'like_v1'].map(t => this.collection(t)._ready));
        this._initialized = true;
        return this;
    }
}

async function localUpload(file) {
    if (!file) throw new Error('No file');
    await checkServer();
    if (useServer) return URL.createObjectURL(file);
    const id = 'blob_' + uid();
    await idbPutBlob(id, file);
    const objectUrl = URL.createObjectURL(file);
    blobUrlCache.set(id, objectUrl);
    return `localblob://${id}`;
}

window.WebsimSocket = WebsimSocket;
window.websim = { upload: localUpload };
window.RoleakAuth = {
    register: registerUser,
    login: loginUser,
    logout: logoutUser,
    getCurrentUser,
    resolveMediaUrl,
    checkServer,
    isServer: () => useServer,
};
console.log('[ROLEAK] Client ready (static + optional server).');
