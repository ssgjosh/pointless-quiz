/**
 * Pointless Multiplayer WebSocket Server
 * A simple Node.js WebSocket server for local multiplayer
 */

import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT || 3000;

// Store active game rooms
const rooms = new Map();

// Store player reconnection tokens (playerId -> { roomCode, name, expires })
const reconnectTokens = new Map();
const RECONNECT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes to reconnect

// Generate a 4-character room code
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 4 }, () =>
        chars[Math.floor(Math.random() * chars.length)]
    ).join('');
}

// Normalize answer for matching
function normalizeAnswer(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Create initial game state
function createInitialState(code) {
    return {
        code,
        phase: 'lobby',
        hostId: null,
        players: new Map(),
        playerOrder: [],
        settings: {
            totalRounds: 5,
            timerEnabled: false,
            timerDuration: 30,
            gameMode: 'party'
        },
        pack: null,
        currentRound: 0,
        currentPlayerIndex: 0,
        currentCategory: null,
        roundCategories: [],
        usedAnswersThisRound: new Set(),
        answerBoardEntries: [],
        timerRemaining: null,
        jackpot: 1000
    };
}

// Convert player to client-safe version
function toClientPlayer(player) {
    return {
        id: player.id,
        name: player.name,
        score: player.score,
        roundScores: player.roundScores,
        eliminated: player.eliminated,
        connected: player.connected,
        language: player.language,
        typing: player.typing,
        hasSubmitted: player.submittedAnswer !== null
    };
}

// Get client-safe state
function getClientState(state) {
    return {
        code: state.code,
        phase: state.phase,
        players: Array.from(state.players.values()).map(p => toClientPlayer(p)),
        playerOrder: state.playerOrder,
        settings: state.settings,
        packTitle: state.pack?.title || state.pack?.name || null,
        currentRound: state.currentRound,
        totalRounds: state.settings.totalRounds,
        currentPlayerIndex: state.currentPlayerIndex,
        currentPlayerId: getCurrentPlayerId(state),
        currentCategory: state.currentCategory ? {
            prompt: state.currentCategory.prompt || state.currentCategory.question || state.currentCategory.name,
            question: state.currentCategory.question,
            type: state.currentCategory.type,
            translations: state.currentCategory.translations
        } : null,
        answerBoardEntries: state.answerBoardEntries,
        timerRemaining: state.timerRemaining,
        jackpot: state.jackpot
    };
}

function getCurrentPlayerId(state) {
    if (state.currentPlayerIndex >= state.playerOrder.length) {
        return null;
    }
    return state.playerOrder[state.currentPlayerIndex];
}

// Send error to a single client
function sendError(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ERROR', message }));
    }
}

// Broadcast to all clients in a room
function broadcast(room, message) {
    const json = JSON.stringify(message);
    for (const client of room.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(json);
        }
    }
}

// Broadcast state to all clients
function broadcastState(room) {
    const state = getClientState(room.state);
    for (const client of room.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'STATE_SYNC',
                state,
                yourId: client.playerId
            }));
        }
    }
}

// Find answer in current category
function findAnswer(state, normalizedInput) {
    if (!state.currentCategory || !state.currentCategory.answers) return null;

    for (const answer of state.currentCategory.answers) {
        const answerText = answer.text || answer.answer;
        if (normalizeAnswer(answerText) === normalizedInput) {
            return { text: answerText, points: answer.score || answer.points || 0 };
        }
        if (answer.aliases) {
            for (const alias of answer.aliases) {
                if (normalizeAnswer(alias) === normalizedInput) {
                    return { text: answerText, points: answer.score || answer.points || 0 };
                }
            }
        }
    }
    return null;
}

// Start the game
function startGame(room) {
    const state = room.state;
    if (!state.pack || !state.pack.categories || state.pack.categories.length === 0) {
        return;
    }

    // Clamp totalRounds to available categories
    const availableCategories = state.pack.categories.length;
    if (state.settings.totalRounds > availableCategories) {
        state.settings.totalRounds = availableCategories;
        console.log(`Clamped rounds to ${availableCategories} (available categories)`);
    }

    // Select random categories for rounds
    const shuffled = [...state.pack.categories].sort(() => Math.random() - 0.5);
    state.roundCategories = shuffled.slice(0, state.settings.totalRounds);

    state.phase = 'playing';
    state.currentRound = 1;
    state.currentPlayerIndex = 0;
    state.jackpot = 1000;

    // Initialize player round scores
    for (const player of state.players.values()) {
        player.score = 0;
        player.roundScores = [];
        player.eliminated = false;
        player.eliminatedRound = null;
    }

    startRound(room);
}

// Start a round
function startRound(room) {
    const state = room.state;
    state.currentCategory = state.roundCategories[state.currentRound - 1];
    state.usedAnswersThisRound = new Set();
    state.answerBoardEntries = [];
    state.currentPlayerIndex = 0;

    // Reset player states for new round
    for (const player of state.players.values()) {
        player.typing = false;
        player.submittedAnswer = null;
    }

    broadcastState(room);
    startPlayerTurn(room);
}

// Clear any existing turn timer
function clearTurnTimer(room) {
    if (room.turnTimer) {
        clearTimeout(room.turnTimer);
        room.turnTimer = null;
    }
}

// Start a player's turn
function startPlayerTurn(room) {
    const state = room.state;
    clearTurnTimer(room);

    const currentPlayerId = getCurrentPlayerId(state);
    if (!currentPlayerId) return;

    const player = state.players.get(currentPlayerId);
    if (!player) return;

    // Skip eliminated or disconnected players
    if (player.eliminated || !player.connected) {
        state.currentPlayerIndex++;
        if (state.currentPlayerIndex < state.playerOrder.length) {
            startPlayerTurn(room);
        } else {
            endRound(room);
        }
        return;
    }

    player.typing = false;
    player.submittedAnswer = null;

    const timerDuration = state.settings.timerEnabled ? state.settings.timerDuration : null;

    broadcast(room, {
        type: 'TURN_START',
        playerId: currentPlayerId,
        playerName: player.name,
        timerDuration
    });

    broadcastState(room);

    // Server-side timer: auto-pass if timer expires
    if (timerDuration) {
        room.turnTimer = setTimeout(() => {
            // Double-check player is still current and hasn't submitted
            if (getCurrentPlayerId(state) === currentPlayerId && !player.submittedAnswer) {
                console.log(`Timer expired for ${player.name}, auto-passing`);
                handleAnswerSubmission(room, currentPlayerId, null);
            }
        }, (timerDuration + 2) * 1000); // +2 seconds grace period
    }
}

// Handle answer submission
function handleAnswerSubmission(room, playerId, answer) {
    const state = room.state;
    clearTurnTimer(room);

    const currentPlayerId = getCurrentPlayerId(state);
    if (playerId !== currentPlayerId) {
        return;
    }

    const player = state.players.get(playerId);
    if (!player) return;

    player.typing = false;

    let score = 100;
    let isCorrect = false;
    let displayAnswer = answer || 'PASS';
    let isPointless = false;

    if (answer) {
        const normalizedInput = normalizeAnswer(answer);

        // Check if already used this round
        if (state.usedAnswersThisRound.has(normalizedInput)) {
            score = 100;
            isCorrect = false;
        } else {
            // Find matching answer
            const matchedAnswer = findAnswer(state, normalizedInput);
            if (matchedAnswer) {
                score = matchedAnswer.points;
                isCorrect = true;
                displayAnswer = matchedAnswer.text;
                isPointless = score === 0;
                state.usedAnswersThisRound.add(normalizedInput);

                if (isPointless) {
                    state.jackpot += 250;
                }
            }
        }
    }

    // Update player score
    player.score += score;
    if (!player.roundScores[state.currentRound - 1]) {
        player.roundScores[state.currentRound - 1] = 0;
    }
    player.roundScores[state.currentRound - 1] += score;
    player.submittedAnswer = displayAnswer;

    // Add to answer board
    state.answerBoardEntries.push({
        playerId,
        playerName: player.name,
        answer: displayAnswer,
        score,
        isCorrect
    });

    // Broadcast score reveal
    broadcast(room, {
        type: 'SCORE_REVEAL',
        playerId,
        playerName: player.name,
        answer: displayAnswer,
        score,
        isCorrect,
        isPointless
    });

    state.phase = 'revealing';
    broadcastState(room);
}

// Move to next player
function nextPlayer(room) {
    const state = room.state;
    state.phase = 'playing';
    state.currentPlayerIndex++;

    // Find next non-eliminated player
    while (
        state.currentPlayerIndex < state.playerOrder.length &&
        state.players.get(state.playerOrder[state.currentPlayerIndex])?.eliminated
    ) {
        state.currentPlayerIndex++;
    }

    if (state.currentPlayerIndex >= state.playerOrder.length) {
        endRound(room);
    } else {
        startPlayerTurn(room);
    }
}

// End the round
function endRound(room) {
    const state = room.state;
    state.phase = 'roundEnd';

    const activePlayers = Array.from(state.players.values()).filter(p => !p.eliminated);
    const standings = activePlayers
        .map(p => toClientPlayer(p))
        .sort((a, b) => a.score - b.score);

    let eliminatedPlayerId;

    // TV show mode: eliminate highest scorer this round
    if (state.settings.gameMode === 'tv-show' && activePlayers.length > 1) {
        const roundScores = activePlayers.map(p => ({
            player: p,
            roundScore: p.roundScores[state.currentRound - 1] || 0
        }));
        roundScores.sort((a, b) => b.roundScore - a.roundScore);

        const eliminated = roundScores[0].player;
        eliminated.eliminated = true;
        eliminated.eliminatedRound = state.currentRound;
        eliminatedPlayerId = eliminated.id;
    }

    broadcast(room, {
        type: 'ROUND_END',
        standings,
        eliminatedPlayerId
    });

    broadcastState(room);
}

// Move to next round
function nextRound(room) {
    const state = room.state;
    const activePlayers = Array.from(state.players.values()).filter(p => !p.eliminated);

    if (state.currentRound >= state.settings.totalRounds || activePlayers.length <= 1) {
        endGame(room);
    } else {
        state.currentRound++;
        startRound(room);
    }
}

// End the game
function endGame(room) {
    const state = room.state;
    state.phase = 'gameOver';

    const allPlayers = Array.from(state.players.values())
        .map(p => toClientPlayer(p))
        .sort((a, b) => a.score - b.score);

    const winner = allPlayers[0];

    broadcast(room, {
        type: 'GAME_END',
        winner,
        standings: allPlayers
    });

    broadcastState(room);
}

// Create WebSocket server - listen on all interfaces so phones can connect
const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

console.log(`🎈 Pointless WebSocket Server running on ws://0.0.0.0:${PORT}`);
console.log(`   Local: ws://localhost:${PORT}`);
console.log(`   Network: ws://192.168.0.194:${PORT}`);
console.log('-------------------------------------------');

wss.on('connection', (ws, req) => {
    // Parse URL for room code and params
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // Expected path: /party/ROOMCODE
    let roomCode = pathParts[1] || '';
    roomCode = roomCode.toUpperCase();

    const role = url.searchParams.get('role');
    const name = url.searchParams.get('name') || 'Player';
    const language = url.searchParams.get('language') || 'en';
    const reconnectId = url.searchParams.get('reconnectId');

    console.log(`New connection: ${role} "${name}" joining room ${roomCode}${reconnectId ? ' (reconnect)' : ''}`);

    // Get or create room based on role
    let room = rooms.get(roomCode);

    // Only hosts can create rooms
    if (role === 'host') {
        // Generate code if not provided
        if (!roomCode) {
            roomCode = generateRoomCode();
        }

        // Create room if it doesn't exist
        if (!room) {
            room = {
                state: createInitialState(roomCode),
                clients: new Set(),
                turnTimer: null
            };
            rooms.set(roomCode, room);
            console.log(`Created new room: ${roomCode}`);
        }

        // Add client to room
        room.clients.add(ws);
        ws.roomCode = roomCode;
        room.state.hostId = ws.playerId = 'host-' + Date.now();

        ws.send(JSON.stringify({
            type: 'GAME_CREATED',
            code: roomCode
        }));
    } else {
        // Player joining - room must exist
        if (!room) {
            console.log(`Room not found: ${roomCode}`);
            sendError(ws, `Room "${roomCode}" not found. Check the code and try again.`);
            ws.close(4004, 'Room not found');
            return;
        }

        // Add client to room
        room.clients.add(ws);
        ws.roomCode = roomCode;

        // Check for reconnection
        let playerId = null;
        let isReconnect = false;

        if (reconnectId) {
            const token = reconnectTokens.get(reconnectId);
            if (token && token.roomCode === roomCode && token.expires > Date.now()) {
                // Valid reconnection token
                const existingPlayer = room.state.players.get(reconnectId);
                if (existingPlayer) {
                    playerId = reconnectId;
                    existingPlayer.connected = true;
                    existingPlayer.name = name || existingPlayer.name;
                    existingPlayer.language = language;
                    isReconnect = true;
                    reconnectTokens.delete(reconnectId);
                    console.log(`Player ${name} reconnected as ${playerId}`);
                }
            }
        }

        if (!playerId) {
            // New player
            playerId = 'player-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

            const player = {
                id: playerId,
                name: name,
                score: 0,
                roundScores: [],
                eliminated: false,
                eliminatedRound: null,
                connected: true,
                language: language,
                typing: false,
                submittedAnswer: null
            };
            room.state.players.set(playerId, player);
            room.state.playerOrder.push(playerId);
        }

        ws.playerId = playerId;

        // Notify all clients
        const player = room.state.players.get(playerId);
        broadcast(room, {
            type: 'PLAYER_JOINED',
            player: toClientPlayer(player),
            isReconnect
        });
    }

    // Send current state
    ws.send(JSON.stringify({
        type: 'STATE_SYNC',
        state: getClientState(room.state),
        yourId: ws.playerId
    }));

    // Handle messages
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            const isHost = ws.playerId === room.state.hostId;

            switch (msg.type) {
                case 'CREATE_GAME':
                    if (isHost) {
                        room.state.pack = msg.pack;
                        room.state.settings = { ...room.state.settings, ...msg.settings };
                        broadcastState(room);
                    }
                    break;

                case 'START_GAME':
                    if (isHost && room.state.phase === 'lobby' && room.state.players.size >= 1) {
                        startGame(room);
                    }
                    break;

                case 'JOIN_GAME':
                    const joiningPlayer = room.state.players.get(ws.playerId);
                    if (joiningPlayer) {
                        joiningPlayer.name = msg.name;
                        joiningPlayer.language = msg.language;
                        broadcastState(room);
                    }
                    break;

                case 'SUBMIT_ANSWER':
                    handleAnswerSubmission(room, ws.playerId, msg.answer);
                    break;

                case 'TYPING':
                    const typingPlayer = room.state.players.get(ws.playerId);
                    if (typingPlayer) {
                        typingPlayer.typing = msg.isTyping;
                        broadcast(room, {
                            type: 'PLAYER_TYPING',
                            playerId: ws.playerId,
                            isTyping: msg.isTyping
                        });
                    }
                    break;

                case 'PASS':
                    handleAnswerSubmission(room, ws.playerId, null);
                    break;

                case 'NEXT_PLAYER':
                    if (isHost) {
                        nextPlayer(room);
                    }
                    break;

                case 'NEXT_ROUND':
                    if (isHost) {
                        nextRound(room);
                    }
                    break;

                case 'SET_LANGUAGE':
                    const langPlayer = room.state.players.get(ws.playerId);
                    if (langPlayer) {
                        langPlayer.language = msg.language;
                        broadcastState(room);
                    }
                    break;

                case 'KICK_PLAYER':
                    if (isHost && msg.playerId !== room.state.hostId) {
                        room.state.players.delete(msg.playerId);
                        room.state.playerOrder = room.state.playerOrder.filter(id => id !== msg.playerId);
                        broadcast(room, { type: 'PLAYER_LEFT', playerId: msg.playerId });
                        broadcastState(room);
                    }
                    break;
            }
        } catch (e) {
            console.error('Message handling error:', e);
        }
    });

    // Handle disconnect
    ws.on('close', () => {
        console.log(`Connection closed: ${ws.playerId} from room ${ws.roomCode}`);

        const room = rooms.get(ws.roomCode);
        if (room) {
            room.clients.delete(ws);

            const player = room.state.players.get(ws.playerId);
            if (player) {
                player.connected = false;

                // Store reconnection token so player can rejoin
                reconnectTokens.set(ws.playerId, {
                    roomCode: ws.roomCode,
                    name: player.name,
                    expires: Date.now() + RECONNECT_WINDOW_MS
                });

                broadcast(room, { type: 'PLAYER_LEFT', playerId: ws.playerId });
                broadcastState(room);

                // If this player was the current player and game is in progress, auto-pass
                const state = room.state;
                if (state.phase === 'playing' && getCurrentPlayerId(state) === ws.playerId) {
                    console.log(`Current player ${player.name} disconnected, auto-passing`);
                    handleAnswerSubmission(room, ws.playerId, null);
                }
            }

            // Clean up empty rooms after a delay
            if (room.clients.size === 0) {
                clearTurnTimer(room);
                setTimeout(() => {
                    if (room.clients.size === 0) {
                        rooms.delete(ws.roomCode);
                        console.log(`Deleted empty room: ${ws.roomCode}`);
                    }
                }, 60000);
            }
        }
    });
});

console.log('Waiting for connections...');
