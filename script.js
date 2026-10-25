import { html, render } from 'lit';
import {
    ADMIN_USERNAME,
    VIDEO_COLLECTION_TYPE,
    CHAT_COLLECTION_TYPE,
    VIDEO_SEARCH_FIELDS,
    WATERMARK_LOGO_HEIGHT,
    HEADER_SLOGAN_TEXT,
    DISCORD_LINK_URL,
    DISCORD_LINK_TEXT,
    ENABLE_UPLOAD_CLICK_SOUND,
    UPLOAD_CLICK_SOUND_URL,
    ENABLE_VIDEO_CLICK_SOUND,
    VIDEO_CLICK_SOUND_URL,
    ENABLE_SECRET_LINK,
    SECRET_LINK_TRIGGER_SELECTOR,
    SECRET_LINK_URL,
    SECRET_LINK_OPEN_IN_NEW_WINDOW,
    DEFAULT_THUMBNAIL_URL
} from './config.js';
import { renderVideoList, handleRemoveVideo, handleToggleVisibility, handleRenameVideo, handleChangeThumbnail } from './video-list.js';
/* @tweakable Use the video "page" render function exported from video-modal.js (renderPage) */
import { openModal, closeModal, renderPage, setCloseModalCallback } from './video-modal.js';
import { handleUpload } from './video-upload.js';
import { renderChatMessages, setInitialChatMinimizeState } from './chat.js';




// Initialize WebsimSocket (provided by websim-local.js)
const room = new WebsimSocket();

function requireLogin(actionLabel = 'do that') {
    const user = window.RoleakAuth?.getCurrentUser?.();
    if (!user || !user.username || user.username === 'Guest') {
        alert('Please log in or register to ' + actionLabel + '.');
        document.querySelector('[data-open-auth="login"]')?.click();
        return false;
    }
    return true;
}

// Helper function to play a sound
function playSound(audioElement) {
    if (audioElement) {
        audioElement.currentTime = 0;
        audioElement.play().catch(e => console.error("Error playing sound:", e));
    }
}

const uploadClickSound = ENABLE_UPLOAD_CLICK_SOUND ? new Audio(UPLOAD_CLICK_SOUND_URL) : null;
const videoClickSound = ENABLE_VIDEO_CLICK_SOUND ? new Audio(VIDEO_CLICK_SOUND_URL) : null;

/* @tweakable Whether to increment the video's views counter when a user opens it from the list */
const INCREMENT_VIEWS_ON_OPEN = true;

// Global State
let isAdmin = false;
let currentUserUsername = null;
let isUploading = false;
let currentSearchQuery = '';
let selectedVideo = null;

/* @tweakable Selector for the upload button used to attach the upload menu handler */
const UPLOAD_BUTTON_SELECTOR = '#upload-button';
/* @tweakable Label for the menu option that starts the file upload flow */
const UPLOAD_MENU_LABEL_UPLOAD = 'Upload Video';
/* @tweakable Label for the menu option that allows pasting a remote video URL */
const UPLOAD_MENU_LABEL_PASTE_URL = 'Paste Video URL';
/* @tweakable Label for cancel/close on the upload menu */
const UPLOAD_MENU_LABEL_CANCEL = 'Cancel';

/* Creates or returns a singleton upload menu popover. Kept top-level so the upload button works even before room.initialize completes. */
/* @tweakable The width of the centered upload menu popover (e.g. '260px' or '80%') */
const UPLOAD_MENU_WIDTH = '280px';
/* @tweakable If true, the upload menu will be centered on screen; if false it will attempt to position near the button */
const UPLOAD_MENU_CENTER_BY_DEFAULT = true;

/* Create or return a singleton compact upload menu displayed as a centered fixed popover */
function getOrCreateUploadMenu() {
    let menu = document.getElementById('upload-menu-popover');
    if (menu) return menu;

    menu = document.createElement('div');
    menu.id = 'upload-menu-popover';

    // Use fixed positioning so the popover stays centered regardless of scroll
    menu.style.position = 'fixed';
    menu.style.left = '50%';
    menu.style.top = '50%';
    menu.style.transform = 'translate(-50%, -50%)';
    menu.style.minWidth = UPLOAD_MENU_WIDTH;
    menu.style.maxWidth = '92%';
    menu.style.padding = '10px';
    menu.style.background = '#fff';
    menu.style.border = '1px solid rgba(0,0,0,0.08)';
    menu.style.boxShadow = '0 10px 32px rgba(0,0,0,0.16)';
    menu.style.borderRadius = '10px';
    menu.style.zIndex = 2000;
    menu.style.display = 'none';
    menu.style.flexDirection = 'column';
    menu.style.gap = '8px';
    menu.style.boxSizing = 'border-box';
    menu.style.alignItems = 'stretch';
    menu.style.justifyContent = 'center';
    menu.style.textAlign = 'center';
    menu.style.paddingTop = '12px';
    menu.style.paddingBottom = '12px';

    // Compact button style helper
    const makeButton = (text, bg) => {
        const b = document.createElement('button');
        b.textContent = text;
        b.style.padding = '8px 12px';
        b.style.cursor = 'pointer';
        b.style.border = '1px solid rgba(0,0,0,0.06)';
        b.style.borderRadius = '8px';
        b.style.background = bg;
        b.style.minWidth = '120px';
        b.style.boxSizing = 'border-box';
        return b;
    };

    const btnUpload = makeButton(UPLOAD_MENU_LABEL_UPLOAD, 'linear-gradient(180deg,#fff,#fff7ef)');
    btnUpload.addEventListener('click', async (e) => {
        hideUploadMenu();
        if (!requireLogin('upload a video')) return;
        playSound(uploadClickSound);
        await handleUpload(room, refreshVideoListDisplay, isUploading, updateIsUploadingState);
    });

    const btnPaste = makeButton(UPLOAD_MENU_LABEL_PASTE_URL, 'linear-gradient(180deg,#fff,#f3faff)');
    btnPaste.addEventListener('click', async (e) => {
        hideUploadMenu();
        if (!requireLogin('add a video')) return;
        const url = prompt('Paste a direct video URL (mp4/webm) to add as a record:');
        if (!url) return;
        const title = prompt('Enter a title for this video (optional):') || 'Linked Video';
        try {
            await room.collection(VIDEO_COLLECTION_TYPE).create({
                title: title.trim() || 'Linked Video',
                description: '',
                videoUrl: url.trim(),
                thumbnailUrl: DEFAULT_THUMBNAIL_URL,
                views: 0
            });
            alert('Video added from URL.');
        } catch (err) {
            console.error('Failed to create linked video record:', err);
            alert('Failed to add video from URL.');
        }
    });

    const btnCancel = makeButton(UPLOAD_MENU_LABEL_CANCEL, '#fff');
    btnCancel.addEventListener('click', hideUploadMenu);

    // Arrange buttons vertically on small screens, horizontally on wider viewports
    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '8px';
    btnRow.style.flexWrap = 'wrap';
    btnRow.style.justifyContent = 'center';
    btnRow.appendChild(btnUpload);
    btnRow.appendChild(btnPaste);

    menu.appendChild(btnRow);
    menu.appendChild(btnCancel);

    document.body.appendChild(menu);

    // Close menu on outside click
    document.addEventListener('click', (ev) => {
        if (!menu) return;
        if (menu._ignoreNextOutsideClick) {
            menu._ignoreNextOutsideClick = false;
            return;
        }
        if (menu.style.display === 'none') return;
        if (!menu.contains(ev.target)) hideUploadMenu();
    });

    return menu;
}

/* Show the upload menu — by default center it, but fallback to button-relative positioning if configured */
function showUploadMenuAt(button) {
    const menu = getOrCreateUploadMenu();
    // Default behavior: center
    if (UPLOAD_MENU_CENTER_BY_DEFAULT) {
        menu.style.position = 'fixed';
        menu.style.left = '50%';
        menu.style.top = '50%';
        menu.style.transform = 'translate(-50%, -50%)';
        menu.style.display = 'flex';
        menu._ignoreNextOutsideClick = true;
        return;
    }

    // Fallback: position near button (kept for compatibility)
    const rect = button.getBoundingClientRect();
    const topBelow = rect.bottom + window.scrollY + 8;
    menu.style.position = 'absolute';
    menu.style.left = `${Math.round(rect.left + window.scrollX)}px`;
    menu.style.top = `${Math.round(topBelow)}px`;
    menu.style.transform = '';
    menu.style.display = 'flex';
    menu._ignoreNextOutsideClick = true;
}

function hideUploadMenu() {
    const menu = document.getElementById('upload-menu-popover');
    if (!menu) return;
    menu.style.display = 'none';
}

/* Attach upload handler immediately so the button responds even before room.initialize resolves.
   This is idempotent and safe to call multiple times. */
function attachUploadHandler() {
    const btn = document.querySelector(UPLOAD_BUTTON_SELECTOR);
    if (!btn) return;

    // Remove existing listener marker to avoid duplicate handlers
    if (btn._roleakUploadHandler) {
        btn.removeEventListener('click', btn._roleakUploadHandler);
    }

    // Define and store the handler so it can be removed/replaced later
    const handler = (e) => {
        showUploadMenuAt(btn);
        playSound(uploadClickSound);
    };
    btn._roleakUploadHandler = handler;
    btn.addEventListener('click', handler);
}

// Try to attach the upload handler now in case the DOM is already ready.
// It will also be called again inside room.initialize() for redundancy.
attachUploadHandler();

/* @tweakable The amount of time (ms) to show the "Loading videos..." message before rendering the list */
const VIDEO_LOADING_DURATION_MS = 1200; /* Default: show loading for ~1.2s */
/* @tweakable Milliseconds between revealing each video item after initial load (stagger) */
const VIDEO_STAGGER_INTERVAL_MS = 120; /* Default: reveal one video every 120ms */

// Helper to clear any prior error nodes that may linger on the video list container
function clearVideoLoadError() {
    const container = document.getElementById('video-list-container');
    if (!container) return;
    const err = container.querySelector('[data-error="video-load"]');
    if (err) err.remove();
}

// Helper function to trigger a full re-render of the video list based on current state.
// Shows a transient "Loading videos..." message, then renders the list and reveals items one-by-one.
function refreshVideoListDisplay() {
    const container = document.getElementById('video-list-container');
    if (!container) return;

    // Clear any stale error indicator so it doesn't persist after successful loads.
    clearVideoLoadError();

    // Show a short loading message to cover the fetch/prepare time
    let loadingEl = document.getElementById('video-loading-message');
    if (!loadingEl) {
        loadingEl = document.createElement('div');
        loadingEl.id = 'video-loading-message';
        loadingEl.style.padding = '18px';
        loadingEl.style.textAlign = 'center';
        loadingEl.style.color = 'var(--muted-text)';
        loadingEl.style.fontWeight = '700';
        loadingEl.textContent = 'Loading videos...';
        container.prepend(loadingEl);
    }
    loadingEl.style.opacity = '1';
    loadingEl.style.transition = 'opacity 320ms ease';

    // Wait the configured amount of time to give a loading feel
    setTimeout(() => {
        // Gather videos and render using the existing renderer
        const videos = room.collection(VIDEO_COLLECTION_TYPE).getList();
        renderVideoList(room, videos, currentUserUsername, isUploading, currentSearchQuery, handleVideoClick, handleRemoveVideoWrapper, handleToggleVisibilityWrapper, handleRenameVideo, handleChangeThumbnail);

        // After render, perform a staged reveal: hide all video-items then remove the hide class one-by-one
        const items = Array.from(container.querySelectorAll('.video-item'));
        if (items.length > 0) {
            items.forEach(el => {
                el.classList.add('staged-hidden'); // CSS handled via small runtime class change below
                el.style.transition = 'opacity 220ms ease, transform 220ms ease';
                el.style.opacity = '0';
                el.style.transform = 'translateY(6px)';
            });

            // Reveal sequentially
            items.forEach((el, i) => {
                setTimeout(() => {
                    el.style.opacity = '';
                    el.style.transform = '';
                    el.classList.remove('staged-hidden');
                }, i * VIDEO_STAGGER_INTERVAL_MS);
            });
        }

        // Fade out and remove the loading text smoothly
        loadingEl.style.opacity = '0';
        setTimeout(() => {
            if (loadingEl && loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
        }, 380);

    }, VIDEO_LOADING_DURATION_MS);
}

// Helper function to update isUploading state and trigger re-render of video list
function updateIsUploadingState(state) {
    isUploading = state;
    refreshVideoListDisplay();
}

// Wrap handleVideoClick to integrate with modal state managed here
function handleVideoClick(video) {
    console.log(`Clicked on video: ${video.title}`);
    // Play sound on click before checking visibility
    playSound(videoClickSound);

    // Check if video is hidden and if the current user is NOT the creator and NOT admin
    const isCreator = video.username === currentUserUsername;
    const isAdmin = currentUserUsername === ADMIN_USERNAME;
    if (video.isHidden && !isCreator && !isAdmin) {
        console.log('Cannot open hidden video that you did not upload and are not admin.');
        return; // Do not open modal if hidden and not authorized
    }

    // Optionally increment the persisted view count for this video when opened
    (async () => {
        try {
            if (INCREMENT_VIEWS_ON_OPEN && room && room.collection) {
                // Use defensive reads in case the local video object is stale
                const latest = room.collection(VIDEO_COLLECTION_TYPE).getList().find(v => v.id === video.id) || video;
                const currentViews = Number(latest.views || 0);
                await room.collection(VIDEO_COLLECTION_TYPE).update(video.id, { views: currentViews + 1 });
            }
        } catch (e) {
            console.warn('Failed to increment views for video:', e);
        }
    })();

    // Open the modal after (or while) incrementing
    openModal(video);
    selectedVideo = video;
}

// Wrap handleRemoveVideo to integrate with modal state managed here
async function handleRemoveVideoWrapper(room, video) {
    // handleRemoveVideo now contains the admin check internally
    await handleRemoveVideo(room, video);
    // Check if the video currently in the modal was the one just removed
    // Need to find the video in the current data state to compare its URL reliably
    const latestVideos = room.collection(VIDEO_COLLECTION_TYPE).getList();

    // Check if the removed video was the one currently open in the modal
    if (selectedVideo && selectedVideo.id === video.id) {
         closeModal(); // Close if the exact video record was removed
    } else {
        // Re-check if the currently playing video (if any) is still accessible after the update
         const currentModalVideoElement = document.querySelector('.modal-video-player');
         if (currentModalVideoElement) {
             const currentVideoUrl = currentModalVideoElement.src;
             const modalVideoData = latestVideos.find(v => v.videoUrl === currentVideoUrl);

             if (modalVideoData) {
                  const isCreator = modalVideoData.username === currentUserUsername;
                  const isAdminUser = currentUserUsername === ADMIN_USERNAME;
                  const isVisible = !modalVideoData.isHidden || isCreator || isAdminUser;
                  if (!isVisible) {
                      console.log('Currently playing video became inaccessible, closing modal.');
                      closeModal();
                  }
             } else {
                 // If the video data is no longer found in the list (might have been removed by someone else)
                 console.log('Currently playing video data not found in latest list, closing modal.');
                 closeModal();
             }
         }
    }
}

// Wrap handleToggleVisibility from video-list.js
async function handleToggleVisibilityWrapper(room, video) {
     // handleToggleVisibility now contains the admin check internally
    await handleToggleVisibility(room, video);
    // After toggling visibility, check if the currently open modal video was affected
    const currentModalVideoElement = document.querySelector('.modal-video-player');
     if (currentModalVideoElement) {
        // Find the latest state of the video currently playing in the modal
         const latestVideos = room.collection(VIDEO_COLLECTION_TYPE).getList();
         const currentVideoUrl = currentModalVideoElement.src;
         const modalVideoData = latestVideos.find(v => v.videoUrl === currentVideoUrl);

         if (modalVideoData) {
             const isCreator = modalVideoData.username === currentUserUsername;
             const isAdminUser = currentUserUsername === ADMIN_USERNAME;
             const isVisible = !modalVideoData.isHidden || isCreator || isAdminUser;
             if (!isVisible) {
                 console.log('Currently playing video became inaccessible, closing modal.');
                 closeModal();
             }
         } else {
              // If the video data is no longer found (e.g. removed by another user after toggle), close modal
              console.log('Currently playing video data not found in latest list after toggle, closing modal.');
              closeModal();
         }
     }
}

// Handle modal close notification from video-modal.js
setCloseModalCallback(() => {
    console.log('Modal closed.');
    // The video list subscribe callback handles re-rendering automatically
    // No need to call refreshVideoListDisplay() here explicitly after modal close
    selectedVideo = null;
});

import { setRoom as setVideoModalRoom } from './video-modal.js';

// Set CSS variable for watermark height and update slogan text and Discord link
function setDynamicStyles() {
    document.documentElement.style.setProperty('--watermark-height', `${WATERMARK_LOGO_HEIGHT}px`);

    const sloganElement = document.getElementById('header-slogan');
    if (sloganElement) {
        sloganElement.textContent = HEADER_SLOGAN_TEXT;
    }

    const discordLinkElement = document.getElementById('discord-link');
    if (discordLinkElement) {
        discordLinkElement.href = DISCORD_LINK_URL;
        discordLinkElement.textContent = DISCORD_LINK_TEXT;
    }
}

// Function to set up the secret link click listener
function setupSecretLink() {
    if (!ENABLE_SECRET_LINK) {
        console.log('Secret link feature is disabled.');
        return;
    }

    const triggerElement = document.querySelector(SECRET_LINK_TRIGGER_SELECTOR);

    if (triggerElement) {
        // @tweakable Make the secret link trigger element's cursor a pointer on hover
        triggerElement.style.cursor = 'pointer'; // Indicate clickability

        triggerElement.addEventListener('click', () => {
            console.log('Secret link triggered!');
            if (SECRET_LINK_OPEN_IN_NEW_WINDOW) {
                 window.open(SECRET_LINK_URL, '_blank');
            } else {
                 window.location.href = SECRET_LINK_URL;
            }
        });
         console.log(`Secret link enabled on element: ${SECRET_LINK_TRIGGER_SELECTOR}`);

    } else {
        console.warn(`Secret link trigger element not found: ${SECRET_LINK_TRIGGER_SELECTOR}`);
    }
}


// Initial setup and subscription
room.initialize().then(() => {
    console.log('WebsimSocket initialized.');
    const currentUser = room.peers[room.clientId];
    currentUserUsername = currentUser?.username;

    if (currentUserUsername === ADMIN_USERNAME) {
        isAdmin = true;
        console.log('Current user is admin.');
    } else {
        isAdmin = false;
        console.log('Current user is not admin.');
    }

    // Set initial CSS variable value, slogan text, and Discord link
    setDynamicStyles();

    // Provide room instance to video-modal so comments/likes can use persistent collections
    setVideoModalRoom(room);

    // Set up the secret link
    setupSecretLink();

    room.collection(VIDEO_COLLECTION_TYPE).subscribe((videos) => {
        console.log('Videos updated:', videos);
        refreshVideoListDisplay();

        const currentModalVideoElement = document.querySelector('.modal-video-player');
        if (currentModalVideoElement) {
             const currentVideoUrl = currentModalVideoElement.src;
             const latestVideos = room.collection(VIDEO_COLLECTION_TYPE).getList();

             const isCreator = latestVideos.some(v => v.videoUrl === currentVideoUrl && v.username === currentUserUsername);
             const isAdminUser = currentUserUsername === ADMIN_USERNAME;
             const videoStillExistsAndVisible = latestVideos.some(v => v.videoUrl === currentVideoUrl && (!v.isHidden || isCreator || isAdminUser));
             // Find the updated video data
             const updatedVideo = latestVideos.find(v => v.videoUrl === currentVideoUrl);

             if (!videoStillExistsAndVisible) {
                 console.log('Currently playing video removed, hidden, or user permission changed, closing modal.');
                 closeModal();
             } else {
                 // If the video is still visible, check if the thumbnail changed and update the modal
                 // This requires modifying video-modal.js to have a function to update its internal video state
                 // For now, we'll just log the change. A full modal refresh would be better but more complex.
                 // console.log('Currently playing video thumbnail or other property updated.');
                 // This simplified approach relies on the modal closing if the video becomes inaccessible.
                 // Any updates to the video record *while* it's playing are not dynamically reflected in the modal title/thumbnail without more complex state management in video-modal.js.
             }
        }
    });



    room.subscribePresence(() => {
         console.log('Presence updated, re-rendering chat.');
         const oldCurrentUserUsername = currentUserUsername;
         currentUserUsername = room.peers[room.clientId]?.username;

         if (currentUserUsername !== oldCurrentUserUsername) {
              console.log('Current username updated, re-rendering video list and chat.');
              // Update isAdmin status if username changed
              isAdmin = currentUserUsername === ADMIN_USERNAME;
              refreshVideoListDisplay();
         }

         // Always re-render chat on presence change to update user avatars/usernames
         const currentMessages = room.collection(CHAT_COLLECTION_TYPE).getList();
         // Pass room and latest current username to renderChatMessages
         renderChatMessages(room, currentMessages, currentUserUsername);
     });

    renderPage();
    // Pass room and currentUserUsername for initial chat state render
    /* @tweakable The CSS selector for the upload button element used to attach the click handler */
    const UPLOAD_BUTTON_SELECTOR = '#upload-button';

    /* @tweakable Labels for upload menu options (tweak to adjust wording) */
    /* @tweakable Label for the menu option that starts the file upload flow */
    const UPLOAD_MENU_LABEL_UPLOAD = 'Upload Video';
    /* @tweakable Label for the menu option that allows pasting a remote video URL */
    const UPLOAD_MENU_LABEL_PASTE_URL = 'Paste Video URL';
    /* @tweakable Label for cancel/close on the upload menu */
    const UPLOAD_MENU_LABEL_CANCEL = 'Cancel';

    /* Creates or returns a singleton menu element appended to document.body */
    function getOrCreateUploadMenu() {
        let menu = document.getElementById('upload-menu-popover');
        if (menu) return menu;

        menu = document.createElement('div');
        menu.id = 'upload-menu-popover';
        menu.style.position = 'absolute';
        menu.style.minWidth = '180px';
        menu.style.padding = '8px';
        menu.style.background = 'white';
        menu.style.border = '1px solid rgba(0,0,0,0.08)';
        menu.style.boxShadow = '0 8px 20px rgba(0,0,0,0.12)';
        menu.style.borderRadius = '8px';
        menu.style.zIndex = 2000;
        menu.style.display = 'none';
        menu.style.flexDirection = 'column';
        menu.style.gap = '6px';
        menu.style.boxSizing = 'border-box';

        const btnUpload = document.createElement('button');
        btnUpload.textContent = UPLOAD_MENU_LABEL_UPLOAD;
        btnUpload.style.padding = '8px';
        btnUpload.style.cursor = 'pointer';
        btnUpload.style.border = '1px solid rgba(0,0,0,0.06)';
        btnUpload.style.borderRadius = '6px';
        btnUpload.style.background = 'linear-gradient(180deg,#fff,#fff7ef)';
        btnUpload.addEventListener('click', async (e) => {
            hideUploadMenu();
            if (!requireLogin('upload a video')) return;
            playSound(uploadClickSound);
            await handleUpload(room, refreshVideoListDisplay, isUploading, updateIsUploadingState);
        });

        const btnPaste = document.createElement('button');
        btnPaste.textContent = UPLOAD_MENU_LABEL_PASTE_URL;
        btnPaste.style.padding = '8px';
        btnPaste.style.cursor = 'pointer';
        btnPaste.style.border = '1px solid rgba(0,0,0,0.06)';
        btnPaste.style.borderRadius = '6px';
        btnPaste.style.background = 'linear-gradient(180deg,#fff,#f3faff)';
        btnPaste.addEventListener('click', async (e) => {
            hideUploadMenu();
            const url = prompt('Paste a direct video URL (mp4/webm) to add as a record:');
            if (!url) return;
            const title = prompt('Enter a title for this video (optional):') || 'Linked Video';
            try {
                await room.collection(VIDEO_COLLECTION_TYPE).create({
                    title: title.trim() || 'Linked Video',
                    description: '',
                    videoUrl: url.trim(),
                    thumbnailUrl: DEFAULT_THUMBNAIL_URL,
                    views: 0
                });
                alert('Video added from URL.');
            } catch (err) {
                console.error('Failed to create linked video record:', err);
                alert('Failed to add video from URL.');
            }
        });

        const btnCancel = document.createElement('button');
        btnCancel.textContent = UPLOAD_MENU_LABEL_CANCEL;
        btnCancel.style.padding = '8px';
        btnCancel.style.cursor = 'pointer';
        btnCancel.style.border = '1px solid rgba(0,0,0,0.06)';
        btnCancel.style.borderRadius = '6px';
        btnCancel.style.background = '#fff';
        btnCancel.addEventListener('click', hideUploadMenu);

    menu.appendChild(btnRow);
    menu.appendChild(btnCancel);

    document.body.appendChild(menu);

    // Close menu on outside click
    document.addEventListener('click', (ev) => {
        if (!menu) return;
        if (menu._ignoreNextOutsideClick) {
            menu._ignoreNextOutsideClick = false;
            return;
        }
        if (menu.style.display === 'none') return;
        if (!menu.contains(ev.target)) hideUploadMenu();
    });

    return menu;
}

function showUploadMenuAt(button) {
    const menu = getOrCreateUploadMenu();
    // Center by default for a compact modal feel
    if (UPLOAD_MENU_CENTER_BY_DEFAULT) {
        menu.style.position = 'fixed';
        menu.style.left = '50%';
        menu.style.top = '50%';
        menu.style.transform = 'translate(-50%, -50%)';
        menu.style.display = 'flex';
        menu._ignoreNextOutsideClick = true;
        return;
    }

    // Fallback: place near the button
    const rect = button.getBoundingClientRect();
    const topBelow = rect.bottom + window.scrollY + 8;
    menu.style.position = 'absolute';
    menu.style.left = `${Math.round(rect.left + window.scrollX)}px`;
    menu.style.top = `${Math.round(topBelow)}px`;
    menu.style.transform = '';
    menu.style.display = 'flex';
    menu._ignoreNextOutsideClick = true;
}

    function hideUploadMenu() {
        const menu = document.getElementById('upload-menu-popover');
        if (!menu) return;
        menu.style.display = 'none';
    }

    /* Attach upload handler to the upload button if present.
       This function is idempotent and safe to call multiple times (it removes any prior handler first). */
    function attachUploadHandler() {
        const btn = document.querySelector(UPLOAD_BUTTON_SELECTOR);
        if (!btn) return;

        // Remove existing listener marker to avoid duplicate handlers
        if (btn._roleakUploadHandler) {
            btn.removeEventListener('click', btn._roleakUploadHandler);
        }

        // Define and store the handler so it can be removed/replaced later
        const handler = (e) => {
            // Show the menu rather than immediately starting upload
            showUploadMenuAt(btn);
            // Play click sound as feedback
            playSound(uploadClickSound);
        };
        btn._roleakUploadHandler = handler;
        btn.addEventListener('click', handler);
    }

    // Attach early in case the DOM is ready before initialization finishes
    attachUploadHandler();



    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (event) => {
            currentSearchQuery = event.target.value;
            refreshVideoListDisplay();
        });
    }
}).catch(error => {
    console.error('Failed to initialize WebsimSocket:', error);
    const container = document.getElementById('video-list-container');
    if (container) {
         // Mark this error node so the renderer can clear it when videos become available
         container.innerHTML = '<p data-error="video-load">Failed to load videos. Please try refreshing.</p>';
    }
     const chatMessagesContainer = document.getElementById('chat-messages');
     if (chatMessagesContainer) {
        chatMessagesContainer.innerHTML = '<p>Failed to load chat messages.</p>';
     }
     const minimizeButton = document.getElementById('minimize-chat-button');
     if (minimizeButton) {
         minimizeButton.textContent = 'Error';
         minimizeButton.disabled = true;
     }
});