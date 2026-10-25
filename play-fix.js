/**
 * Stops the player from auto-closing when the video list refreshes.
 * Root cause: list handler compared video src blob: URL to record localblob:// URL.
 */
(function () {
  async function patchModules() {
    try {
      let blockUntil = 0;
      let snapshot = null;

      document.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('.video-item')) {
          blockUntil = Date.now() + 4000;
          setTimeout(() => {
            const container = document.getElementById('video-modal-container');
            const main = document.getElementById('content-wrapper');
            if (container && container.querySelector('video')) {
              snapshot = container.innerHTML;
            }
          }, 150);
        }
      }, true);

      const container = document.getElementById('video-modal-container');
      if (container) {
        const mo = new MutationObserver(() => {
          if (Date.now() < blockUntil && snapshot && !container.querySelector('video')) {
            console.log('[ROLEAK] Restoring video page after false close');
            container.innerHTML = snapshot;
            const main = document.getElementById('content-wrapper');
            if (main) main.style.display = 'none';
            container.querySelectorAll('video').forEach(async (el) => {
              const raw = el.getAttribute('data-localblob') || el.getAttribute('src');
              if (raw && String(raw).startsWith('localblob://') && window.RoleakAuth?.resolveMediaUrl) {
                el.src = await window.RoleakAuth.resolveMediaUrl(raw);
              }
            });
          }
        });
        mo.observe(container, { childList: true, subtree: true });
      }
      console.log('[ROLEAK] play-fix active');
    } catch (e) {
      console.warn('[ROLEAK] play-fix failed', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(patchModules, 500));
  } else {
    setTimeout(patchModules, 500);
  }
})();
