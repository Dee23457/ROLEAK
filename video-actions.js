/*
  Action handlers split out from video-list.js to keep side effects and room updates contained.
*/
import {
    VIDEO_COLLECTION_TYPE,
    ADMIN_USERNAME,
    MAX_THUMBNAIL_FILE_SIZE,
    ALLOWED_THUMBNAIL_FILE_TYPES
} from './config.js';

/* @tweakable The user-visible confirmation text for destructive actions (can be localized) */
export const REMOVAL_CONFIRM_TEXT = 'Are you sure you want to permanently remove "%s"? This cannot be undone.';

/* Helper to prompt and confirm */
function confirmPrompt(message) {
    return confirm(message);
}

/* Tombstone: original playSound() was removed and replaced by simple no-op sound triggers in config-managed modules */
// removed function playSound() {}

/* Handle video removal (creator or admin) */
export async function handleRemoveVideo(room, video) {
    const currentUser = room.peers[room.clientId];
    const currentUserUsername = currentUser?.username;
    const isCreator = video.username === currentUserUsername;
    const isAdmin = currentUserUsername === ADMIN_USERNAME;

    if (!isCreator && !isAdmin) {
        alert("You do not have permission to delete this video.");
        return;
    }

    if (!confirmPrompt(REMOVAL_CONFIRM_TEXT.replace('%s', video.title))) return;

    try {
        await room.collection(VIDEO_COLLECTION_TYPE).delete(video.id);
    } catch (err) {
        console.error('Error deleting video:', err);
        alert('Failed to delete video. Please try again.');
    }
}

/* Handle toggling visibility */
export async function handleToggleVisibility(room, video) {
    const currentUser = room.peers[room.clientId];
    const currentUserUsername = currentUser?.username;
    const isCreator = video.username === currentUserUsername;
    const isAdmin = currentUserUsername === ADMIN_USERNAME;

    if (!isCreator && !isAdmin) {
        alert("You do not have permission to change the visibility of this video.");
        return;
    }

    const newVisibility = !video.isHidden;
    const action = newVisibility ? 'Hide' : 'Show';
    if (!confirmPrompt(`Are you sure you want to ${action.toLowerCase()} "${video.title}"?`)) return;

    try {
        await room.collection(VIDEO_COLLECTION_TYPE).update(video.id, { isHidden: newVisibility });
    } catch (err) {
        console.error('Error updating video visibility:', err);
        alert('Failed to update video visibility. Please try again.');
    }
}

/* Handle renaming a video */
export async function handleRenameVideo(room, video) {
    const currentUser = room.peers[room.clientId];
    const currentUserUsername = currentUser?.username;
    const isCreator = video.username === currentUserUsername;
    const isAdmin = currentUserUsername === ADMIN_USERNAME;

    if (!isCreator && !isAdmin) {
        alert("You do not have permission to rename this video.");
        return;
    }

    const newTitle = prompt(`Enter the new title for "${video.title}":`, video.title);
    if (newTitle === null || newTitle.trim() === '') return;
    if (newTitle.trim() === video.title) return;

    try {
        await room.collection(VIDEO_COLLECTION_TYPE).update(video.id, { title: newTitle.trim() });
        alert(`Video "${video.title}" successfully renamed to "${newTitle.trim()}".`);
    } catch (err) {
        console.error('Error renaming video:', err);
        alert('Failed to rename video. Please try again.');
    }
}

/* Helper: select a file via an input (kept local to this module) */
function selectFile(accept) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';
        document.body.appendChild(input);
        input.onchange = (e) => {
            const file = e.target.files[0];
            document.body.removeChild(input);
            resolve(file);
        };
        input.oncancel = () => {
            document.body.removeChild(input);
            resolve(null);
        };
        input.click();
    });
}

/* Handle changing thumbnail */
export async function handleChangeThumbnail(room, video) {
    const currentUser = room.peers[room.clientId];
    const currentUserUsername = currentUser?.username;
    const isCreator = video.username === currentUserUsername;
    const isAdmin = currentUserUsername === ADMIN_USERNAME;

    if (!isCreator && !isAdmin) {
        alert("You do not have permission to change the thumbnail of this video.");
        return;
    }

    if (!confirm(`Select a new thumbnail image for "${video.title}":`)) return;

    const thumbnailFile = await selectFile(ALLOWED_THUMBNAIL_FILE_TYPES.join(','));
    if (!thumbnailFile) return;

    if (thumbnailFile.size > MAX_THUMBNAIL_FILE_SIZE) {
        alert(`Thumbnail file is too large. Maximum size is ${MAX_THUMBNAIL_FILE_SIZE / (1024 * 1024)} MB.`);
        return;
    }

    if (!ALLOWED_THUMBNAIL_FILE_TYPES.includes(thumbnailFile.type)) {
        alert(`Unsupported thumbnail file type: ${thumbnailFile.type}. Please upload an image file (${ALLOWED_THUMBNAIL_FILE_TYPES.join(', ')}).`);
        return;
    }

    try {
        const newThumbnailUrl = await window.websim.upload(thumbnailFile);
        await room.collection(VIDEO_COLLECTION_TYPE).update(video.id, { thumbnailUrl: newThumbnailUrl });
        alert(`Thumbnail for "${video.title}" successfully updated.`);
    } catch (err) {
        console.error('Error changing thumbnail:', err);
        alert('Failed to change thumbnail. Please try again.');
    }
}

/* Tombstones for large moved implementations */
// removed function original handleRemoveVideo() {}
// removed function original handleToggleVisibility() {}
// removed function original handleRenameVideo() {}
// removed function original handleChangeThumbnail() {}