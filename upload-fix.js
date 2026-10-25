/**
 * ROLEAK upload fix — rebinds #upload-button to open the upload modal directly.
 * Load after script.js so it wins over the old menu-only handler.
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
})();
