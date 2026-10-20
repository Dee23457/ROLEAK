import { html, render } from 'lit';
import {
    MAX_VIDEO_FILE_SIZE,
    ALLOWED_VIDEO_FILE_TYPES,
    DEFAULT_THUMBNAIL_URL, // Kept as a potential fallback, though auto-generated will be default for new uploads
    VIDEO_COLLECTION_TYPE,
    ENABLE_UPLOAD_CLICK_SOUND,
    UPLOAD_CLICK_SOUND_URL,
    THUMBNAIL_CAPTURE_TIME, /* @tweakable The time (in seconds) into the video from which to capture the thumbnail frame. */
    THUMBNAIL_WIDTH, /* @tweakable The desired width for the generated video thumbnail. */
    THUMBNAIL_HEIGHT /* @tweakable The desired height for the generated video thumbnail. */
} from './config.js';

// Initialize sound
const uploadClickSound = ENABLE_UPLOAD_CLICK_SOUND ? new Audio(UPLOAD_CLICK_SOUND_URL) : null;

// Helper function to play a sound
function playSound(audioElement) {
    if (audioElement) {
        audioElement.currentTime = 0;
        audioElement.play().catch(e => console.error("Error playing sound:", e));
    }
}

// Helper function to trigger file input and return selected file
function selectFile(accept) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';
        document.body.appendChild(input);

        input.onchange = (event) => {
            const file = event.target.files[0];
            document.body.removeChild(input);
            resolve(file);
        };

        // Handle cancellation if user closes the dialog without selecting a file
        input.oncancel = () => {
             document.body.removeChild(input);
             resolve(null);
        }

        // Play sound when the file picker is about to open for video selection
        // playSound(uploadClickSound); // Moved sound play to button click handler in script.js

        input.click();
    });
}

// Function to generate a thumbnail from a video file
async function generateThumbnail(videoFile) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        // Ensure video is not visible and muted
        video.style.display = 'none';
        video.muted = true;
        // Add to DOM temporarily to ensure proper loading/playback state on some browsers
        document.body.appendChild(video);


        video.setAttribute('src', URL.createObjectURL(videoFile));
        video.load();

        video.addEventListener('loadedmetadata', () => {
            // @tweakable The time (in seconds) into the video from which to capture the thumbnail frame.
            const captureTime = THUMBNAIL_CAPTURE_TIME;

            // @tweakable The desired width for the generated video thumbnail.
            const thumbnailWidth = THUMBNAIL_WIDTH;
            // @tweakable The desired height for the generated video thumbnail.
            const thumbnailHeight = THUMBNAIL_HEIGHT;

            // Calculate the aspect ratio of the video
            const videoAspectRatio = video.videoWidth / video.videoHeight;
            const thumbnailAspectRatio = thumbnailWidth / thumbnailHeight;

            let drawWidth = thumbnailWidth;
            let drawHeight = thumbnailHeight;
            let offsetX = 0;
            let offsetY = 0;

            // Adjust dimensions to maintain aspect ratio and fit within target size
            if (videoAspectRatio > thumbnailAspectRatio) {
                // Video is wider than thumbnail target aspect - letterbox top/bottom
                drawHeight = thumbnailWidth / videoAspectRatio;
                offsetY = (thumbnailHeight - drawHeight) / 2;
                drawWidth = thumbnailWidth;
            } else {
                // Video is taller than thumbnail target aspect - letterbox left/right
                drawWidth = thumbnailHeight * videoAspectRatio;
                offsetX = (thumbnailWidth - drawWidth) / 2;
                drawHeight = thumbnailHeight;
            }

            canvas.width = thumbnailWidth;
            canvas.height = thumbnailHeight;

            // Seek to the desired time
            // Ensure capture time is within the video duration, but not the very end which might be blank
            video.currentTime = Math.min(captureTime, video.duration > 0.1 ? video.duration - 0.1 : 0);


            // Wait for seeking to complete and a frame to be available
             const captureFrame = () => {
                try {
                    // Draw the frame onto the canvas, scaled and centered if necessary
                    context.fillStyle = '#000'; // Black background for potential letterboxing
                    context.fillRect(0, 0, canvas.width, canvas.height);
                    context.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

                    // Convert canvas to Blob
                    canvas.toBlob((blob) => {
                         // Clean up temporary elements and URL *before* resolving
                         URL.revokeObjectURL(video.src);
                         video.remove();
                         canvas.remove();

                        if (!blob) {
                             console.error('Canvas to Blob conversion failed.');
                            resolve(null);
                            return;
                        }
                        // Create a File object from the Blob
                        const thumbnailFile = new File([blob], 'thumbnail.png', { type: 'image/png' });
                        resolve(thumbnailFile);

                    }, 'image/png', 0.9); // Specify PNG format and quality


                } catch (e) {
                    console.error('Error drawing video frame to canvas:', e);
                    // Clean up temporary elements and URL on error
                    URL.revokeObjectURL(video.src);
                    video.remove();
                    canvas.remove();
                    resolve(null);
                }
            };

             // Attempt to capture the frame after a small delay or upon 'seeked' event
             // 'seeked' is generally more reliable than just a timeout after setting currentTime
             video.addEventListener('seeked', captureFrame, { once: true });

             // Add a fallback timeout in case seeked doesn't fire or frame isn't ready immediately
             setTimeout(() => {
                 // If seeked hasn't fired or captureFrame hasn't been called yet, try capturing
                 if (video.readyState >= 2) { // Check if metadata is loaded (HAVE_CURRENT_DATA or more)
                      captureFrame();
                 } else {
                      console.warn('Video not ready for frame capture after timeout.');
                      // Clean up temporary elements and URL on error
                      URL.revokeObjectURL(video.src);
                      video.remove();
                      canvas.remove();
                      resolve(null); // Resolve with null if video isn't ready
                 }
             }, 500); // Small delay


        }, { once: true });

         // Handle potential errors during metadata loading
         video.addEventListener('error', (e) => {
             console.error('Error loading video metadata:', video.error, e);
             // Clean up temporary elements and URL on error
             URL.revokeObjectURL(video.src);
             video.remove();
             canvas.remove();
             resolve(null); // Resolve with null on error
         }, { once: true });
    });
}


// Function to handle video upload
/* @tweakable Label text shown on the upload modal's title */
const UPLOAD_MODAL_TITLE = 'Upload a Video';
/* @tweakable Placeholder for title input */
const UPLOAD_TITLE_PLACEHOLDER = 'Enter video title';
/* @tweakable Placeholder for description input */
const UPLOAD_DESCRIPTION_PLACEHOLDER = 'Add an optional description';
/* @tweakable Text for the confirm upload button */
const UPLOAD_CONFIRM_TEXT = 'Upload';
/* @tweakable Text for the cancel button */
const UPLOAD_CANCEL_TEXT = 'Cancel';
/* @tweakable Whether to auto-generate a thumbnail (true) or require user confirmation (false) */
const UPLOAD_AUTO_GENERATE_THUMBNAIL = true;

export async function handleUpload(room, renderVideoList, isUploadingState, updateIsUploadingState) {
    if (isUploadingState) {
        alert("An upload is already in progress.");
        return;
    }

    // Create centered modal UI
    updateIsUploadingState(true);
    const prevActive = document.activeElement;

    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(6,18,24,0.6)';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = 3000;

    const modal = document.createElement('div');
    modal.style.width = '92%';
    modal.style.maxWidth = '720px';
    modal.style.background = '#fff';
    modal.style.borderRadius = '12px';
    modal.style.padding = '16px';
    modal.style.boxSizing = 'border-box';
    modal.style.boxShadow = '0 20px 48px rgba(0,0,0,0.28)';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.gap = '10px';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('div');
    titleEl.textContent = UPLOAD_MODAL_TITLE;
    titleEl.style.fontWeight = '700';
    titleEl.style.fontSize = '1.05rem';
    modal.appendChild(titleEl);

    const form = document.createElement('form');
    form.style.display = 'flex';
    form.style.flexDirection = 'column';
    form.style.gap = '8px';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = UPLOAD_TITLE_PLACEHOLDER;
    titleInput.style.padding = '10px';
    titleInput.style.border = '1px solid rgba(0,0,0,0.08)';
    titleInput.style.borderRadius = '6px';
    titleInput.required = true;
    form.appendChild(titleInput);

    const descInput = document.createElement('textarea');
    descInput.placeholder = UPLOAD_DESCRIPTION_PLACEHOLDER;
    descInput.rows = 3;
    descInput.style.padding = '10px';
    descInput.style.border = '1px solid rgba(0,0,0,0.08)';
    descInput.style.borderRadius = '6px';
    form.appendChild(descInput);

    const fileRow = document.createElement('div');
    fileRow.style.display = 'flex';
    fileRow.style.gap = '8px';
    fileRow.style.alignItems = 'center';

    const fileLabel = document.createElement('div');
    fileLabel.textContent = 'No file selected';
    fileLabel.style.flex = '1';
    fileLabel.style.fontSize = '0.95em';
    fileLabel.style.color = '#333';
    fileRow.appendChild(fileLabel);

    const chooseBtn = document.createElement('button');
    chooseBtn.type = 'button';
    chooseBtn.textContent = 'Choose File';
    chooseBtn.style.padding = '8px 12px';
    chooseBtn.style.border = '1px solid rgba(0,0,0,0.06)';
    chooseBtn.style.borderRadius = '8px';
    chooseBtn.style.background = 'linear-gradient(180deg,#fff,#fff7ef)';
    fileRow.appendChild(chooseBtn);

    form.appendChild(fileRow);

    // Preview area
    const preview = document.createElement('div');
    preview.style.display = 'none';
    preview.style.flexDirection = 'column';
    preview.style.gap = '8px';

    const previewThumb = document.createElement('img');
    previewThumb.style.maxWidth = '100%';
    previewThumb.style.maxHeight = '220px';
    previewThumb.style.borderRadius = '6px';
    previewThumb.style.objectFit = 'cover';
    preview.appendChild(previewThumb);

    const previewInfo = document.createElement('div');
    previewInfo.style.fontSize = '0.9em';
    previewInfo.style.color = '#333';
    preview.appendChild(previewInfo);

    form.appendChild(preview);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '8px';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = UPLOAD_CANCEL_TEXT;
    cancelBtn.style.padding = '8px 12px';
    cancelBtn.style.border = '1px solid rgba(0,0,0,0.06)';
    cancelBtn.style.borderRadius = '8px';
    cancelBtn.style.background = '#fff';
    actions.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'submit';
    confirmBtn.textContent = UPLOAD_CONFIRM_TEXT;
    confirmBtn.style.padding = '8px 12px';
    confirmBtn.style.border = '1px solid rgba(0,0,0,0.06)';
    confirmBtn.style.borderRadius = '8px';
    confirmBtn.style.background = 'linear-gradient(180deg,#fff,#fff7ef)';
    actions.appendChild(confirmBtn);

    form.appendChild(actions);
    modal.appendChild(form);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Local state
    let chosenFile = null;
    let generatedThumbnailFile = null;

    // Wire up file chooser
    chooseBtn.addEventListener('click', async () => {
        const f = await selectFile(ALLOWED_VIDEO_FILE_TYPES.join(','));
        if (!f) return;
        // Basic client-side checks
        if (f.size > MAX_VIDEO_FILE_SIZE) {
            alert(`Video file is too large. Maximum size is ${MAX_VIDEO_FILE_SIZE / (1024 * 1024)} MB.`);
            return;
        }
        if (!ALLOWED_VIDEO_FILE_TYPES.includes(f.type)) {
            alert(`Unsupported video file type: ${f.type}. Please choose mp4/webm/quicktime.`);
            return;
        }
        chosenFile = f;
        fileLabel.textContent = `${f.name} • ${(f.size / (1024*1024)).toFixed(2)} MB`;
        preview.style.display = 'flex';
        previewInfo.textContent = `File: ${f.name}`;

        // Start generating thumbnail (optionally automatically)
        if (UPLOAD_AUTO_GENERATE_THUMBNAIL) {
            previewInfo.textContent = `Generating thumbnail...`;
            const thumb = await generateThumbnail(f);
            if (thumb) {
                generatedThumbnailFile = thumb;
                const thumbUrl = URL.createObjectURL(thumb);
                previewThumb.src = thumbUrl;
                previewInfo.textContent = `Preview generated.`;
                // Revoke URL later after upload completes
            } else {
                previewInfo.textContent = `Thumbnail generation failed; default will be used.`;
                generatedThumbnailFile = null;
            }
        }
    });

    // Cancel handler
    const cleanupAndClose = () => {
        overlay.remove();
        updateIsUploadingState(false);
        try { if (prevActive && typeof prevActive.focus === 'function') prevActive.focus(); } catch(e){}
    };

    cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        cleanupAndClose();
    });

    // Submit handler
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!chosenFile) {
            alert('Please choose a video file first.');
            return;
        }
        const titleText = (titleInput.value || '').trim();
        if (!titleText) {
            alert('Please enter a title for the video.');
            return;
        }

        // Disable UI while processing
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        chooseBtn.disabled = true;
        titleInput.disabled = true;
        descInput.disabled = true;
        fileLabel.textContent = 'Preparing upload...';

        // Use generated thumbnail if available, else attempt generation now, else fallback.
        let thumbFile = generatedThumbnailFile;
        if (!thumbFile) {
            fileLabel.textContent = 'Generating thumbnail...';
            thumbFile = await generateThumbnail(chosenFile);
            if (!thumbFile) {
                console.warn('Thumbnail generation failed, falling back to default.');
            }
        }

        // Upload thumbnail first (if we have one)
        let thumbnailUrl = DEFAULT_THUMBNAIL_URL;
        if (thumbFile) {
            fileLabel.textContent = 'Uploading thumbnail...';
            try {
                thumbnailUrl = await window.websim.upload(thumbFile);
            } catch (err) {
                console.error('Thumbnail upload failed:', err);
                thumbnailUrl = DEFAULT_THUMBNAIL_URL;
            }
        }

        // Upload video
        try {
            fileLabel.textContent = 'Uploading video... This may take a while.';
            const videoUrl = await window.websim.upload(chosenFile);

            // Create record
            await room.collection(VIDEO_COLLECTION_TYPE).create({
                title: titleText,
                description: (descInput.value || '').trim(),
                videoUrl,
                thumbnailUrl,
                views: 0
            });

            alert(`Video "${titleText}" uploaded successfully!`);
        } catch (err) {
            console.error('Error uploading video or creating record:', err);
            alert('Failed to upload video or create record. Please try again.');
        } finally {
            cleanupAndClose();
        }
    });

    // Close modal on ESC
    const onKey = (ev) => {
        if (ev.key === 'Escape') cleanupAndClose();
    };
    window.addEventListener('keydown', onKey, { once: false });

    // Focus first input
    setTimeout(() => titleInput.focus(), 50);
}