import { html, render } from 'lit';
import DOMPurify from 'dompurify'; 
import {
    CHAT_COLLECTION_TYPE,
    MAX_CHAT_MESSAGE_LENGTH,
    CHAT_INITIAL_MINIMIZED_STATE,
    ADMIN_USERNAME,
    REMOVE_CHAT_MESSAGE_BUTTON_TEXT,
    REMOVE_CHAT_MESSAGE_CONFIRM_MESSAGE,
    CHAT_TOGGLE_SOUND_URL,
    ENABLE_CHAT_TOGGLE_SOUND,
    CHAT_TOGGLE_SOUND_VOLUME,
    ENABLE_SEND_MESSAGE_SOUND,
    SEND_MESSAGE_SOUND_URL,
    ENABLE_REMOVE_CHAT_SOUND,
    REMOVE_CHAT_SOUND_URL
} from './config.js';

let isChatMinimized = CHAT_INITIAL_MINIMIZED_STATE;

const chatToggleSound = ENABLE_CHAT_TOGGLE_SOUND ? new Audio(CHAT_TOGGLE_SOUND_URL) : null;
if (chatToggleSound) chatToggleSound.volume = CHAT_TOGGLE_SOUND_VOLUME;

const sendMessageSound = ENABLE_SEND_MESSAGE_SOUND ? new Audio(SEND_MESSAGE_SOUND_URL) : null;
const removeChatSound = ENABLE_REMOVE_CHAT_SOUND ? new Audio(REMOVE_CHAT_SOUND_URL) : null;

// Helper function to play a sound
function playSound(audioElement) {
    if (audioElement) {
        audioElement.currentTime = 0;
        audioElement.play().catch(e => console.error("Error playing sound:", e));
    }
}

export function renderChatMessages(room, messages, currentUserUsername) {
    const chatMessagesContainer = document.getElementById('chat-messages');
    if (!chatMessagesContainer) return;

    const sortedMessages = [...messages].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const isAdmin = currentUserUsername === ADMIN_USERNAME;

    render(html`
        ${sortedMessages.map(msg => {
            const user = room.peers[msg.clientId] || { username: msg.username, avatarUrl: msg.username ? `https://images.websim.ai/avatar/${msg.username}` : '' };
            const avatarUrl = user.avatarUrl || '';

            // Sanitize message text before rendering.
            // Lit-HTML's ${variable} syntax escapes HTML entities by default,
            // but sanitizing with DOMPurify adds an extra layer of safety
            // against complex XSS vectors, especially if allowing limited HTML later.
            // For now, we strip all HTML using ALLOWED_TAGS: []
            /* Configures DOMPurify to strip all HTML tags from chat messages */
            const cleanMessageText = DOMPurify.sanitize(msg.text, { ALLOWED_TAGS: [] });


            return html`
                <div class="chat-message">
                    ${avatarUrl ? html`<img src="${avatarUrl}" alt="${user.username}'s avatar">` : ''}
                    <div class="message-content">
                        <strong>${user.username || 'Unknown'}</strong>
                        <span>${cleanMessageText}</span>
                    </div>
                    ${isAdmin ? html`
                        <button class="remove-chat-button" @click=${(e) => handleRemoveMessage(room, msg, e)}>
                            ${REMOVE_CHAT_MESSAGE_BUTTON_TEXT}
                        </button>
                    ` : ''}
                </div>
            `;
        })}
    `, chatMessagesContainer);

    if (!isChatMinimized) {
        setTimeout(() => {
            chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }, 0);
    }
}

export async function handleSendMessage(room, event) {
    event.preventDefault();

    const chatInput = document.getElementById('chat-input');
    if (!chatInput) return;

    const messageText = chatInput.value.trim();

    if (messageText === '') {
        return;
    }

    if (messageText.length > MAX_CHAT_MESSAGE_LENGTH) {
        alert(`Message is too long. Maximum length is ${MAX_CHAT_MESSAGE_LENGTH} characters.`);
        return;
    }

    // Sanitize message text before saving to the database
    /* Configures DOMPurify to strip all HTML tags from chat messages before saving */
    const sanitizedMessageText = DOMPurify.sanitize(messageText, { ALLOWED_TAGS: [] });


    try {
        await room.collection(CHAT_COLLECTION_TYPE).create({
            text: sanitizedMessageText,
        });
        console.log('Message sent:', sanitizedMessageText);
        playSound(sendMessageSound);

        chatInput.value = '';

    } catch (error) {
        console.error('Error sending message:', error);
        alert('Failed to send message. Please try again.');
    }
}

export async function handleRemoveMessage(room, message, event) {
    event.stopPropagation();

    console.log(`Attempting to remove message: "${message.text}" (ID: ${message.id})`);

    const currentUser = room.peers[room.clientId];
    const currentUserUsername = currentUser?.username;
    if (currentUserUsername !== ADMIN_USERNAME) {
        alert("You do not have permission to remove chat messages.");
        return;
    }

    if (confirm(REMOVE_CHAT_MESSAGE_CONFIRM_MESSAGE)) {
        try {
            await room.collection(CHAT_COLLECTION_TYPE).delete(message.id);
            console.log('Chat message deleted successfully.');
            playSound(removeChatSound);
        } catch (error) {
            console.error('Error deleting chat message:', error);
            alert('Failed to delete chat message. Please try again.');
        }
    }
}

export function toggleChatMinimize(renderChatMessagesCallback) {
    isChatMinimized = !isChatMinimized;
    const chatContainer = document.getElementById('chat-container');
    const minimizeButton = document.getElementById('minimize-chat-button');

    if (chatContainer) {
        if (isChatMinimized) {
            chatContainer.classList.add('minimized-side');
            if (minimizeButton) minimizeButton.textContent = '+';
        } else {
            chatContainer.classList.remove('minimized-side');
            if (minimizeButton) minimizeButton.textContent = '–';
            const chatMessagesContainer = document.getElementById('chat-messages');
            if (chatMessagesContainer) {
                setTimeout(() => {
                    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
                }, 50);
            }
        }

        playSound(chatToggleSound);
    }
}

export function setInitialChatMinimizeState(room, currentUserUsername) {
    const chatContainer = document.getElementById('chat-container');
    const minimizeButton = document.getElementById('minimize-chat-button');

    if (chatContainer) {
        isChatMinimized = CHAT_INITIAL_MINIMIZED_STATE;
        if (isChatMinimized) {
            chatContainer.classList.add('minimized-side');
            if (minimizeButton) minimizeButton.textContent = '+';
        } else {
            chatContainer.classList.remove('minimized-side');
            if (minimizeButton) minimizeButton.textContent = '–';
            const currentMessages = room.collection(CHAT_COLLECTION_TYPE).getList();
            renderChatMessages(room, currentMessages, currentUserUsername);
            const chatMessagesContainer = document.getElementById('chat-messages');
            if (chatMessagesContainer) {
                setTimeout(() => {
                    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
                }, 0);
            }
        }
    }
}