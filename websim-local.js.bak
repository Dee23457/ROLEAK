/**
 * Local WebsimSocket + websim.upload compatibility layer.
 * Provides accounts (register/login), persistent collections, and file storage
 * via IndexedDB so ROLEAK works outside the Websim platform.
 */

const DB_NAME = 'roleak_local_db';
const DB_VERSION = 1;
const SESSION_KEY = 'roleak_session_user';
const USERS_KEY = 'roleak_users';

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
        const tx = db.transaction('collections', 'readonly');
        const store = tx.objectStore('collections');
        const idx = store.index('type');
        const req = idx.getAll(type);
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
        const tx = db.transaction('blobs', 'readonly');
        const req = tx.objectStore('blobs').get(id);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error);
    });
}

function uid() {
    return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadUsers() {
    try {
        return JSON.parse(localStorage.getItem(USERS_KEY) || '{}');
    } catch {
        return {};
    }
}

function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

/** Simple non-crypto hash for demo passwords (not production security) */
function hashPassword(pw) {
    let h = 0;
    for (let i = 0; i < pw.length; i++) {
        h = ((h << 5) - h) + pw.charCodeAt(i);
        h |= 0;
    }
    return 'h' + (h >>> 0).toString(16);
}

function getSessionUser() {
    try {
        return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch {
        return null;
    }
}

function setSessionUser(user) {
    if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_KEY);
}

export function registerUser(username, password) {
    username = (username || '').trim();
    if (!username || username.length < 2) throw new Error('Username must be at least 2 characters.');
    if (!password || password.length < 3) throw new Error('Password must be at least 3 characters.');
    const users = loadUsers();
    const key = username.toLowerCase();
    if (users[key]) throw new Error('Username already taken.');
    users[key] = {
        username,
        passwordHash: hashPassword(password),
        avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username)}`,
        created_at: new Date().toISOString()
    };
    saveUsers(users);
    const session = { username: users[key].username, avatarUrl: users[key].avatarUrl };
    setSessionUser(session);
    return session;
}

export function loginUser(username, password) {
    username = (username || '').trim();
    const users = loadUsers();
    const key = username.toLowerCase();
    const u = users[key];
    if (!u || u.passwordHash !== hashPassword(password)) {
        throw new Error('Invalid username or password.');
    }
    const session = { username: u.username, avatarUrl: u.avatarUrl };
    setSessionUser(session);
    return session;
}

export function logoutUser() {
    setSessionUser(null);
}

export function getCurrentUser() {
    return getSessionUser();
}

// ---------- Collection ----------
class LocalCollection {
    constructor(type, room) {
        this.type = type;
        this.room = room;
        this._list = [];
        this._subs = new Set();
        this._ready = this._load();
    }

    async _load() {
        this._list = await idbGetAllByType(this.type);
        this._list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        this._notify();
    }

    getList() {
        return [...this._list];
    }

    subscribe(cb) {
        this._subs.add(cb);
        // Fire once with current list
        try { cb(this.getList()); } catch (e) { console.error(e); }
        return () => this._subs.delete(cb);
    }

    _notify() {
        const list = this.getList();
        this._subs.forEach(cb => {
            try { cb(list); } catch (e) { console.error(e); }
        });
        // Cross-tab
        try {
            localStorage.setItem('roleak_collection_ping_' + this.type, Date.now().toString());
        } catch (_) {}
    }

    async create(data) {
        await this._ready;
        const session = getSessionUser();
        const username = session?.username || 'Anonymous';
        const record = {
            id: uid(),
            type: this.type,
            ...data,
            username,
            clientId: this.room.clientId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        await idbPut(record);
        this._list.unshift(record);
        this._notify();
        return record;
    }

    async update(id, patch) {
        await this._ready;
        const idx = this._list.findIndex(r => r.id === id);
        if (idx === -1) throw new Error('Record not found: ' + id);
        const updated = {
            ...this._list[idx],
            ...patch,
            id,
            type: this.type,
            updated_at: new Date().toISOString()
        };
        await idbPut(updated);
        this._list[idx] = updated;
        this._notify();
        return updated;
    }

    async delete(id) {
        await this._ready;
        await idbDelete(id);
        this._list = this._list.filter(r => r.id !== id);
        this._notify();
    }
}

// ---------- WebsimSocket ----------
class WebsimSocket {
    constructor() {
        this.clientId = 'local_' + Math.random().toString(36).slice(2, 10);
        this.peers = {};
        this._collections = {};
        this._presenceSubs = new Set();
        this._initialized = false;
    }

    collection(type) {
        if (!this._collections[type]) {
            this._collections[type] = new LocalCollection(type, this);
        }
        return this._collections[type];
    }

    subscribePresence(cb) {
        this._presenceSubs.add(cb);
        try { cb(); } catch (e) { console.error(e); }
        return () => this._presenceSubs.delete(cb);
    }

    _notifyPresence() {
        this._presenceSubs.forEach(cb => {
            try { cb(); } catch (e) { console.error(e); }
        });
    }

    /** Call after login/logout to refresh peer info */
    refreshUser() {
        const user = getSessionUser();
        if (user) {
            this.peers[this.clientId] = {
                username: user.username,
                avatarUrl: user.avatarUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(user.username)}`
            };
        } else {
            // Guest
            this.peers[this.clientId] = {
                username: 'Guest',
                avatarUrl: 'https://api.dicebear.com/7.x/identicon/svg?seed=Guest'
            };
        }
        this._notifyPresence();
    }

    async initialize() {
        if (this._initialized) return this;
        this.refreshUser();

        // Ensure all known collection types are loaded
        const types = ['video_v1', 'message_v1', 'comment_v1', 'like_v1'];
        await Promise.all(types.map(t => this.collection(t)._ready));

        // Cross-tab sync: reload collection when another tab writes
        window.addEventListener('storage', (e) => {
            if (e.key && e.key.startsWith('roleak_collection_ping_')) {
                const type = e.key.replace('roleak_collection_ping_', '');
                const col = this._collections[type];
                if (col) col._load();
            }
            if (e.key === SESSION_KEY) {
                this.refreshUser();
            }
        });

        this._initialized = true;
        return this;
    }
}

// ---------- File upload (blob URLs + IndexedDB persistence) ----------
const blobUrlCache = new Map();

async function localUpload(file) {
    if (!file) throw new Error('No file provided');
    const id = 'blob_' + uid();
    await idbPutBlob(id, file);
    const url = URL.createObjectURL(file);
    blobUrlCache.set(id, url);
    // Return a special local URL that we can resolve later
    return `localblob://${id}`;
}

/** Resolve localblob:// URLs to object URLs when needed */
export async function resolveMediaUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('localblob://')) {
        const id = url.slice('localblob://'.length);
        if (blobUrlCache.has(id)) return blobUrlCache.get(id);
        const blob = await idbGetBlob(id);
        if (!blob) return url;
        const objectUrl = URL.createObjectURL(blob);
        blobUrlCache.set(id, objectUrl);
        return objectUrl;
    }
    return url;
}

// Install globals before any app module runs
window.WebsimSocket = WebsimSocket;
window.websim = {
    upload: localUpload
};

// Export auth helpers for the UI
window.RoleakAuth = {
    register: registerUser,
    login: loginUser,
    logout: logoutUser,
    getCurrentUser,
    resolveMediaUrl
};

/** Resolve any img/video elements that use localblob:// or data-localblob */
async function resolveDomMedia() {
    const nodes = document.querySelectorAll(
        'img[src^="localblob://"], video[src^="localblob://"], img[data-localblob], video[data-localblob]'
    );
    for (const el of nodes) {
        const raw = el.getAttribute('data-localblob') || el.getAttribute('src');
        if (!raw || !raw.startsWith('localblob://')) continue;
        try {
            const resolved = await resolveMediaUrl(raw);
            if (resolved && resolved !== raw) {
                el.src = resolved;
                el.removeAttribute('data-localblob');
                el.classList.remove('needs-blob-resolve');
            }
        } catch (e) {
            console.warn('Failed to resolve media', raw, e);
        }
    }
}

// Watch DOM for new media that needs resolving
const mediaObserver = new MutationObserver(() => {
    resolveDomMedia();
});
if (document.documentElement) {
    mediaObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-localblob'] });
}
// Also run on interval as a safety net
setInterval(resolveDomMedia, 800);
document.addEventListener('DOMContentLoaded', resolveDomMedia);

console.log('[ROLEAK] Local Websim compatibility layer loaded.');
