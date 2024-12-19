const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { addUser, verifyUser, removeUserSession } = require('./server/users.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Add body parser middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Create logs directory if it doesn't exist
const LOGS_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const ENCRYPTED_LOG = path.join(LOGS_DIR, 'encrypted_messages.txt');
const DECRYPTED_LOG = path.join(LOGS_DIR, 'decrypted_messages.txt');

// Create log files if they don't exist
[ENCRYPTED_LOG, DECRYPTED_LOG].forEach(file => {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, '');
    }
});

// Function to log messages with timestamp
function logMessage(filePath, message, type) {
    try {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${type}: ${message}\n`;
        
        // Use appendFileSync with proper error handling
        fs.appendFileSync(filePath, logEntry, 'utf8');
        console.log(`Successfully logged ${type} message to ${path.basename(filePath)}`);
    } catch (error) {
        console.error(`Error logging message to ${path.basename(filePath)}:`, error);
        // Attempt to create directory if it doesn't exist
        if (error.code === 'ENOENT') {
            try {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.appendFileSync(filePath, logEntry, 'utf8');
                console.log(`Created log file and logged ${type} message to ${path.basename(filePath)}`);
            } catch (retryError) {
                console.error('Failed to create log file:', retryError);
            }
        }
    }
}

app.post('/auth/signup', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        
        await addUser(username, password);
        res.json({ success: true });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(400).json({ error: error.message || 'Error creating account' });
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { username, password, windowId } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const result = await verifyUser(username, password, windowId);
        if (result.success) {
            res.json({ success: true });
        } else {
            res.status(401).json({ error: result.error });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(400).json({ error: error.message || 'Error logging in' });
    }
});

app.post('/auth/logout', (req, res) => {
    const { username, windowId } = req.body;
    if (username && windowId) {
        removeUserSession(username, windowId);
    }
    res.json({ success: true });
});

io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('signal', (data) => {
        // Log encrypted messages only when they contain encrypted data
        if (data.type === 'encrypted' || data.encrypted) {
            try {
                logMessage(ENCRYPTED_LOG, JSON.stringify(data.data || data), 'ENCRYPTED');
            } catch (error) {
                console.error('Error logging encrypted message:', error);
            }
        }
        socket.broadcast.emit('signal', data);
    });

    socket.on('encrypted_message', (data) => {
        logMessage(ENCRYPTED_LOG, JSON.stringify(data), 'ENCRYPTED');
    });

    socket.on('decrypted_message', (data) => {
        logMessage(DECRYPTED_LOG, data.message, 'DECRYPTED');
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

server.listen(PORT, () => {
    // Ensure log files exist and are writable
    [ENCRYPTED_LOG, DECRYPTED_LOG].forEach(file => {
        try {
            if (!fs.existsSync(file)) {
                fs.writeFileSync(file, '', 'utf8');
                console.log(`Created log file: ${path.basename(file)}`);
            }
            // Test write access
            fs.accessSync(file, fs.constants.W_OK);
            console.log(`Log file ${path.basename(file)} is writable`);
        } catch (error) {
            console.error(`Error with log file ${path.basename(file)}:`, error);
        }
    });
    
    console.log(`Server running on http://localhost:${PORT}`);
});

