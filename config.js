/* The username of the admin user who can see and use the admin panel features. */
export const ADMIN_USERNAME = 'Scratch_Catalouge';

/* @tweakable The collection type name for persistent comments on videos */
export const COMMENT_COLLECTION_TYPE = 'comment_v1';
/* @tweakable The collection type name for likes on videos */
export const LIKE_COLLECTION_TYPE = 'like_v1';
/* @tweakable Maximum length of a comment */
export const MAX_COMMENT_LENGTH = 1000;

/* Maximum allowed size for video files in bytes. */
export const MAX_VIDEO_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GB

/* Allowed video file types for upload. */
export const ALLOWED_VIDEO_FILE_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

/* Maximum allowed size for thumbnail image files in bytes. (2 MB) */
export const MAX_THUMBNAIL_FILE_SIZE = 2 * 1024 * 1024; // 2 MB (This limit applies to manually changing thumbnail later, not auto-generated)

/* Allowed thumbnail image file types for upload. */
export const ALLOWED_THUMBNAIL_FILE_TYPES = ['image/png', 'image/jpeg', 'image/gif'];

/* Default thumbnail URL to use for all videos. */
/* The default thumbnail URL to use for videos that don't have a custom thumbnail (e.g., fallback on error) */
export const DEFAULT_THUMBNAIL_URL = "DefaultThumbnail.png";

/* @tweakable The time (in seconds) into the video from which to capture the thumbnail frame. */
export const THUMBNAIL_CAPTURE_TIME = 1; // Capture 1 second into the video

/* @tweakable The desired width for the generated video thumbnail. */
export const THUMBNAIL_WIDTH = 320;

/* @tweakable The desired height for the generated video thumbnail. */
export const THUMBNAIL_HEIGHT = 180; // A standard 16:9 aspect ratio size


/* The source URL for the logo image used as a watermark on the video player. */
/* The source URL for the watermark logo image in the video player */
export const WATERMARK_LOGO_URL = "IMG_3059.png";

/* The height of the watermark logo in the video player. */
export const WATERMARK_LOGO_HEIGHT = 80; // in pixels

/* @tweakable The background of the site logo image (set to 'transparent' to remove white box) */
export const SITE_LOGO_BACKGROUND = 'transparent';

/* The text slogan displayed next to the logo in the header. */
export const HEADER_SLOGAN_TEXT = "Watch Archived Videos For Free!";

/* The URL for the Discord server link in the header. */
export const DISCORD_LINK_URL = 'https://discord.gg/5QxWYwmc2H';

/* The text displayed for the Discord server link in the header. */
export const DISCORD_LINK_TEXT = 'Join Discord';

/* The collection type name used for storing chat messages. */
export const CHAT_COLLECTION_TYPE = 'message_v1'; // Using v1 for the initial version

/* The maximum length for a single chat message. */
/* The maximum number of characters allowed in a single chat message */
export const MAX_CHAT_MESSAGE_LENGTH = 500;

/* The initial state of the chat panel (true for minimized, false for expanded). */
export const CHAT_INITIAL_MINIMIZED_STATE = true; // Start minimized

/* The collection type name used for storing video records. */
export const VIDEO_COLLECTION_TYPE = 'video_v1';

/* The fields in the video record to search against. */
/* The video record fields that are searched when the user types in the search bar */
export const VIDEO_SEARCH_FIELDS = ['title', 'description', 'username'];

/* Confirmation message shown before removing a chat message. */
/* Confirmation message when deleting a chat message */
export const REMOVE_CHAT_MESSAGE_CONFIRM_MESSAGE = 'Are you sure you want to remove this message?';

/* Text for the button to remove a chat message (Admin action). */
/* Text for the button to remove a chat message */
export const REMOVE_CHAT_MESSAGE_BUTTON_TEXT = 'Remove';

/* The URL of the sound effect to play when minimizing or unminimizing the chat. */
export const CHAT_TOGGLE_SOUND_URL = '';

/* Whether to play a sound effect when minimizing or unminimizing the chat. */
export const ENABLE_CHAT_TOGGLE_SOUND = false;

/* The volume for the chat toggle sound (0.0 to 1.0). */
export const CHAT_TOGGLE_SOUND_VOLUME = 1.0;

// --- Sound Effects ---

/* Whether to play a sound effect when clicking a video thumbnail to open the modal. */
export const ENABLE_VIDEO_CLICK_SOUND = false;
/* The URL of the sound effect to play when clicking a video thumbnail. */
export const VIDEO_CLICK_SOUND_URL = '';

/* Whether to play a sound effect when closing the video modal. */
export const ENABLE_MODAL_CLOSE_SOUND = false;
/* The URL of the sound effect to play when closing the video modal. */
export const MODAL_CLOSE_SOUND_URL = '';

/* Whether to play a sound effect when clicking the upload button to initiate the file selection. */
export const ENABLE_UPLOAD_CLICK_SOUND = false;
/* The URL of the sound effect to play when clicking the upload button. */
export const UPLOAD_CLICK_SOUND_URL = '';

/* Whether to play a sound effect when successfully sending a chat message. */
export const ENABLE_SEND_MESSAGE_SOUND = false;
/* The URL of the sound effect to play when sending a chat message. */
export const SEND_MESSAGE_SOUND_URL = '';

/* Whether to play a sound effect when successfully removing a video. */
export const ENABLE_REMOVE_VIDEO_SOUND = false;
/* The URL of the sound effect to play when removing a video. */
export const REMOVE_VIDEO_SOUND_URL = '';

/* Whether to play a sound effect when successfully toggling video visibility. */
export const ENABLE_TOGGLE_VISIBILITY_SOUND = false;
/* The URL of the sound effect to play when toggling video visibility. */
export const TOGGLE_VISIBILITY_SOUND_URL = '';

/* Whether to play a sound effect when clicking the "Change Thumbnail" button (initiating file selection). */
export const ENABLE_CHANGE_THUMBNAIL_SOUND = false;
/* The URL of the sound effect to play when clicking the "Change Thumbnail" button. */
export const CHANGE_THUMBNAIL_SOUND_URL = '';

/* Whether to play a sound effect when successfully removing a chat message (Admin action). */
export const ENABLE_REMOVE_CHAT_SOUND = false;
/* The URL of the sound effect to play when removing a chat message. */
export const REMOVE_CHAT_SOUND_URL = '';

// --- Secret Link Configuration ---

/* @tweakable Whether to enable the secret redirect link feature. */
export const ENABLE_SECRET_LINK = true;

/* @tweakable The CSS selector for the element that triggers the secret link when clicked. */
export const SECRET_LINK_TRIGGER_SELECTOR = '#site-logo';

/* @tweakable The URL the secret link redirects to. */
export const SECRET_LINK_URL = 'https://www.youtube.com/watch?v=Grs8rgV3j0s';

/* @tweakable If true, the secret link will open in a new window/tab. If false, it will replace the current page. */
export const SECRET_LINK_OPEN_IN_NEW_WINDOW = true;

/* @tweakable Retro theme tuning values (use these to fine-tune global look without editing CSS directly) */
/* @tweakable Primary site accent color */
export const RETRO_THEME_ACCENT = '#d35400';
/* @tweakable Background paper color (hex) */
export const RETRO_THEME_PAPER_BG = '#e6eef7';
/* @tweakable Card background color */
export const RETRO_CARD_BG = '#f6fbff';
/* @tweakable Inset border size in pixels */
export const RETRO_INSET_BORDER_SIZE_PX = 3;