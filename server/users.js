const fs = require('fs');
const path = require('path');

// Create the server directory if it doesn't exist
const SERVER_DIR = path.join(__dirname);
if (!fs.existsSync(SERVER_DIR)) {
    fs.mkdirSync(SERVER_DIR, { recursive: true });
}

const USERS_FILE = path.join(SERVER_DIR, 'users.json');

// Initialize users file if it doesn't exist
if (!fs.existsSync(USERS_FILE)) {
    const defaultUsers = {
        "admin": "123"
    };
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
        console.log('Created users file with default user at:', USERS_FILE);
    } catch (error) {
        console.error('Error creating users file:', error);
    }
}

function readUsers() {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            return { "admin": "123" };
        }
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data) || { "admin": "123" };
    } catch (error) {
        console.error('Error reading users file:', error);
        return { "admin": "123" };
    }
}

function writeUsers(users) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        console.log('Users file updated successfully');
    } catch (error) {
        console.error('Error writing users file:', error);
        throw new Error('Failed to save user data');
    }
}

function addUser(username, password) {
    console.log('Adding user:', username); // Debug log
    
    if (!username || !password) {
        throw new Error('Username and password are required');
    }
    
    const users = readUsers();
    console.log('Current users:', users); // Debug log
    
    if (users[username]) {
        throw new Error('Username already exists');
    }
    
    users[username] = password;
    writeUsers(users);
    console.log('User added successfully'); // Debug log
}

const activeUsers = new Map(); // Store active user sessions

function isUserActive(username) {
    const session = activeUsers.get(username);
    if (!session) return false;
    
    // Check if the session is still valid (24 hours)
    const now = new Date().getTime();
    if (now - session.timestamp > 24 * 60 * 60 * 1000) {
        activeUsers.delete(username);
        return false;
    }
    return true;
}

function manageUserSession(username, windowId) {
    if (isUserActive(username)) {
        return false;
    }
    
    activeUsers.set(username, {
        windowId,
        timestamp: new Date().getTime()
    });
    return true;
}

function removeUserSession(username, windowId) {
    const session = activeUsers.get(username);
    if (session && session.windowId === windowId) {
        activeUsers.delete(username);
        return true;
    }
    return false;
}

// Add a cleanup function for expired sessions
function cleanupSessions() {
    const now = new Date().getTime();
    for (const [username, session] of activeUsers.entries()) {
        if (now - session.timestamp > 24 * 60 * 60 * 1000) {
            activeUsers.delete(username);
        }
    }
}

// Run cleanup every hour
setInterval(cleanupSessions, 60 * 60 * 1000);

// Update the verifyUser function
async function verifyUser(username, password, windowId) {
    console.log('Verifying user:', username);
    
    if (!username || !password || !windowId) {
        return { success: false, error: 'Missing required information' };
    }
    
    // Clean up any expired sessions first
    cleanupSessions();
    
    const users = readUsers();
    const isValid = users[username] === password;
    
    if (isValid) {
        // Check if user is already active
        if (isUserActive(username)) {
            return { 
                success: false, 
                error: 'This account is already logged in on another window. Please log out from other sessions first.'
            };
        }
        
        // Register new session
        if (manageUserSession(username, windowId)) {
            return { success: true };
        } else {
            return { 
                success: false, 
                error: 'Failed to create session. Please try again.'
            };
        }
    }
    
    return { success: false, error: 'Invalid credentials' };
}

module.exports = {
    addUser,
    verifyUser,
    removeUserSession
}; 