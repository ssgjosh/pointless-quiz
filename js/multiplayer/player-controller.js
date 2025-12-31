// Player controller for Pointless multiplayer
// Manages a player's connection from their phone

import { PointlessClient } from './client.js';
import { PlayerMessages, ServerMessages, GamePhase } from './messages.js';

export class PlayerController {
  constructor(callbacks = {}) {
    this.client = new PointlessClient({ isHost: false });
    this.callbacks = callbacks;
    this.state = null;
    this.myId = null;
    this.roomCode = null;
    this.playerName = '';
    this.language = localStorage.getItem('pointless-language') || 'en';
  }

  async joinGame(roomCode, playerName) {
    this.roomCode = roomCode.toUpperCase();
    this.playerName = playerName;

    // Store for reconnection
    localStorage.setItem('pointless-player-name', playerName);

    // Set up message handlers
    this.setupHandlers();

    // Connect to the server
    await this.client.connect(this.roomCode, {
      playerName: this.playerName,
      language: this.language
    });

    // Send join message with name and language
    this.client.send(PlayerMessages.JOIN_GAME, {
      name: this.playerName,
      language: this.language
    });

    return this.roomCode;
  }

  setupHandlers() {
    // State synchronization
    this.client.on(ServerMessages.STATE_SYNC, (msg) => {
      this.state = msg.state;
      this.myId = msg.yourId;
      if (this.callbacks.onStateSync) {
        this.callbacks.onStateSync(msg.state, this.myId);
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

    // Turn started
    this.client.on(ServerMessages.TURN_START, (msg) => {
      const isMyTurn = msg.playerId === this.myId;
      if (this.callbacks.onTurnStart) {
        this.callbacks.onTurnStart(msg.playerId, msg.playerName, msg.timerDuration, isMyTurn);
      }
      if (isMyTurn) {
        this.vibrate();
      }
    });

    // Score reveal
    this.client.on(ServerMessages.SCORE_REVEAL, (msg) => {
      const isMyScore = msg.playerId === this.myId;
      if (this.callbacks.onScoreReveal) {
        this.callbacks.onScoreReveal({
          playerId: msg.playerId,
          playerName: msg.playerName,
          answer: msg.answer,
          score: msg.score,
          isCorrect: msg.isCorrect,
          isPointless: msg.isPointless,
          isMyScore
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
      const didIWin = msg.winner.id === this.myId;
      if (this.callbacks.onGameEnd) {
        this.callbacks.onGameEnd(msg.winner, msg.standings, didIWin);
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

  // Player actions
  submitAnswer(answer) {
    this.client.send(PlayerMessages.SUBMIT_ANSWER, { answer });
    this.setTyping(false);
  }

  pass() {
    this.client.send(PlayerMessages.PASS);
    this.setTyping(false);
  }

  setTyping(isTyping) {
    this.client.send(PlayerMessages.TYPING, { isTyping });
  }

  setLanguage(language) {
    this.language = language;
    localStorage.setItem('pointless-language', language);
    this.client.send(PlayerMessages.SET_LANGUAGE, { language });
  }

  disconnect() {
    this.client.disconnect();
  }

  vibrate() {
    if ('vibrate' in navigator) {
      navigator.vibrate(200);
    }
  }

  // Getters
  get connected() {
    return this.client.connected;
  }

  get playerId() {
    return this.myId;
  }

  get currentState() {
    return this.state;
  }

  get isMyTurn() {
    if (!this.state) return false;
    return this.state.currentPlayerId === this.myId;
  }

  get myPlayer() {
    if (!this.state || !this.myId) return null;
    return this.state.players.find(p => p.id === this.myId);
  }

  get myScore() {
    const player = this.myPlayer;
    return player ? player.score : 0;
  }

  get isEliminated() {
    const player = this.myPlayer;
    return player ? player.eliminated : false;
  }

  get currentCategory() {
    if (!this.state || !this.state.currentCategory) return null;

    const category = this.state.currentCategory;

    // Return Polish translation if available and language is set to Polish
    if (this.language === 'pl' && category.translations && category.translations.pl) {
      return {
        prompt: category.translations.pl.prompt || category.prompt,
        question: category.translations.pl.question || category.question,
        type: category.type
      };
    }

    return category;
  }

  get gamePhase() {
    return this.state ? this.state.phase : null;
  }

  get isInLobby() {
    return this.gamePhase === GamePhase.LOBBY;
  }

  get isPlaying() {
    return this.gamePhase === GamePhase.PLAYING || this.gamePhase === GamePhase.REVEALING;
  }

  get isGameOver() {
    return this.gamePhase === GamePhase.GAME_OVER;
  }

  // Get all players sorted by score (lowest first)
  getStandings() {
    if (!this.state) return [];
    return [...this.state.players].sort((a, b) => a.score - b.score);
  }

  // Get current round info
  getRoundInfo() {
    if (!this.state) return { current: 0, total: 0 };
    return {
      current: this.state.currentRound,
      total: this.state.totalRounds
    };
  }
}
