/**
 * Simple client-side pages for static ROLEAK (Home / Chat / Upload info / Sections).
 */
const PAGES = {
    home: { title: 'Home', show: ['#content-wrapper'] },
    chat: { title: 'Chat', show: ['#page-chat'] },
    sections: { title: 'Sections', show: ['#page-sections'] },
    forum: { title: 'Forum', show: ['#page-forum'] },
    yoursay: { title: 'Your Say', show: ['#page-yoursay'] },
    live: { title: 'ROLEAK Live', show: ['#page-live'] },
};

function hideAllPages() {
    document.querySelectorAll('[data-page-panel]').forEach(el => {
        el.hidden = true;
    });
    const main = document.getElementById('content-wrapper');
    if (main) main.hidden = true;
}

function showPage(name) {
    const page = PAGES[name] || PAGES.home;
    hideAllPages();
    if (name === 'home') {
        const main = document.getElementById('content-wrapper');
        if (main) main.hidden = false;
    } else {
        page.show.forEach(sel => {
            const el = document.querySelector(sel);
            if (el) el.hidden = false;
        });
    }
    document.querySelectorAll('.ll-nav-tab').forEach(tab => {
        const tabPage = tab.getAttribute('data-page') || 'home';
        tab.classList.toggle('active', tabPage === name);
    });
    try {
        history.replaceState({ page: name }, '', '#' + name);
    } catch (_) {}
}

function initPages() {
    document.querySelectorAll('.ll-nav-tab[data-page]').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            showPage(tab.getAttribute('data-page'));
        });
    });
    // Hash routing
    const hash = (location.hash || '#home').replace('#', '');
    showPage(PAGES[hash] ? hash : 'home');
    window.addEventListener('hashchange', () => {
        const h = (location.hash || '#home').replace('#', '');
        showPage(PAGES[h] ? h : 'home');
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPages);
} else {
    initPages();
}
