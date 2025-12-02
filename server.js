const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Game State
let gameState = {
    status: 'WAITING', // WAITING, QUESTION, LEADERBOARD, END
    currentQuestionIndex: -1,
    timeRemaining: 0,
    leaderboard: {} // username -> score
};

let questions = []; // Array of { question, options, answer }
let currentTikTokConnection = null;
let timerInterval = null;

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Send current state to new client
    socket.emit('game:state', {
        status: gameState.status,
        question: questions[gameState.currentQuestionIndex],
        timeRemaining: gameState.timeRemaining,
        leaderboard: getSortedLeaderboard()
    });

    // --- Admin Events ---
    socket.on('admin:connect_tiktok', (username) => {
        connectTikTok(username);
    });

    socket.on('admin:add_question', (questionData) => {
        questions.push(questionData);
        io.emit('admin:questions_updated', questions);
    });

    socket.on('admin:start_game', () => {
        gameState.status = 'WAITING';
        gameState.currentQuestionIndex = -1;
        gameState.leaderboard = {};
        gameState.timeRemaining = 0;
        io.emit('game:state', { status: 'WAITING', leaderboard: {} });
        io.emit('admin:questions_updated', questions);
    });

    socket.on('admin:next_question', () => {
        if (gameState.currentQuestionIndex + 1 < questions.length) {
            startQuestion(gameState.currentQuestionIndex + 1);
        } else {
            endGame();
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

function connectTikTok(username) {
    if (currentTikTokConnection) {
        currentTikTokConnection.disconnect();
    }

    currentTikTokConnection = new WebcastPushConnection(username);

    currentTikTokConnection.connect().then(state => {
        console.info(`Connected to roomId ${state.roomId}`);
        io.emit('tiktok:connected', { username, roomId: state.roomId });
    }).catch(err => {
        console.error('Failed to connect', err);
        io.emit('tiktok:error', err.message);
    });

    currentTikTokConnection.on('chat', data => {
        io.emit('chat', data); // Forward to frontend for display
        checkAnswer(data);
    });

    // Forward other events
    currentTikTokConnection.on('gift', data => io.emit('gift', data));
    currentTikTokConnection.on('like', data => io.emit('like', data));
}

function startQuestion(index) {
    gameState.currentQuestionIndex = index;
    gameState.status = 'QUESTION';
    gameState.timeRemaining = 10;

    const question = questions[index];
    io.emit('game:question', {
        question: question.question,
        options: question.options,
        time: 10
    });

    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
        gameState.timeRemaining--;
        io.emit('game:timer', gameState.timeRemaining);

        if (gameState.timeRemaining <= 0) {
            clearInterval(timerInterval);
            showLeaderboard();
        }
    }, 1000);
}

function showLeaderboard() {
    gameState.status = 'LEADERBOARD';
    io.emit('game:leaderboard', getSortedLeaderboard());
}

function endGame() {
    gameState.status = 'END';
    io.emit('game:end', getSortedLeaderboard());
}

function checkAnswer(data) {
    if (gameState.status !== 'QUESTION') return;

    const currentQ = questions[gameState.currentQuestionIndex];
    if (!currentQ) return;

    const userAnswer = data.comment.trim().toLowerCase();
    const correctAnswer = currentQ.answer.trim().toLowerCase();

    if (userAnswer === correctAnswer) {
        const username = data.uniqueId;
        // Simple scoring: 10 points for correct answer
        // Bonus: could add speed bonus based on timeRemaining
        if (!gameState.leaderboard[username]) {
            gameState.leaderboard[username] = 0;
        }

        // Prevent multiple points for same question? 
        // For simplicity, let's allow spamming or just check if they already answered this Q?
        // Let's just add points for now.
        gameState.leaderboard[username] += 10;
    }
}

function getSortedLeaderboard() {
    return Object.entries(gameState.leaderboard)
        .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
        .slice(0, 10) // Top 10
        .map(([username, score]) => ({ username, score }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
