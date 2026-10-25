/**
 * Refactored coordinator for video list rendering.
 *
 * This file now delegates rendering and action logic to smaller modules:
 *  - ./video-item.js         -> videoItemTemplate
 *  - ./video-actions.js      -> handleRemoveVideo, handleToggleVisibility, handleRenameVideo, handleChangeThumbnail
 *
 * Tombstones kept for removed inline implementations so future diffs show what was moved.
 */

/* @tweakable Number of columns to use for the LiveLeak-style home grid (overrides CSS var if set) */
export const LIVELEAK_GRID_COLUMNS = 3;

/* @tweakable Controls the hosted badge settings used by video-item.js (keeps tuning easy) */
/* @tweakable Controls the hosted badge settings used by video-item.js (keeps tuning easy)
   @tweakable showInList: when false the hosted badge will NOT be rendered on video tiles in the grid;
   the badge remains available for use in the full video page (video-modal.js) which reads the same config.
*/
export const HOSTED_BADGE_CONFIG = {
    url: 'IMG_3059.png', /* @tweakable hosted badge image URL */
    width: 72,            /* @tweakable badge width (px) */
    height: 28,           /* @tweakable badge height (px) */
    left: 8,              /* @tweakable left offset (px) */
    top: 8,               /* @tweakable top offset (px) */
    showText: false,      /* @tweakable show "HOSTED ON" text */
    showInList: false,    /* @tweakable when true the badge appears on video tiles in the grid */
    opacity: 0.9,         /* @tweakable badge opacity */
    blendMode: 'multiply' /* @tweakable badge mix-blend-mode */
};

/* Re-exported API used by the rest of the app. */
import { renderVideoList as _renderVideoList } from './video-item.js';
import {
    handleRemoveVideo as _handleRemoveVideo,
    handleToggleVisibility as _handleToggleVisibility,
    handleRenameVideo as _handleRenameVideo,
    handleChangeThumbnail as _handleChangeThumbnail
} from './video-actions.js';

/* Export the same names used before so other modules don't need to change imports. */
export const renderVideoList = _renderVideoList;
export const handleRemoveVideo = _handleRemoveVideo;
export const handleToggleVisibility = _handleToggleVisibility;
export const handleRenameVideo = _handleRenameVideo;
export const handleChangeThumbnail = _handleChangeThumbnail;

/* Tombstones for removed functions (keeps history readable) */
// removed function videoItemTemplate() {}
// removed function playSound() {}
// removed function selectFile() {}
// removed function handleRemoveVideo() {}
// removed function handleToggleVisibility() {}
// removed function handleRenameVideo() {}
// removed function handleChangeThumbnail() {}
