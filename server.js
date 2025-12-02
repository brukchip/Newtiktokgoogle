const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    let tiktokConnection;

    socket.on('join', (username) => {
        if (!username) return;
        
        console.log(`Connecting to TikTok Live: ${username}`);
        
        if (tiktokConnection) {
            tiktokConnection.disconnect();
        }

        tiktokConnection = new WebcastPushConnection(username);

        tiktokConnection.connect().then(state => {
            console.info(`Connected to roomId ${state.roomId}`);
            socket.emit('connected', state);
        }).catch(err => {
            console.error('Failed to connect', err);
            socket.emit('error', err.message);
        });

        tiktokConnection.on('chat', data => socket.emit('chat', data));
        tiktokConnection.on('gift', data => socket.emit('gift', data));
        tiktokConnection.on('member', data => socket.emit('member', data));
        tiktokConnection.on('like', data => socket.emit('like', data));
        tiktokConnection.on('social', data => socket.emit('social', data));
        tiktokConnection.on('roomUser', data => socket.emit('roomUser', data));
        tiktokConnection.on('streamEnd', () => socket.emit('streamEnd'));
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        if (tiktokConnection) {
            tiktokConnection.disconnect();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
