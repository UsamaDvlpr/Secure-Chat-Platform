const DEFAULT_PASSWORD = "123";
let isLoggedIn = false;

const socket = io();
let localConnection;
let remoteConnection;
let dataChannel;
let receiveChannel;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let peerPublicKey = null;
let privateKey = null;
let myKeyPair = null;
let connectedUsers = new Map(); // Store connected users with their status
let currentUser = null; // Store current user's info
const activeUsers = new Set(); // Track active users across tabs
let peerUsername = null; // Store the peer's username

// ` UI Elements
const messageInput = document.getElementById("messageInput");
const messageArea = document.querySelector(".message__area");
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.style.display = "none";
document.body.appendChild(fileInput);
const sendButton = document.querySelector(".send-btn");

// Add this at the top of client.js
window.windowId = Math.random().toString(36).substring(2);

// Add these constants at the top of the file
const CHUNK_SIZE = 16384; // 16KB chunks
const MAX_CHUNK_RETRIES = 3;

// Add this validation utility object
const Validator = {
    message: (text) => {
        if (!text || typeof text !== 'string') return false;
        if (text.trim().length === 0) return false;
        if (text.length > 5000) return false; // Maximum message length
        return true;
    },

    file: (file) => {
        const maxSize = 100 * 1024 * 1024; // 100MB max file size
        const allowedTypes = [
            'image/',
            'video/',
            'audio/',
            'application/pdf',
            'text/',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];

        if (!file || file.size === 0) return false;
        if (file.size > maxSize) return false;
        if (!allowedTypes.some(type => file.type.startsWith(type))) return false;
        return true;
    },

    username: (username) => {
        if (!username || typeof username !== 'string') return false;
        if (username.length < 3 || username.length > 30) return false;
        return /^[a-zA-Z0-9_-]+$/.test(username);
    },

    password: (password) => {
        if (!password || typeof password !== 'string') return false;
        if (password.length < 8) return false;
        // Require at least one uppercase, one lowercase, one number
        return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
    }
};

function checkExistingSession() {
    try {
        const currentSession = localStorage.getItem('activeSession');
        if (currentSession) {
            const sessionData = JSON.parse(currentSession);
            const now = new Date().getTime();
            
            // Check if session is still valid (24 hours) and belongs to this window
            if (now - sessionData.timestamp < 24 * 60 * 60 * 1000 && 
                sessionData.windowId === window.windowId) {
                return sessionData.username;
            } else {
                localStorage.removeItem('activeSession');
            }
        }
    } catch (error) {
        console.error('Error checking session:', error);
        localStorage.removeItem('activeSession');
    }
    return null;
}

// Add login handling function
async function handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorElement = document.getElementById('loginError');
    
    if (!Validator.username(username)) {
        errorElement.textContent = "Username must be 3-30 characters long and contain only letters, numbers, underscore or hyphen";
        errorElement.style.display = 'block';
        return false;
    }
    
    if (!Validator.password(password)) {
        errorElement.textContent = "Password must be at least 8 characters long and contain uppercase, lowercase and numbers";
        errorElement.style.display = 'block';
        return false;
    }
    
    try {
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                username, 
                password,
                windowId: window.windowId 
            })
        });

        const data = await response.json();
        
        if (data.success) {
            currentUser = {
                username: username,
                windowId: window.windowId
            };
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            localStorage.setItem('activeSession', JSON.stringify({
                username: username,
                timestamp: new Date().getTime(),
                windowId: window.windowId
            }));
            
            document.getElementById('loginOverlay').style.display = 'none';
            localStorage.setItem('username', username);
            
            setupConnection();
            updateActiveUsers();
            updateSendButtonState();
            
            document.querySelector('.chat-header-info h1').textContent = `Welcome, ${username}!`;
        } else {
            errorElement.textContent = data.error || "Invalid credentials";
            errorElement.style.display = 'block';
        }
    } catch (error) {
        console.error('Login error:', error);
        errorElement.textContent = "Error logging in. Please try again.";
        errorElement.style.display = 'block';
    }
    return false;
}

// Add these validation functions
function validatePassword(password) {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    
    const errors = [];
    if (password.length < minLength) {
        errors.push(`Password must be at least ${minLength} characters long`);
    }
    if (!hasUpperCase) {
        errors.push("Password must contain at least one uppercase letter");
    }
    if (!hasLowerCase) {
        errors.push("Password must contain at least one lowercase letter");
    }
    if (!hasNumbers) {
        errors.push("Password must contain at least one number");
    }
    
    return errors;
}

// Update handleSignup function
async function handleSignup(event) {
    event.preventDefault();
    
    const username = document.getElementById('signupUsername').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const errorElement = document.getElementById('signupError');
    
    // Validate username
    if (username.length < 3) {
        errorElement.textContent = "Username must be at least 3 characters long";
        errorElement.style.display = 'block';
        return false;
    }

    // Validate password
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
        errorElement.textContent = passwordErrors.join('. ');
        errorElement.style.display = 'block';
        return false;
    }
    
    if (password !== confirmPassword) {
        errorElement.textContent = "Passwords do not match";
        errorElement.style.display = 'block';
        return false;
    }
    
    try {
        const response = await fetch('/auth/signup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        
        if (data.success) {
            document.getElementById('signupForm').classList.add('hidden');
            document.getElementById('loginForm').classList.remove('hidden');
            document.getElementById('loginUsername').value = username;
            document.querySelector('[data-form="login"]').classList.add('active');
            document.querySelector('[data-form="signup"]').classList.remove('active');
            errorElement.style.display = 'none';
        } else {
            errorElement.textContent = data.error || "Error creating account";
            errorElement.style.display = 'block';
        }
    } catch (error) {
        console.error('Signup error:', error);
        errorElement.textContent = "Error creating account. Please try again.";
        errorElement.style.display = 'block';
    }
    return false;
}

// Add form switch functionality
document.addEventListener('DOMContentLoaded', () => {
    const switchButtons = document.querySelectorAll('.switch-btn');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    
    switchButtons.forEach(button => {
        button.addEventListener('click', () => {
            const formType = button.getAttribute('data-form');
            
            // Update active states
            switchButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Show/hide forms
            if (formType === 'login') {
                loginForm.classList.remove('hidden');
                signupForm.classList.add('hidden');
            } else {
                loginForm.classList.add('hidden');
                signupForm.classList.remove('hidden');
            }
            
            // Clear error messages
            document.getElementById('loginError').style.display = 'none';
            document.getElementById('signupError').style.display = 'none';
        });
    });
});

// Add this check when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const activeUser = checkExistingSession();
    const loginOverlay = document.getElementById('loginOverlay');
    
    if (activeUser && window.windowId === JSON.parse(localStorage.getItem('activeSession')).windowId) {
        // User is already logged in this window
        loginOverlay.style.display = 'none';
        localStorage.setItem('username', activeUser);
        setupConnection();
        updateActiveUsers();
        updateSendButtonState();
        document.querySelector('.chat-header-info h1').textContent = `Welcome, ${activeUser}!`;
    } else {
        loginOverlay.style.display = 'flex';
    }
});

// Initialize WebRTC connection
function setupConnection() {
    localConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    dataChannel = localConnection.createDataChannel("chat");
    setupDataChannel(dataChannel);

    localConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("signal", { candidate: event.candidate });
        }
    };

    createOffer();
}

// Set up DataChannel events
function setupDataChannel(channel) {
    channel.onopen = async () => {
        console.log("Data channel is open");
        await initializeEncryption();
        
        // Announce presence with current user info
        if (currentUser) {
            channel.send(JSON.stringify({
                type: 'user_connected',
                user: currentUser
            }));
        }
        
        updateActiveUsers();
        updateSendButtonState();
    };

    channel.onclose = () => {
        console.log("Data channel is closed");
        connectedUsers.clear(); // Clear connected users on disconnect
        updateActiveUsers();
        updateSendButtonState();
    };

    channel.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'user_connected':
                    // Add connected user to our list
                    connectedUsers.set(data.user.windowId, {
                        username: data.user.username,
                        status: 'Online'
                    });
                    // Send back our info to the newly connected user
                    if (currentUser) {
                        channel.send(JSON.stringify({
                            type: 'user_connected',
                            user: currentUser
                        }));
                    }
                    updateActiveUsers();
                    break;

                case 'message':
                    if (data.encrypted && myKeyPair?.privateKey) {
                        try {
                            const decryptedMessage = await Encryption.decryptMessage(data.content, myKeyPair.privateKey);
                            displayMessage(data.sender, decryptedMessage, false);
                        } catch (error) {
                            console.error("Error decrypting message:", error);
                        }
                    }
                    break;

                case 'user_status':
                    if (data.status === 'online') {
                        activeUsers.add(data.username);
                    } else if (data.status === 'offline') {
                        activeUsers.delete(data.username);
                    }
                    updateActiveUsers();
                    break;

                case 'username':
                    // Store peer's username with their window ID
                    peerUsername = data.username; // Store peer's username
                    connectedUsers.set('peer', {
                        username: data.username,
                        status: 'Connected',
                        id: data.id
                    });
                    localStorage.setItem('peerUsername', data.username);
                    updateActiveUsers();
                    break;

                case 'file_start':
                    console.log('Receiving file:', data.fileName);
                    fileBuffers.set(data.fileId, {
                        chunks: new Array(data.chunks),
                        fileName: data.fileName,
                        fileType: data.fileType,
                        fileSize: data.fileSize,
                        receivedChunks: 0
                    });
                    break;

                case 'file_chunk':
                    const fileBuffer = fileBuffers.get(data.fileId);
                    if (fileBuffer) {
                        fileBuffer.chunks[data.index] = data.data;
                        fileBuffer.receivedChunks++;

                        // When all chunks are received, reconstruct and display the file
                        if (fileBuffer.receivedChunks === fileBuffer.chunks.length) {
                            try {
                                const base64Data = fileBuffer.chunks.join('');
                                const fileData = {
                                    name: fileBuffer.fileName,
                                    type: fileBuffer.fileType,
                                    size: fileBuffer.fileSize,
                                    content: base64Data
                                };
                                handleFileMessage(fileData);
                                fileBuffers.delete(data.fileId);
                            } catch (error) {
                                console.error('Error processing complete file:', error);
                                displayMessage("System", "Error processing received file");
                            }
                        }
                    }
                    break;

                case 'public_key':
                    peerPublicKey = await Encryption.importPublicKey(data.key);
                    if (!data.isResponse) {
                        sendPublicKey(true);
                    }
                    break;

                case 'encrypted':
                    if (myKeyPair?.privateKey) {
                        try {
                            const decryptedMessage = await Encryption.decryptMessage(data.data, myKeyPair.privateKey);
                            displayMessage("Peer", decryptedMessage);
                        } catch (error) {
                            console.error("Error decrypting message:", error);
                        }
                    }
                    break;

                case 'file':
                    handleFileMessage(data.file, true);
                    break;

                case 'voice':
                    handleVoiceMessage(data.audio, true);
                    break;

                case 'delete_message':
                    const messageToDelete = document.querySelector(`.message[data-timestamp="${data.timestamp}"]`);
                    if (messageToDelete) {
                        messageToDelete.remove();
                    }
                    break;

                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    };
}

// Create an offer
function createOffer() {
    localConnection
        .createOffer()
        .then((offer) => {
            localConnection.setLocalDescription(offer);
            socket.emit("signal", { offer });
        })
        .catch((error) => console.error("Error creating offer:", error));
}

// Handle incoming signaling data
socket.on("signal", async (data) => {
    if (data.offer) {
        remoteConnection = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });

        remoteConnection.ondatachannel = (event) => {
            receiveChannel = event.channel;
            setupDataChannel(receiveChannel);
            updateActiveUsers();
        };

        remoteConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit("signal", { candidate: event.candidate });
            }
        };

        await remoteConnection.setRemoteDescription(data.offer);
        const answer = await remoteConnection.createAnswer();
        await remoteConnection.setLocalDescription(answer);
        socket.emit("signal", { answer });
    } else if (data.answer) {
        await localConnection.setRemoteDescription(data.answer);
    } else if (data.candidate) {
        const connection = remoteConnection || localConnection;
        if (connection) {
            await connection.addIceCandidate(data.candidate);
        }
    }
});

// Send Message Function
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!Validator.message(message) || !currentUser) {
        console.error('Invalid message');
        return;
    }

    try {
        if (peerPublicKey && myKeyPair) {
            const encryptedData = await Encryption.encryptMessage(message, peerPublicKey);
            const messageData = {
                type: 'message',
                sender: currentUser.username,
                content: encryptedData,
                encrypted: true,
                timestamp: new Date().toISOString()
            };

            const channel = dataChannel?.readyState === "open" ? dataChannel : receiveChannel;
            if (channel?.readyState === "open") {
                // Send to peer
                channel.send(JSON.stringify(messageData));
                
                // Log encrypted message
                socket.emit('encrypted_message', {
                    data: encryptedData,
                    timestamp: new Date().toISOString()
                });
                
                // Log decrypted message (for your own messages)
                socket.emit('decrypted_message', {
                    message: message,
                    timestamp: new Date().toISOString()
                });
                
                displayMessage(currentUser.username, message, true);
                messageInput.value = "";
            }
        }
    } catch (error) {
        console.error('Error sending message:', error);
    }
    updateSendButtonState();
}

// Display messages
function displayMessage(senderName, message, isOwnMessage) {
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${isOwnMessage ? 'outgoing' : 'incoming'}`;
    messageDiv.dataset.timestamp = new Date().toISOString();
    
    const senderDiv = document.createElement("h4");
    senderDiv.textContent = senderName;
    
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-message";
    deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
    deleteBtn.onclick = () => deleteMessage(messageDiv);
    
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-content';
    
    if (typeof message === 'string') {
        if (message.includes('<audio') || message.includes('<a') || message.includes('<div class="file-message"')) {
            contentWrapper.innerHTML = message;
        } else {
            const messageContent = document.createElement("p");
            messageContent.textContent = message;
            contentWrapper.appendChild(messageContent);
        }
    }
    
    const timestamp = document.createElement("span");
    timestamp.className = "message-timestamp";
    timestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageDiv.appendChild(senderDiv);
    messageDiv.appendChild(deleteBtn);
    messageDiv.appendChild(contentWrapper);
    messageDiv.appendChild(timestamp);
    
    messageArea.appendChild(messageDiv);
    messageArea.scrollTop = messageArea.scrollHeight;
}

// Setup initial connection
setupConnection();

// Add this function
function updateSendButtonState() {
    const message = messageInput.value.trim();
    const isConnected = dataChannel?.readyState === "open" || receiveChannel?.readyState === "open";
    
    // Disable button if no message or no connection
    sendButton.disabled = !message || !isConnected;
    sendButton.style.opacity = (message && isConnected) ? '1' : '0.5';
}

// Add these event listeners at the bottom of the file
messageInput.addEventListener('input', updateSendButtonState);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !sendButton.disabled) {
        e.preventDefault();
        sendMessage();
    }
});

// Add click event listener to send button
sendButton.addEventListener('click', () => {
    if (!sendButton.disabled) {
        sendMessage();
    }
});

// Add these functions for file handling
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!Validator.file(file)) {
        alert('Invalid file type or size. Please check the file and try again.');
        return;
    }
    if (file) {
        const reader = new FileReader();
        reader.onload = () => {
            const base64Data = btoa(
                new Uint8Array(reader.result)
                    .reduce((data, byte) => data + String.fromCharCode(byte), '')
            );

            const fileData = {
                name: file.name,
                type: file.type,
                size: file.size,
                content: base64Data
            };

            const channel = dataChannel?.readyState === "open" ? dataChannel : receiveChannel;
            if (channel) {
                channel.send(JSON.stringify({ 
                    type: "file", 
                    file: fileData 
                }));
                // Create preview for sender - Add true for isOwnMessage
                const url = URL.createObjectURL(file);
                const previewHtml = createFilePreview(fileData, url);
                displayMessage(currentUser.username, previewHtml, true); // Add true here
            }
        };
        reader.readAsArrayBuffer(file);
    }
}

function handleFileMessage(file, isFromPeer = true) {
    try {
        const binaryString = atob(file.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        const blob = new Blob([bytes], { type: file.type });
        const url = URL.createObjectURL(blob);
        
        const previewHtml = createFilePreview(file, url);
        // Display message with correct alignment based on sender
        displayMessage(isFromPeer ? "Peer" : currentUser.username, previewHtml, !isFromPeer);
    } catch (error) {
        console.error('Error handling file:', error);
        displayMessage(isFromPeer ? "Peer" : currentUser.username, `Error displaying file: ${file.name}`, !isFromPeer);
    }
}

function createFilePreview(file, url) {
    const isImage = file.type.startsWith('image/');
    const isPDF = file.type === 'application/pdf';
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');
    
    let previewHtml = `<div class="file-message">`;
    
    // Add preview based on file type
    if (isImage) {
        previewHtml += `
            <div class="preview-container">
                <img src="${url}" alt="${file.name}" class="file-preview">
            </div>`;
    } else if (isPDF) {
        previewHtml += `
            <div class="preview-container">
                <iframe src="${url}" class="pdf-preview"></iframe>
            </div>`;
    } else if (isVideo) {
        previewHtml += `
            <div class="preview-container video-container">
                <video src="${url}" controls preload="metadata" class="video-preview">
                    Your browser does not support video playback.
                </video>
            </div>`;
    } else if (isAudio) {
        previewHtml += `
            <div class="preview-container">
                <audio src="${url}" controls></audio>
            </div>`;
    } else {
        previewHtml += `
            <div class="file-icon">
                <i class="fas fa-file"></i>
            </div>`;
    }
    
    // Add file info and actions
    previewHtml += `
        <div class="file-info">
            <span class="file-name">${file.name}</span>
            <span class="file-size">${formatFileSize(file.size)}</span>
        </div>
        <div class="file-actions">
            <button onclick="previewFile('${url}', '${file.type}')" class="preview-btn">
                <i class="fas fa-eye"></i> Preview
            </button>
            <a href="${url}" download="${file.name}" class="download-btn">
                <i class="fas fa-download"></i> Download
            </a>
        </div>
    </div>`;
    
    return previewHtml;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Add delete message functionality
function deleteMessage(messageElement) {
    const timestamp = messageElement.dataset.timestamp;
    const channel = dataChannel?.readyState === "open" ? dataChannel : receiveChannel;
    
    if (channel) {
        // Send delete request to peer
        channel.send(JSON.stringify({
            type: 'delete_message',
            timestamp: timestamp
        }));
    }
    
    // Remove message locally
    messageElement.remove();
    
    // Clean up any blob URLs to prevent memory leaks
    const mediaElements = messageElement.querySelectorAll('audio, video, img');
    mediaElements.forEach(element => {
        if (element.src && element.src.startsWith('blob:')) {
            URL.revokeObjectURL(element.src);
        }
    });
}

// Add these functions for voice recording
function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

function startRecording() {
    navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
            mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus',
                audioBitsPerSecond: 128000
            });
            
            audioChunks = [];
            mediaRecorder.addEventListener("dataavailable", (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            });

            mediaRecorder.addEventListener("stop", async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
                const arrayBuffer = await audioBlob.arrayBuffer();
                const base64Data = btoa(
                    new Uint8Array(arrayBuffer)
                        .reduce((data, byte) => data + String.fromCharCode(byte), '')
                );

                const channel = dataChannel?.readyState === "open" ? dataChannel : receiveChannel;
                if (channel) {
                    channel.send(JSON.stringify({ 
                        type: "voice", 
                        audio: base64Data 
                    }));
                    
                    const audioUrl = URL.createObjectURL(audioBlob);
                    displayMessage(currentUser.username, `<audio controls src="${audioUrl}"></audio>`, true); // Add true here
                }

                stream.getTracks().forEach(track => track.stop());
            });

            mediaRecorder.start(100);
            isRecording = true;
            const voiceButton = document.getElementById('voiceButton');
            voiceButton.innerHTML = '<i class="fas fa-stop"></i>';
            voiceButton.classList.add('recording');
        })
        .catch(error => {
            console.error("Error accessing microphone:", error);
            alert("Error accessing microphone. Please ensure microphone permissions are granted.");
        });
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
        isRecording = false;
        const voiceButton = document.getElementById('voiceButton');
        voiceButton.innerHTML = '<i class="fas fa-microphone"></i>';
        voiceButton.classList.remove('recording');
    }
}

function handleVoiceMessage(audio, isFromPeer = true) {
    try {
        const binaryString = atob(audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        const audioBlob = new Blob([bytes], { type: 'audio/webm;codecs=opus' });
        const url = URL.createObjectURL(audioBlob);
        displayMessage(isFromPeer ? "Peer" : currentUser.username, `<audio controls src="${url}"></audio>`, !isFromPeer);
    } catch (error) {
        console.error("Error handling voice message:", error);
        displayMessage(isFromPeer ? "Peer" : currentUser.username, "Error playing voice message", !isFromPeer);
    }
}

// Add event listeners at the bottom of the file
document.getElementById('attachButton').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true; // Allow multiple file selection
    input.accept = '*/*'; // Accept all file types
    input.style.display = 'none';
    input.onchange = handleMultipleFiles;
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
});

document.getElementById('voiceButton').addEventListener('click', toggleRecording);

// Add emoji picker functionality
document.querySelector('.emoji-btn').addEventListener('click', () => {
    const picker = document.querySelector('.emoji-picker-container');
    picker.classList.toggle('active');
});

document.querySelector('emoji-picker')?.addEventListener('emoji-click', event => {
    const emoji = event.detail.unicode;
    const cursorPosition = messageInput.selectionStart;
    const textBeforeCursor = messageInput.value.substring(0, cursorPosition);
    const textAfterCursor = messageInput.value.substring(cursorPosition);
    
    messageInput.value = textBeforeCursor + emoji + textAfterCursor;
    messageInput.selectionStart = cursorPosition + emoji.length;
    messageInput.selectionEnd = cursorPosition + emoji.length;
    messageInput.focus();
    
    document.querySelector('.emoji-picker-container').classList.remove('active');
    updateSendButtonState();
});

// Function to update active users in sidebar
function updateActiveUsers() {
    const activeUsersDiv = document.querySelector('.active-users');
    activeUsersDiv.innerHTML = '';

    // Add current user first
    if (currentUser) {
        const userDiv = createUserListItem(currentUser.username, 'Online (You)');
        activeUsersDiv.appendChild(userDiv);
    }

    // Add other connected users
    connectedUsers.forEach((user) => {
        if (user.username !== currentUser?.username) {
            const userDiv = createUserListItem(user.username, user.status);
            activeUsersDiv.appendChild(userDiv);
        }
    });

    updateConnectionStatus();
}

function createUserListItem(username, status) {
    const userDiv = document.createElement('div');
    userDiv.className = 'user-item';
    userDiv.innerHTML = `
        <div class="user-avatar">${username.charAt(0).toUpperCase()}</div>
        <div class="user-info">
            <p class="user-name">${username}</p>
            <p class="user-status">${status}</p>
        </div>
    `;
    return userDiv;
}

// Function to update connection status
function updateConnectionStatus() {
    const statusDiv = document.querySelector('.connection-info');
    const isConnected = dataChannel?.readyState === 'open' || receiveChannel?.readyState === 'open';
    
    statusDiv.innerHTML = `
        <span class="status-indicator ${isConnected ? 'status-connected' : 'status-disconnected'}"></span>
        ${isConnected ? 'Connected' : 'Waiting for connection...'}
    `;

    // Update send button state when connection status changes
    updateSendButtonState();
}

// Add these event listeners
dataChannel?.addEventListener('open', updateActiveUsers);
dataChannel?.addEventListener('close', updateActiveUsers);
receiveChannel?.addEventListener('open', updateActiveUsers);
receiveChannel?.addEventListener('close', updateActiveUsers);

// Call initially
updateActiveUsers();
updateSendButtonState();

// Add this function to initialize encryption
async function initializeEncryption() {
    try {
        myKeyPair = await Encryption.generateKeyPair();
        console.log('Encryption initialized');
        // Send public key when encryption is initialized
        if (dataChannel?.readyState === "open" || receiveChannel?.readyState === "open") {
            sendPublicKey();
        }
    } catch (error) {
        console.error('Error initializing encryption:', error);
    }
}

// Add function to send public key
async function sendPublicKey() {
    try {
        const publicKeyStr = await Encryption.exportPublicKey(myKeyPair.publicKey);
        const channel = dataChannel?.readyState === "open" ? dataChannel : receiveChannel;
        if (channel) {
            channel.send(JSON.stringify({
                type: 'public_key',
                key: publicKeyStr
            }));
        }
    } catch (error) {
        console.error('Error sending public key:', error);
    }
}

// Add this new function for handling file previews
function previewFile(url, type) {
    const isImage = type.startsWith('image/');
    const isPDF = type === 'application/pdf';
    const isVideo = type.startsWith('video/');
    const isAudio = type.startsWith('audio/');

    // Create modal for preview
    const modal = document.createElement('div');
    modal.className = 'preview-modal';
    
    let content = '';
    
    if (isImage) {
        content = `<img src="${url}" alt="Preview">`;
    } else if (isPDF) {
        content = `<iframe src="${url}" width="100%" height="100%"></iframe>`;
    } else if (isVideo) {
        content = `<video src="${url}" controls></video>`;
    } else if (isAudio) {
        content = `<audio src="${url}" controls></audio>`;
    } else {
        window.open(url, '_blank');
        return;
    }
    
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close-modal">&times;</span>
            <div class="preview-content">
                ${content}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close modal functionality
    modal.querySelector('.close-modal').onclick = () => {
        document.body.removeChild(modal);
    };
    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    };
}

// Add new function to handle multiple files
async function handleMultipleFiles(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    // Show progress indicator
    const progressDiv = document.createElement('div');
    progressDiv.className = 'upload-progress';
    progressDiv.innerHTML = `
        <div class="progress-text">Uploading ${files.length} file(s)...</div>
        <div class="progress-bar">
            <div class="progress-fill"></div>
        </div>
    `;
    messageArea.appendChild(progressDiv);
    messageArea.scrollTop = messageArea.scrollHeight;

    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            await sendFile(file, i + 1, files.length, progressDiv);
        }
    } catch (error) {
        console.error('Error sending files:', error);
        displayMessage("System", "Error sending some files. Please try again.");
    } finally {
        // Remove progress indicator
        progressDiv.remove();
    }
}

// Add function to send individual files
async function sendFile(file, current, total, progressDiv) {
    return new Promise(async (resolve, reject) => {
        try {
            const channel = dataChannel?.readyState === "open" ? dataChannel : receiveChannel;
            if (!channel) {
                throw new Error('No active connection');
            }

            // For files larger than 1MB, use chunked transfer
            if (file.size > 1024 * 1024) {
                try {
                    await sendLargeFile(file, channel, progressDiv, current, total);
                    resolve();
                } catch (error) {
                    throw new Error(`Failed to send large file: ${error.message}`);
                }
                return;
            }

            // Regular file handling for smaller files
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    updateProgress(progressDiv, current, total, file.name);
                    const base64Data = btoa(
                        new Uint8Array(reader.result)
                            .reduce((data, byte) => data + String.fromCharCode(byte), '')
                    );

                    const fileData = {
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        content: base64Data
                    };

                    channel.send(JSON.stringify({ 
                        type: "file", 
                        file: fileData 
                    }));
                    
                    const url = URL.createObjectURL(file);
                    const previewHtml = createFilePreview(fileData, url);
                    displayMessage(currentUser.username, previewHtml, true); // Ensure outgoing files appear on right
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(new Error('Error reading file'));
            reader.readAsArrayBuffer(file);
        } catch (error) {
            reject(error);
        }
    });
}

// Add new function for handling large files
async function sendLargeFile(file, channel, progressDiv, current, total) {
    const fileId = generateFileId();
    const chunks = Math.ceil(file.size / CHUNK_SIZE);
    let sentChunks = 0;

    // Send file metadata first
    channel.send(JSON.stringify({
        type: 'file_start',
        fileId: fileId,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        chunks: chunks
    }));

    // Create and display preview immediately for sender
    const url = URL.createObjectURL(file);
    const previewHtml = createFilePreview({
        name: file.name,
        type: file.type,
        size: file.size
    }, url);
    displayMessage(currentUser.username, previewHtml, true); // Ensure outgoing files appear on right

    // Read and send file in chunks
    for (let i = 0; i < chunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        
        let retries = 0;
        let success = false;

        while (!success && retries < MAX_CHUNK_RETRIES) {
            try {
                await sendChunk(chunk, i, fileId, channel);
                success = true;
                sentChunks++;
                
                // Update progress
                const progress = (sentChunks / chunks) * 100;
                updateProgress(progressDiv, current, total, file.name, progress);
            } catch (error) {
                retries++;
                if (retries === MAX_CHUNK_RETRIES) {
                    throw new Error(`Failed to send chunk ${i} after ${MAX_CHUNK_RETRIES} attempts`);
                }
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            }
        }
    }

    // Send completion message
    channel.send(JSON.stringify({
        type: 'file_end',
        fileId: fileId
    }));
}

// Helper function to send a single chunk
function sendChunk(chunk, index, fileId, channel) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const base64Chunk = btoa(
                    new Uint8Array(reader.result)
                        .reduce((data, byte) => data + String.fromCharCode(byte), '')
                );
                
                channel.send(JSON.stringify({
                    type: 'file_chunk',
                    fileId: fileId,
                    index: index,
                    data: base64Chunk
                }));
                resolve();
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(chunk);
    });
}

// Add these helper functions
function generateFileId() {
    return `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function updateProgress(progressDiv, current, total, fileName, chunkProgress = 100) {
    const progressFill = progressDiv.querySelector('.progress-fill');
    const progressText = progressDiv.querySelector('.progress-text');
    const totalProgress = ((current - 1 + (chunkProgress / 100)) / total) * 100;
    progressFill.style.width = `${totalProgress}%`;
    progressText.textContent = `Uploading file ${current}/${total}: ${fileName} (${Math.round(chunkProgress)}%)`;
}

// Update the channel.onmessage handler to handle chunked files
const fileBuffers = new Map();

// Add this to your existing channel.onmessage handler
channel.onmessage = async (event) => {
    try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
            case 'file_start':
                fileBuffers.set(data.fileId, {
                    chunks: new Array(data.chunks),
                    fileName: data.fileName,
                    fileType: data.fileType,
                    fileSize: data.fileSize,
                    receivedChunks: 0
                });
                break;

            case 'file_chunk':
                const fileBuffer = fileBuffers.get(data.fileId);
                if (fileBuffer) {
                    fileBuffer.chunks[data.index] = data.data;
                    fileBuffer.receivedChunks++;
                }
                break;

            case 'file_end':
                const completedFile = fileBuffers.get(data.fileId);
                if (completedFile && completedFile.receivedChunks === completedFile.chunks.length) {
                    const base64Data = completedFile.chunks.join('');
                    const fileData = {
                        name: completedFile.fileName,
                        type: completedFile.fileType,
                        size: completedFile.fileSize,
                        content: base64Data
                    };
                    handleFileMessage(fileData);
                    fileBuffers.delete(data.fileId);
                }
                break;

            // ... rest of your existing cases
        }
    } catch (error) {
        console.error('Error processing message:', error);
    }
};

// Add logout handling
async function handleLogout() {
    const username = localStorage.getItem('username');
    const sessionData = JSON.parse(localStorage.getItem('activeSession') || '{}');
    
    try {
        await fetch('/auth/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                windowId: sessionData.windowId
            })
        });
        
        localStorage.removeItem('activeSession');
        localStorage.removeItem('username');
        window.location.reload();
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// Add window unload handler
window.addEventListener('unload', () => {
    const username = localStorage.getItem('username');
    const sessionData = JSON.parse(localStorage.getItem('activeSession') || '{}');
    
    if (username && sessionData.windowId) {
        // Use sendBeacon for reliable delivery during page unload
        navigator.sendBeacon('/auth/logout', JSON.stringify({
            username,
            windowId: sessionData.windowId
        }));
    }
});

// Add function to broadcast user status
function broadcastUserStatus(status) {
    const username = localStorage.getItem('username');
    if (username) {
        const channel = dataChannel?.readyState === "open" ? dataChannel : receiveChannel;
        if (channel) {
            channel.send(JSON.stringify({
                type: 'user_status',
                username: username,
                status: status,
                windowId: window.windowId
            }));
        }
    }
}

// Add cleanup on window unload
window.addEventListener('beforeunload', () => {
    if (currentUser) {
        const channel = dataChannel?.readyState === "open" ? dataChannel : receiveChannel;
        if (channel) {
            channel.send(JSON.stringify({
                type: 'user_disconnected',
                user: currentUser
            }));
        }
    }
});



        