// Host controller for Pointless multiplayer
// Manages the host's connection to the game server

import { PointlessClient } from './client.js';
import { HostMessages, ServerMessages } from './messages.js';

export class HostController {
  constructor(callbacks = {}) {
    this.client = new PointlessClient({ isHost: true });
    this.callbacks = callbacks;
    this.state = null;
    this.roomCode = null;
  }

  async createGame(pack, settings) {
    // Generate a room code
    this.roomCode = this.client.generateRoomCode();

    // Set up message handlers before connecting
    this.setupHandlers();

    // Connect to the server
    await this.client.connect(this.roomCode);

    // Send game creation message
    this.client.send(HostMessages.CREATE_GAME, { pack, settings });

    return this.roomCode;
  }

  setupHandlers() {
    // State synchronization
    this.client.on(ServerMessages.STATE_SYNC, (msg) => {
      this.state = msg.state;
      if (this.callbacks.onStateSync) {
        this.callbacks.onStateSync(msg.state);
      }
    });

    // Game created confirmation
    this.client.on(ServerMessages.GAME_CREATED, (msg) => {
      this.roomCode = msg.code;
      if (this.callbacks.onGameCreated) {
        this.callbacks.onGameCreated(msg.code);
      }
    });

    // Player joined
    this.client.on(ServerMessages.PLAYER_JOINED, (msg) => {
      if (this.callbacks.onPlayerJoined) {
        this.callbacks.onPlayerJoined(msg.player);
      }
    });

    // Player left
    this.client.on(ServerMessages.PLAYER_LEFT, (msg) => {
      if (this.callbacks.onPlayerLeft) {
        this.callbacks.onPlayerLeft(msg.playerId);
      }
    });

    // Player typing status
    this.client.on(ServerMessages.PLAYER_TYPING, (msg) => {
      if (this.callbacks.onPlayerTyping) {
        this.callbacks.onPlayerTyping(msg.playerId, msg.isTyping);
      }
    });

    // Turn started
    this.client.on(ServerMessages.TURN_START, (msg) => {
      if (this.callbacks.onTurnStart) {
        this.callbacks.onTurnStart(msg.playerId, msg.playerName, msg.timerDuration);
      }
    });

    // Score reveal
    this.client.on(ServerMessages.SCORE_REVEAL, (msg) => {
      if (this.callbacks.onScoreReveal) {
        this.callbacks.onScoreReveal({
          playerId: msg.playerId,
          playerName: msg.playerName,
          answer: msg.answer,
          score: msg.score,
          isCorrect: msg.isCorrect,
          isPointless: msg.isPointless
        });
      }
    });

    // Round end
    this.client.on(ServerMessages.ROUND_END, (msg) => {
      if (this.callbacks.onRoundEnd) {
        this.callbacks.onRoundEnd(msg.standings, msg.eliminatedPlayerId);
      }
    });

    // Game end
    this.client.on(ServerMessages.GAME_END, (msg) => {
      if (this.callbacks.onGameEnd) {
        this.callbacks.onGameEnd(msg.winner, msg.standings);
      }
    });

    // Error
    this.client.on(ServerMessages.ERROR, (msg) => {
      if (this.callbacks.onError) {
        this.callbacks.onError(msg.message);
      }
    });

    // Connection events
    this.client.on('close', () => {
      if (this.callbacks.onDisconnected) {
        this.callbacks.onDisconnected();
      }
    });

    this.client.on('reconnecting', (attempt) => {
      if (this.callbacks.onReconnecting) {
        this.callbacks.onReconnecting(attempt);
      }
    });

    this.client.on('reconnectFailed', () => {
      if (this.callbacks.onReconnectFailed) {
        this.callbacks.onReconnectFailed();
      }
    });
  }

  // Host actions
  startGame() {
    this.client.send(HostMessages.START_GAME);
  }

  nextPlayer() {
    this.client.send(HostMessages.NEXT_PLAYER);
  }

  nextRound() {
    this.client.send(HostMessages.NEXT_ROUND);
  }

  kickPlayer(playerId) {
    this.client.send(HostMessages.KICK_PLAYER, { playerId });
  }

  disconnect() {
    this.client.disconnect();
  }

  get connected() {
    return this.client.connected;
  }

  get gameCode() {
    return this.roomCode;
  }

  get currentState() {
    return this.state;
  }

  // Get player by ID
  getPlayer(playerId) {
    if (!this.state) return null;
    return this.state.players.find(p => p.id === playerId);
  }

  // Get current player
  getCurrentPlayer() {
    if (!this.state || !this.state.currentPlayerId) return null;
    return this.getPlayer(this.state.currentPlayerId);
  }

  // Get connected players
  getConnectedPlayers() {
    if (!this.state) return [];
    return this.state.players.filter(p => p.connected);
  }

  // Get active (non-eliminated) players
  getActivePlayers() {
    if (!this.state) return [];
    return this.state.players.filter(p => !p.eliminated);
  }
}
