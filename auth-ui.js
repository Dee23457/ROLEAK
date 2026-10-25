/**
 * Header auth UI: Login / Register / Logout + sidebar login form
 */
function waitForAuth() {
    return new Promise((resolve) => {
        if (window.RoleakAuth) return resolve(window.RoleakAuth);
        const t = setInterval(() => {
            if (window.RoleakAuth) {
                clearInterval(t);
                resolve(window.RoleakAuth);
            }
        }, 20);
    });
}

function renderAuthArea(Auth) {
    const area = document.getElementById('auth-area');
    if (!area) return;

    const user = Auth.getCurrentUser();
    area.innerHTML = '';

    if (user && user.username && user.username !== 'Guest') {
        const chip = document.createElement('div');
        chip.className = 'auth-user-chip';
        const img = document.createElement('img');
        img.src = user.avatarUrl || '';
        img.alt = '';
        const name = document.createElement('span');
        name.textContent = user.username;
        chip.appendChild(img);
        chip.appendChild(name);
        area.appendChild(chip);

        const logoutBtn = document.createElement('button');
        logoutBtn.className = 'auth-btn';
        logoutBtn.textContent = 'Logout';
        logoutBtn.addEventListener('click', () => {
            Auth.logout();
            location.reload();
        });
        area.appendChild(logoutBtn);

        // Hide sidebar login when already signed in
        const box = document.getElementById('ll-login-box');
        if (box) {
            box.innerHTML = `
                <p class="ll-login-heading">Logged in as <strong>${user.username}</strong></p>
                <button type="button" class="ll-login-submit" id="ll-sidebar-logout">Logout</button>
            `;
            document.getElementById('ll-sidebar-logout')?.addEventListener('click', () => {
                Auth.logout();
                location.reload();
            });
        }
    } else {
        const loginBtn = document.createElement('button');
        loginBtn.className = 'auth-btn primary';
        loginBtn.textContent = 'Log In';
        loginBtn.addEventListener('click', () => openAuthModal('login'));
        area.appendChild(loginBtn);

        const regBtn = document.createElement('button');
        regBtn.className = 'auth-btn';
        regBtn.textContent = 'Register Account';
        regBtn.addEventListener('click', () => openAuthModal('register'));
        area.appendChild(regBtn);
    }
}

let currentTab = 'login';

function openAuthModal(tab = 'login') {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    currentTab = tab;
    setAuthTab(tab);
    modal.hidden = false;
    const err = document.getElementById('auth-error');
    if (err) err.hidden = true;
    document.getElementById('auth-username')?.focus();
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.hidden = true;
}

function setAuthTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.auth-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    const title = document.getElementById('auth-modal-title');
    const submit = document.getElementById('auth-submit');
    if (tab === 'login') {
        if (title) title.textContent = 'Sign in';
        if (submit) submit.textContent = 'Login';
    } else {
        if (title) title.textContent = 'Create account';
        if (submit) submit.textContent = 'Register';
    }
    const err = document.getElementById('auth-error');
    if (err) err.hidden = true;
}

async function initAuthUI() {
    const Auth = await waitForAuth();
    renderAuthArea(Auth);

    document.querySelectorAll('[data-close-auth]').forEach(el => {
        el.addEventListener('click', closeAuthModal);
    });

    document.querySelectorAll('.auth-tab').forEach(btn => {
        btn.addEventListener('click', () => setAuthTab(btn.dataset.tab));
    });

    // data-open-auth links (Register / Login in nav)
    document.querySelectorAll('[data-open-auth]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            openAuthModal(el.getAttribute('data-open-auth') || 'login');
        });
    });

    const form = document.getElementById('auth-form');
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('auth-username').value;
        const password = document.getElementById('auth-password').value;
        const errEl = document.getElementById('auth-error');
        if (errEl) errEl.hidden = true;
        try {
            if (currentTab === 'login') {
                Auth.login(username, password);
            } else {
                Auth.register(username, password);
            }
            closeAuthModal();
            location.reload();
        } catch (err) {
            if (errEl) {
                errEl.textContent = err.message || 'Something went wrong.';
                errEl.hidden = false;
            }
        }
    });

    // Sidebar login form
    const sideForm = document.getElementById('ll-side-login-form');
    sideForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('ll-side-username')?.value;
        const password = document.getElementById('ll-side-password')?.value;
        const errEl = document.getElementById('ll-side-login-error');
        if (errEl) errEl.hidden = true;
        try {
            Auth.login(username, password);
            location.reload();
        } catch (err) {
            if (errEl) {
                errEl.textContent = err.message || 'Login failed.';
                errEl.hidden = false;
            }
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAuthModal();
    });
}

initAuthUI();
