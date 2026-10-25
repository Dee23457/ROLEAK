import { html, render } from 'lit';
import DOMPurify from 'dompurify';
import {
    WATERMARK_LOGO_URL,
    ENABLE_MODAL_CLOSE_SOUND,
    MODAL_CLOSE_SOUND_URL,
    COMMENT_COLLECTION_TYPE,
    LIKE_COLLECTION_TYPE,
    MAX_COMMENT_LENGTH
} from './config.js';

/** @tweakable Show newest comments first when true; set false for oldest-first */
let COMMENTS_NEWEST_FIRST = true;

/** @tweakable If true, opening a video creates a history entry (page navigation).
 *  @tweakable Disable this to prevent the app from creating history entries (pushState)
 *  when opening videos — useful to avoid unexpected redirects back to the home screen.
 */
let ENABLE_VIDEO_PAGE_NAV = false;

/* @tweakable The target player resolution width (px) - the video player will be constrained to this width at large viewports (keeps vertical videos from dominating) */
const PLAYER_TARGET_WIDTH = 1920;
/* @tweakable The target player resolution height (px) - paired with PLAYER_TARGET_WIDTH to form a 16:9 frame (1920x1080 by default) */
const PLAYER_TARGET_HEIGHT = 1080;

/* @tweakable Emoji used for the like button on the video page (visible on the video player page) */
let VIDEO_PAGE_LIKE_EMOJI = '👍';
/* @tweakable Emoji used for the share button on the video page (visible on the video player page) */
let VIDEO_PAGE_SHARE_EMOJI = '🔗';
/* @tweakable Whether to show the numeric like count next to the like emoji on the video page */
let VIDEO_PAGE_SHOW_LIKE_COUNT = true;

/** @tweakable Controls small visual options for the video page (badge opacity, compact layout)
 *  @tweakable Controls the alignment of action buttons on the video page ('top', 'below-title', 'inline')
 */
const VIDEO_PAGE_TWEAKS = {
    /* @tweakable Opacity of the hosted/watermark badge on the player */
    badgeOpacity: 0.9,
    /* @tweakable Use a compact layout (smaller sidebar) when true */
    compactLayout: false,
    /* @tweakable Whether to show the duplicate logo image under the player for emphasis */
    showFooterLogo: true,
    /* @tweakable Where to place action buttons on the video page. Options: 'top', 'below-title', 'inline' */
    buttonPlacement: 'below-title',
    /* @tweakable Padding applied to the comments box container (CSS padding string) */
    commentsPadding: '10px'
};

/* room reference is set from script.js so comments/likes can be stored in the shared Websim collections */
let room = null;

/* Setter so script.js can provide the initialized WebsimSocket room */
export function setRoom(r) {
    room = r;
}

/* State for the video page */
let selectedVideo = null;
let pageOpen = false;
let closeModalCallback = null;

// --- Sound Initialization ---
const modalCloseSound = ENABLE_MODAL_CLOSE_SOUND ? new Audio(MODAL_CLOSE_SOUND_URL) : null;
if (modalCloseSound) modalCloseSound.volume = 1.0;

// Helper function to play a sound
function playSound(audioElement) {
    if (audioElement) {
        audioElement.currentTime = 0;
        audioElement.play().catch(e => console.error("Error playing sound:", e));
    }
}

export function setCloseModalCallback(callback) {
    closeModalCallback = callback;
}

// Close the video "page" and restore previous view
export function closeModal() {
    if (!pageOpen) return;

    // Pause any playing video
    const videoElement = document.querySelector('.video-page-player');
    if (videoElement) {
        try { videoElement.pause(); } catch (e) {}
        try { videoElement.currentTime = 0; } catch (e) {}
    }

    selectedVideo = null;
    pageOpen = false;

    // If user navigated via pushState, go back; otherwise just clear
    try {
        if (ENABLE_VIDEO_PAGE_NAV && history.state && history.state.roleak_video_page) {
            history.back();
        } else {
            renderPage(); // clears
        }
    } catch (e) {
        renderPage();
    }

    playSound(modalCloseSound);

    if (closeModalCallback) closeModalCallback();
}

// Open a full page view for the video
export function openModal(video) {
    selectedVideo = video;
    pageOpen = true;

    // Use pushState to create a page-like navigation entry
    if (ENABLE_VIDEO_PAGE_NAV) {
        const stateObj = { roleak_video_page: true, videoId: video.id };
        history.pushState(stateObj, video.title || 'Video', `?video=${encodeURIComponent(video.id)}`);
    }

    renderPage();
}

// Sanitize helper for visible strings
function cleanText(value, fallback = '') {
    return DOMPurify.sanitize(String(value || fallback), { ALLOWED_TAGS: [] });
}

/* Helper to fetch comments for a video (synchronous snapshot) */
function getCommentsForVideo(videoId) {
    if (!room) return [];
    try {
        return room.collection(COMMENT_COLLECTION_TYPE).filter({ videoId }).getList() || [];
    } catch (e) {
        console.warn('Could not fetch comments (room not ready?)', e);
        return [];
    }
}

/* Helper to fetch likes count for a video */
function getLikeCount(videoId) {
    if (!room) return 0;
    try {
        const likes = room.collection(LIKE_COLLECTION_TYPE).filter({ videoId }).getList() || [];
        return likes.length;
    } catch (e) {
        console.warn('Could not fetch likes (room not ready?)', e);
        return 0;
    }
}

/* Post a comment to the room collection for the currently selected video */
async function postComment(videoId, text) {
    if (!room) return { error: 'No room' };
    const trimmed = (text || '').trim().slice(0, MAX_COMMENT_LENGTH);
    if (!trimmed) return { error: 'Empty' };
    try {
        await room.collection(COMMENT_COLLECTION_TYPE).create({
            videoId,
            text: trimmed
        });
        return {};
    } catch (e) {
        console.error('Failed to post comment', e);
        return { error: e.message || String(e) };
    }
}

/* Toggle like for the current user on this video (creates a like record per user) */
async function toggleLike(videoId) {
    if (!room) return;
    const currentUserId = room.clientId;
    if (!currentUserId) return;

    // Check if this user already liked
    const existingLikes = room.collection(LIKE_COLLECTION_TYPE).filter({ videoId, clientId: currentUserId }).getList();
    if (existingLikes && existingLikes.length > 0) {
        // Remove the user's like
        try {
            await room.collection(LIKE_COLLECTION_TYPE).delete(existingLikes[0].id);
        } catch (e) {
            console.error('Failed to remove like', e);
        }
    } else {
        // Create like record
        try {
            await room.collection(LIKE_COLLECTION_TYPE).create({
                videoId,
                clientId: currentUserId
            });
        } catch (e) {
            console.error('Failed to create like', e);
        }
    }
}

/* Share helper - produces a simple shareable link (uses window.baseUrl when available) */
function getShareLink(video) {
    const base = window.baseUrl || (window.location.origin + window.location.pathname);
    return `${base}?video=${encodeURIComponent(video.id)}`;
}

/* @tweakable Width of the suggestions sidebar on the video page (e.g., '320px' or '28%') */
let VIDEO_PAGE_SIDEBAR_WIDTH = '360px';
/* @tweakable Max height of the comments area in the left column (e.g., '56vh' or '420px') */
let VIDEO_PAGE_COMMENTS_MAX_HEIGHT = '56vh';

/* Improved, YouTube-like template for full page video view:
   - Player and metadata stack in the left (main) column
   - Comments flow under the player in the main column
   - Suggestions / Up next appear in a right sidebar
*/
const videoPageTemplate = (video) => {
    if (!video) return '';

    const cleanTitle = cleanText(video.title, 'Untitled Video');
    const cleanDescription = cleanText(video.description || '');
    const cleanUploader = cleanText(video.username || 'Unknown');

    // Fetch comments snapshot and sort
    const comments = getCommentsForVideo(video.id) || [];
    const sortedComments = COMMENTS_NEWEST_FIRST
        ? [...comments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        : [...comments].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const likeCount = getLikeCount(video.id);

    // Determine badge opacity from tweaks
    const badgeOpacity = VIDEO_PAGE_TWEAKS.badgeOpacity;

    // Simple suggestions list pulled from room (exclude current video)
    let suggestions = [];
    try {
        const all = room ? room.collection('video_v1').getList() || [] : [];
        suggestions = all.filter(v => v.id !== video.id).slice(0, 12);
    } catch (e) {
        suggestions = [];
    }

    return html`
        <div class="video-page" role="main" style="padding:18px;width:100%;box-sizing:border-box;">
            <div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:nowrap;">
                <!-- Main column: player, title, actions, description, comments -->
                <main style="flex:1 1 0;min-width:320px;max-width:calc(100% - ${VIDEO_PAGE_SIDEBAR_WIDTH});">
                    <!-- Player -->
                    <!-- Enforce a consistent 16:9 player frame constrained to PLAYER_TARGET_WIDTH x PLAYER_TARGET_HEIGHT (scales down on small screens) -->
                    <div class="video-player-container" style="position:relative;width:100%;max-width:${PLAYER_TARGET_WIDTH}px;background:#000;border:1px solid rgba(0,0,0,0.12);border-radius:8px;overflow:hidden;margin:0 auto;aspect-ratio:16/9;">
                        <video class="video-page-player modal-video-player" controls src="${String(video.videoUrl||'').startsWith('localblob://') ? '' : (video.videoUrl||'')}" data-localblob="${String(video.videoUrl||'').startsWith('localblob://') ? video.videoUrl : ''}" data-video-url="${String(video.videoUrl||'').replace(/"/g,'&quot;')}" style="width:100%;height:100%;display:block;object-fit:cover;background:#000;"></video>

                        <div class="modal-hosted-badge" style="position:absolute;top:10px;left:10px;opacity:${badgeOpacity};pointer-events:none;z-index:12;">
                            <img src="${WATERMARK_LOGO_URL}" alt="ROLEAK" style="height:28px;display:block;background:transparent;">
                        </div>

                        <button @click=${() => closeModal()} title="Back" style="position:absolute;top:10px;right:10px;z-index:15;padding:8px 10px;border-radius:6px;border:1px solid rgba(0,0,0,0.06);background:#efe0c8;cursor:pointer;">
                            ← Back
                        </button>
                    </div>

                    <!-- Title and meta row -->
                    <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px;">
                        <h1 style="margin:0;font-size:1.25rem;line-height:1.2;">${cleanTitle}</h1>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
                            <div style="color:#666;font-size:0.95em;">
                                <strong style="display:block;color:#0f2a33;">${cleanUploader}</strong>
                                <div style="color:#666;">${video.views || 0} views • ${new Date(video.created_at).toLocaleDateString()}</div>
                            </div>

                            <div style="display:flex;gap:8px;align-items:center;">
                                ${VIDEO_PAGE_TWEAKS.buttonPlacement === 'inline' ? html`
                                    <button title="Like" @click=${() => { toggleLike(video.id); }} style="padding:8px;border:1px solid rgba(0,0,0,0.06);background:var(--card-bg);cursor:pointer;border-radius:8px;font-size:1.15rem;line-height:1;display:flex;align-items:center;gap:8px;">
                                        <span style="font-size:1.18rem;">${VIDEO_PAGE_LIKE_EMOJI}</span>
                                        ${VIDEO_PAGE_SHOW_LIKE_COUNT ? html`<span style="font-weight:700;color:#0f2a33;">${likeCount}</span>` : ''}
                                    </button>
                                ` : html`
                                    <button title="Like" @click=${() => { toggleLike(video.id); }} style="padding:8px;border:1px solid rgba(0,0,0,0.06);background:var(--card-bg);cursor:pointer;border-radius:8px;font-size:1.15rem;line-height:1;display:flex;align-items:center;gap:8px;">
                                        <span style="font-size:1.18rem;">${VIDEO_PAGE_LIKE_EMOJI}</span>
                                        ${VIDEO_PAGE_SHOW_LIKE_COUNT ? html`<span style="font-weight:700;color:#0f2a33;">${likeCount}</span>` : ''}
                                    </button>
                                    <button title="Share" @click=${() => { navigator.clipboard?.writeText(getShareLink(video)).then(()=>alert('Link copied!')).catch(()=>alert('Copy failed')); }} style="padding:8px;border:1px solid rgba(0,0,0,0.06);background:var(--card-bg);cursor:pointer;border-radius:8px;font-size:1.15rem;line-height:1;">
                                        <span style="font-size:1.18rem;">${VIDEO_PAGE_SHARE_EMOJI}</span>
                                    </button>
                                `}
                            </div>
                        </div>

                        <!-- Description -->
                        ${cleanDescription ? html`
                            <section style="margin-top:8px;padding:12px;background:var(--card-bg);border:1px solid rgba(0,0,0,0.04);border-radius:6px;">
                                <div style="color:#222;font-size:0.95em;white-space:pre-wrap;">${cleanDescription}</div>
                            </section>
                        ` : ''}
                    </div>

                    <!-- Comments area (stacked below) -->
                    <div style="margin-top:14px;">
                        <h3 style="margin:0 0 10px 0;">Comments (${sortedComments.length})</h3>
                        <div id="video-comments-list" style="max-height:${VIDEO_PAGE_COMMENTS_MAX_HEIGHT}; overflow:auto; display:flex; flex-direction:column; gap:8px;padding-right:6px;">
                            ${sortedComments.length === 0 ? html`<div style="color:#777;font-size:0.95em;">No comments yet.</div>` : ''}
                            ${sortedComments.map(c => html`
                                <div style="padding:10px;border:1px solid #e0d6c6;background:#fff;border-radius:6px;">
                                    <strong style="display:block;margin-bottom:6px;">${DOMPurify.sanitize(c.username || 'Anon', {ALLOWED_TAGS:[]})}</strong>
                                    <div style="font-size:0.95em;color:#222;">${DOMPurify.sanitize(c.text || '', {ALLOWED_TAGS:[]})}</div>
                                    <div style="font-size:0.75em;color:#999;margin-top:6px;">${new Date(c.created_at).toLocaleString()}</div>
                                </div>
                            `)}
                        </div>

                        <!-- Comment input -->
                        <form id="video-comment-form" style="margin-top:10px;display:flex;gap:6px;align-items:center;">
                            <input id="video-comment-input" maxlength="${MAX_COMMENT_LENGTH}" placeholder="Write a comment..." style="flex:1;padding:10px;border:1px solid #ddd;background:#fff;border-radius:4px;">
                            <button type="button" id="video-comment-submit" style="padding:8px 12px;border:1px solid rgba(0,0,0,0.06);background:var(--card-bg);cursor:pointer;border-radius:4px;">Post</button>
                        </form>
                    </div>
                </main>

                <!-- Suggestions sidebar (Up next) -->
                <aside style="flex:0 0 ${VIDEO_PAGE_SIDEBAR_WIDTH};max-width:${VIDEO_PAGE_SIDEBAR_WIDTH};min-width:220px;">
                    <div style="position:sticky;top:18px;display:flex;flex-direction:column;gap:10px;">
                        <h3 style="margin:0 0 6px 0;">Up next</h3>
                        <div style="display:flex;flex-direction:column;gap:10px;">
                            ${suggestions.length === 0 ? html`<div style="color:#777;">No suggestions.</div>` : ''}
                            ${suggestions.map(s => html`
                                <div class="suggestion-item" style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;" @click=${() => { openModal(s); }}>
                                    <img src="${s.thumbnailUrl || WATERMARK_LOGO_URL}" alt="${DOMPurify.sanitize(s.title || 'Thumb', {ALLOWED_TAGS:[]})}" style="width:168px;height:94px;object-fit:cover;border-radius:6px;flex:0 0 auto;">
                                    <div style="flex:1 1 0;min-width:0;">
                                        <div style="font-weight:700;font-size:0.95em;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${DOMPurify.sanitize(s.title || 'Untitled', {ALLOWED_TAGS:[]})}</div>
                                        <div style="font-size:0.85em;color:#666;margin-top:6px;">${DOMPurify.sanitize(s.username || 'Unknown', {ALLOWED_TAGS:[]})} • ${s.views || 0} views</div>
                                    </div>
                                </div>
                            `)}
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    `;
};

let commentUnsubscribe = null;
let likeUnsubscribe = null;

// Render or clear the video page
export function renderPage() {
    const container = document.getElementById('video-modal-container');
    if (!container) return;

    if (pageOpen && selectedVideo) {
        // Hide the main content wrapper for a true page feel
        const mainWrapper = document.getElementById('content-wrapper');
        if (mainWrapper) mainWrapper.style.display = 'none';

        render(videoPageTemplate(selectedVideo), container);

        // Wire up comment submit button to create a comment record
        const submitBtn = document.getElementById('video-comment-submit');
        const commentInput = document.getElementById('video-comment-input');
        if (submitBtn && commentInput) {
            submitBtn.onclick = async () => {
                const text = commentInput.value || '';
                const result = await postComment(selectedVideo.id, text);
                if (!result.error) {
                    commentInput.value = '';
                } else {
                    alert('Failed to post comment: ' + result.error);
                }
            };
        }

        // Subscribe to comment collection for realtime updates if room is set
        if (room && typeof room.collection === 'function') {
            // Unsubscribe previous listeners
            if (commentUnsubscribe) commentUnsubscribe();
            commentUnsubscribe = room.collection(COMMENT_COLLECTION_TYPE).filter({ videoId: selectedVideo.id }).subscribe(() => {
                // Re-render the page to update comment list
                render(videoPageTemplate(selectedVideo), container);
                // Reattach handlers after re-render
                const btn = document.getElementById('video-comment-submit');
                const input = document.getElementById('video-comment-input');
                if (btn && input) {
                    btn.onclick = async () => {
                        const text = input.value || '';
                        const result = await postComment(selectedVideo.id, text);
                        if (!result.error) {
                            input.value = '';
                        } else {
                            alert('Failed to post comment: ' + result.error);
                        }
                    };
                }
            });

            // Subscribe to likes just to re-render like counts live
            if (likeUnsubscribe) likeUnsubscribe();
            likeUnsubscribe = room.collection(LIKE_COLLECTION_TYPE).filter({ videoId: selectedVideo.id }).subscribe(() => {
                render(videoPageTemplate(selectedVideo), container);
            });
        }
    } else {
        // Restore main content wrapper and clear this container
        const mainWrapper = document.getElementById('content-wrapper');
        if (mainWrapper) mainWrapper.style.display = '';
        render('', container);

        // Cleanup subscriptions
        if (commentUnsubscribe) commentUnsubscribe();
        commentUnsubscribe = null;
        if (likeUnsubscribe) likeUnsubscribe();
        likeUnsubscribe = null;
    }
}

// Handle back/forward navigation so the video page closes when the user navigates back
window.addEventListener('popstate', (e) => {
    // If the history state indicates our video page entry, close it; otherwise ensure cleared
    if (e.state && e.state.roleak_video_page) {
        // Someone navigated to a video state — try to find matching video via room collection if needed
        // For now, keep pageOpen true if selectedVideo matches, otherwise close to avoid mismatch.
    } else {
        // Any non-video state should close the page view
        if (pageOpen) {
            selectedVideo = null;
            pageOpen = false;
            renderPage();
            if (closeModalCallback) closeModalCallback();
        }
    }
});

 // Provide a compatibility alias for older imports that expected `renderModal`
 // Export the renderPage function under the legacy name to ensure pages open when other modules call renderModal.
 export const renderModal = renderPage;

 // Initial empty render
 renderPage();