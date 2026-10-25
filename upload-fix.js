/**
 * ROLEAK upload fix — direct modal + LiveLeak styling/centering.
 */
(function () {
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  async function startUpload(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
    const Auth = window.RoleakAuth;
    const user = Auth && Auth.getCurrentUser && Auth.getCurrentUser();
    if (!user || !user.username || user.username === 'Guest') {
      alert('Please log in or register to upload a video.');
      document.querySelector('[data-open-auth="login"]')?.click();
      return;
    }

    const menu = document.getElementById('upload-menu-popover');
    if (menu) menu.style.display = 'none';

    try {
      const uploadMod = await import('./video-upload.js');
      const configMod = await import('./config.js');
      const VIDEO_TYPE = configMod.VIDEO_COLLECTION_TYPE || 'video_v1';

      let room = window.__roleakRoom;
      if (!room) {
        room = new window.WebsimSocket();
        await room.initialize();
        window.__roleakRoom = room;
      } else if (room.initialize) {
        await room.initialize();
      }

      const refresh = typeof window.refreshVideoListDisplay === 'function'
        ? window.refreshVideoListDisplay
        : () => {
            try {
              room.collection(VIDEO_TYPE)._load && room.collection(VIDEO_TYPE)._load();
            } catch (_) {}
            setTimeout(() => location.reload(), 400);
          };

      let uploading = false;
      await uploadMod.handleUpload(
        room,
        refresh,
        uploading,
        (s) => { uploading = s; }
      );
    } catch (err) {
      console.error('[ROLEAK upload-fix]', err);
      alert('Upload failed: ' + (err && err.message ? err.message : err));
    }
  }

  function bind() {
    const btn = document.getElementById('upload-button');
    if (!btn) return;
    btn.addEventListener('click', startUpload, true);
    console.log('[ROLEAK] Upload button fixed (direct modal).');
  }

  ready(bind);
  setTimeout(bind, 1500);
  setTimeout(bind, 4000);

  // Restyle / re-center upload modal when it appears (LiveLeak look)
  function apply(overlay) {
    if (!overlay || overlay.dataset.llStyled) return;
    overlay.dataset.llStyled = '1';
    Object.assign(overlay.style, {
      position: 'fixed',
      left: '0', top: '0', right: '0', bottom: '0',
      width: '100%', height: '100%',
      margin: '0', padding: '16px',
      background: 'rgba(0,0,0,0.45)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: '2147483646',
      boxSizing: 'border-box',
    });
    if (overlay.parentElement !== document.body) {
      document.body.appendChild(overlay);
    }
    const modal = overlay.firstElementChild;
    if (modal) {
      Object.assign(modal.style, {
        width: '100%',
        maxWidth: '420px',
        borderRadius: '0',
        border: '1px solid #999',
        boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
        padding: '0',
        fontFamily: 'Arial, Helvetica, sans-serif',
      });
      const title = modal.firstElementChild;
      if (title && title.tagName === 'DIV') {
        Object.assign(title.style, {
          background: 'linear-gradient(180deg,#e02020,#c40000)',
          color: '#fff',
          padding: '8px 12px',
          fontSize: '14px',
          fontWeight: '700',
          borderBottom: '1px solid #8b0000',
        });
      }
      const form = modal.querySelector('form');
      if (form) {
        form.style.padding = '12px';
        form.style.background = '#f7f7f7';
      }
      modal.querySelectorAll('input, textarea').forEach(el => {
        el.style.borderRadius = '0';
        el.style.border = '1px solid #999';
        el.style.fontSize = '12px';
      });
      modal.querySelectorAll('button').forEach(btn => {
        btn.style.borderRadius = '2px';
        btn.style.fontWeight = '700';
        btn.style.fontSize = '12px';
        if ((btn.type === 'submit') || /upload/i.test(btn.textContent || '')) {
          btn.style.background = 'linear-gradient(180deg,#e02020,#c40000)';
          btn.style.color = '#fff';
          btn.style.border = '1px solid #8b0000';
        }
      });
    }
  }

  function scan() {
    document.querySelectorAll('body > div').forEach(div => {
      if (div.style && div.style.position === 'fixed' && div.querySelector('form') && /upload/i.test(div.textContent || '')) {
        apply(div);
      }
    });
    const byId = document.getElementById('roleak-upload-overlay');
    if (byId) apply(byId);
  }

  const obs = new MutationObserver(scan);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, 500);
})();
