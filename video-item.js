/*
  YouTube-like horizontal video item renderer.
  Adds tweakable options for thumbnail size and text clamp lines.
*/

/* @tweakable Width (px) of the thumbnail box used in the list layout */
const THUMB_WIDTH = 320;
/* @tweakable Height (px) of the thumbnail box used in the list layout */
const THUMB_HEIGHT = 180;
/* @tweakable Number of lines to clamp the title to */
const TITLE_LINE_CLAMP = 2;
/* @tweakable Number of lines to clamp the description/snippet to */
const SNIPPET_LINE_CLAMP = 3;

/* @tweakable Text color for inline controls (like/share) */
const INLINE_TEXT_COLOR = 'var(--retro-accent)';

/* @tweakable URL for the "liked" icon image (shown when the current user has liked a video) */
const LIKE_ICON_LIKED_URL = '/Share.png';
/* @tweakable URL for the "unliked" icon image (shown when the current user has NOT liked a video) */
const LIKE_ICON_UNLIKED_URL = '/Upload.png';
/* @tweakable URL for the share action icon image */
const SHARE_ICON_URL = '/Share.png';
/* @tweakable Display size (px) for inline icon images used in list items */
const ICON_DISPLAY_SIZE = 20;

import { html, render } from 'lit';
import DOMPurify from 'dompurify';
import { DEFAULT_THUMBNAIL_URL, VIDEO_SEARCH_FIELDS, ADMIN_USERNAME, LIKE_COLLECTION_TYPE } from './config.js';
import { HOSTED_BADGE_CONFIG } from './video-list.js';

/* Debounce window (ms) to prevent rapid repeated like/unlike clicks */
const LIKE_ACTION_DEBOUNCE_MS = 700;

/* Helper that toggles like/unlike for a video for the current client; disables the button while processing */
async function toggleLikeForVideo(room, videoId, btn) {
    if (!room || !room.clientId) return;
    if (!btn) return;
    if (btn._processing) return;
    btn._processing = true;
    btn.disabled = true;

    try {
        const currentUserId = room.clientId;
        const existing = room.collection(LIKE_COLLECTION_TYPE).filter({ videoId, clientId: currentUserId }).getList() || [];
        if (existing.length > 0) {
            try { await room.collection(LIKE_COLLECTION_TYPE).delete(existing[0].id); } catch (e) { console.error('Failed to remove like:', e); }
        } else {
            try { await room.collection(LIKE_COLLECTION_TYPE).create({ videoId, clientId: currentUserId }); } catch (e) { console.error('Failed to create like:', e); }
        }
    } finally {
        setTimeout(() => { btn._processing = false; btn.disabled = false; }, LIKE_ACTION_DEBOUNCE_MS);
    }
}

/* Main renderer used by video-list.js */
export function renderVideoList(room, videoData, currentUserUsername, isUploading, searchQuery, handleVideoClick, handleRemoveVideo, handleToggleVisibility, handleRenameVideo, handleChangeThumbnail) {
    const container = document.getElementById('video-list-container');
    if (!container) return;

    // Show empty state
    if (!videoData || videoData.length === 0) {
        container.innerHTML = '<p>No videos uploaded yet.</p>';
        return;
    }

    const q = (searchQuery || '').toLowerCase();
    const filtered = videoData.filter(v => {
        const matches = !q || VIDEO_SEARCH_FIELDS.some(f => String(v[f] || '').toLowerCase().includes(q));
        const isCreator = v.username === currentUserUsername;
        const isAdmin = currentUserUsername === ADMIN_USERNAME;
        const visible = !v.isHidden || isCreator || isAdmin;
        return matches && visible;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<p>No videos match your search.</p>';
        return;
    }

    const sorted = [...filtered].sort((a,b)=> new Date(b.created_at) - new Date(a.created_at));

    render(html`${sorted.map(v => videoItemTemplate(room, v, currentUserUsername, handleVideoClick, handleRemoveVideo, handleToggleVisibility, handleRenameVideo, handleChangeThumbnail))}`, container);
}

/* Individual video item template for the list */
function videoItemTemplate(room, video, currentUserUsername, handleVideoClick, handleRemoveVideo, handleToggleVisibility, handleRenameVideo, handleChangeThumbnail) {
    const cleanTitle = DOMPurify.sanitize(video.title || 'Untitled Video', { ALLOWED_TAGS: [] });
    const cleanSnippet = DOMPurify.sanitize(video.description || '', { ALLOWED_TAGS: [] });
    const cleanUploader = DOMPurify.sanitize(video.username || 'Unknown', { ALLOWED_TAGS: [] });

    // Determine like state
    let userLiked = false;
    try {
        if (room && room.clientId) {
            const likes = room.collection(LIKE_COLLECTION_TYPE).filter({ videoId: video.id, clientId: room.clientId }).getList() || [];
            userLiked = likes.length > 0;
        }
    } catch (e) { userLiked = false; }

    /* @tweakable Size (px) of the uploader avatar shown in the list (square) */
    const UPLOADER_AVATAR_SIZE = 36;

    const avatarUrl = video.username ? `https://images.websim.com/avatar/${encodeURIComponent(video.username)}` : '';

    return html`
        <div class="video-item" @click=${() => handleVideoClick(video)}>
            <div class="thumb" style="width:${THUMB_WIDTH}px;height:${THUMB_HEIGHT}px;">
                <img src="${video.thumbnailUrl || DEFAULT_THUMBNAIL_URL}" alt="thumbnail">
                ${HOSTED_BADGE_CONFIG && HOSTED_BADGE_CONFIG.showInList ? html`
                    <div class="video-thumbnail-badge" style="left:${HOSTED_BADGE_CONFIG.left}px; top:${HOSTED_BADGE_CONFIG.top}px;">
                        <img src="${HOSTED_BADGE_CONFIG.url}" alt="ROLEAK" style="height:${HOSTED_BADGE_CONFIG.height}px;opacity:${HOSTED_BADGE_CONFIG.opacity};">
                    </div>
                ` : ''}
            </div>

            <div class="meta">
                <h3 class="title" style="-webkit-line-clamp: ${TITLE_LINE_CLAMP};">${cleanTitle}</h3>
                <div class="sub" style="display:flex;align-items:center;gap:8px;">
                    ${avatarUrl ? html`<img src="${avatarUrl}" alt="${cleanUploader}'s avatar" style="width:${UPLOADER_AVATAR_SIZE}px;height:${UPLOADER_AVATAR_SIZE}px;object-fit:cover;border-radius:4px;flex:0 0 auto;">` : ''}
                    <div style="min-width:0;">
                        <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${cleanUploader}</div>
                        <div style="color:#6e7a80;font-size:0.9rem;">${video.views || 0} views • ${new Date(video.created_at).toLocaleDateString()}</div>
                    </div>
                </div>
                <div class="snippet" style="-webkit-line-clamp:${SNIPPET_LINE_CLAMP};">${cleanSnippet}</div>

                <div class="actions">
                    <button class="like-quick" title="Like" @click=${(e)=>{ e.stopPropagation(); toggleLikeForVideo(room, video.id, e.currentTarget); }} style="color:${INLINE_TEXT_COLOR};">
                        <img src="${userLiked ? LIKE_ICON_LIKED_URL : LIKE_ICON_UNLIKED_URL}" alt="${userLiked ? 'Liked' : 'Like'}" style="width:${ICON_DISPLAY_SIZE}px;height:${ICON_DISPLAY_SIZE}px;display:block;">
                    </button>

                    <button class="share-quick" title="Share" @click=${(e)=>{ e.stopPropagation(); const base = window.baseUrl || (window.location.origin + window.location.pathname); const link = `${base}?video=${encodeURIComponent(video.id)}`; navigator.clipboard?.writeText(link).then(()=>alert('Link copied!')).catch(()=>alert('Copy failed')); }} style="color:${INLINE_TEXT_COLOR};">
                        <img src="${SHARE_ICON_URL}" alt="Share" style="width:${ICON_DISPLAY_SIZE}px;height:${ICON_DISPLAY_SIZE}px;display:block;">
                    </button>

                    ${ (video.username === currentUserUsername || currentUserUsername === ADMIN_USERNAME) ? html`
                        <div class="admin-actions" @click=${(e)=>e.stopPropagation()}>
                            <button @click=${()=>handleToggleVisibility(room, video)}>${video.isHidden ? 'Show' : 'Hide'}</button>
                            <button @click=${()=>handleRenameVideo(room, video)}>Rename</button>
                            <button @click=${()=>handleChangeThumbnail(room, video)}>Thumbnail</button>
                            <button @click=${()=>handleRemoveVideo(room, video)}>Remove</button>
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}