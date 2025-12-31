import type * as Party from "partykit/server";

// Game state interfaces
interface Player {
  id: string;
  name: string;
  score: number;
  roundScores: number[];
  eliminated: boolean;
  eliminatedRound: number | null;
  connected: boolean;
  language: 'en' | 'pl';
  typing: boolean;
  submittedAnswer: string | null;
}

interface GameSettings {
  totalRounds: number;
  timerEnabled: boolean;
  timerDuration: number;
  gameMode: 'party' | 'tv-show';
}

interface Category {
  id: string;
  prompt: string;
  question?: string;
  type?: 'standard' | 'anagram' | 'picture' | 'missing_word';
  answers: Answer[];
  translations?: { [lang: string]: { prompt?: string; question?: string } };
}

interface Answer {
  text: string;
  points: number;
  aliases?: string[];
  translations?: { [lang: string]: { text?: string } };
}

interface GameState {
  code: string;
  phase: 'lobby' | 'playing' | 'revealing' | 'roundEnd' | 'gameOver';
  hostId: string | null;
  players: Map<string, Player>;
  playerOrder: string[]; // Order of player IDs for turns
  settings: GameSettings;
  pack: { title: string; categories: Category[] } | null;
  currentRound: number;
  currentPlayerIndex: number;
  currentCategory: Category | null;
  roundCategories: Category[];
  usedAnswersThisRound: Set<string>;
  answerBoardEntries: Array<{ playerId: string; playerName: string; answer: string; score: number; isCorrect: boolean }>;
  timerRemaining: number | null;
  jackpot: number;
}

// Message types
type HostMessage =
  | { type: 'CREATE_GAME'; pack: GameState['pack']; settings: GameSettings }
  | { type: 'START_GAME' }
  | { type: 'NEXT_PLAYER' }
  | { type: 'NEXT_ROUND' }
  | { type: 'REVEAL_ANSWER'; playerId: string }
  | { type: 'UNDO' }
  | { type: 'KICK_PLAYER'; playerId: string };

type PlayerMessage =
  | { type: 'JOIN_GAME'; name: string; language: 'en' | 'pl' }
  | { type: 'SUBMIT_ANSWER'; answer: string }
  | { type: 'TYPING'; isTyping: boolean }
  | { type: 'PASS' }
  | { type: 'SET_LANGUAGE'; language: 'en' | 'pl' };

type ServerMessage =
  | { type: 'STATE_SYNC'; state: ClientGameState; yourId: string }
  | { type: 'GAME_CREATED'; code: string }
  | { type: 'PLAYER_JOINED'; player: ClientPlayer }
  | { type: 'PLAYER_LEFT'; playerId: string }
  | { type: 'PLAYER_TYPING'; playerId: string; isTyping: boolean }
  | { type: 'ANSWER_SUBMITTED'; playerId: string }
  | { type: 'TURN_START'; playerId: string; playerName: string; timerDuration: number | null }
  | { type: 'SCORE_REVEAL'; playerId: string; playerName: string; answer: string; score: number; isCorrect: boolean; isPointless: boolean }
  | { type: 'ROUND_END'; standings: ClientPlayer[]; eliminatedPlayerId?: string }
  | { type: 'GAME_END'; winner: ClientPlayer; standings: ClientPlayer[] }
  | { type: 'ERROR'; message: string };

// Client-safe versions (no answer data exposed)
interface ClientPlayer {
  id: string;
  name: string;
  score: number;
  roundScores: number[];
  eliminated: boolean;
  connected: boolean;
  language: 'en' | 'pl';
  typing: boolean;
  hasSubmitted: boolean;
}

interface ClientCategory {
  prompt: string;
  question?: string;
  type?: string;
  translations?: { [lang: string]: { prompt?: string; question?: string } };
}

interface ClientGameState {
  code: string;
  phase: GameState['phase'];
  players: ClientPlayer[];
  playerOrder: string[];
  settings: GameSettings;
  packTitle: string | null;
  currentRound: number;
  totalRounds: number;
  currentPlayerIndex: number;
  currentPlayerId: string | null;
  currentCategory: ClientCategory | null;
  answerBoardEntries: GameState['answerBoardEntries'];
  timerRemaining: number | null;
  jackpot: number;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default class PointlessServer implements Party.Server {
  state: GameState;
  timerInterval: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {
    this.state = this.createInitialState();
  }

  createInitialState(): GameState {
    return {
      code: this.room.id,
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

  async onStart() {
    const stored = await this.room.storage.get<string>('state');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        this.state = {
          ...parsed,
          players: new Map(parsed.players),
          usedAnswersThisRound: new Set(parsed.usedAnswersThisRound)
        };
      } catch (e) {
        console.error('Failed to restore state:', e);
      }
    }
  }

  async onConnect(connection: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const role = url.searchParams.get('role');
    const name = url.searchParams.get('name') || 'Player';
    const language = (url.searchParams.get('language') as 'en' | 'pl') || 'en';
    const reconnectId = url.searchParams.get('reconnectId');

    // Handle reconnection
    if (reconnectId && this.state.players.has(reconnectId)) {
      const existingPlayer = this.state.players.get(reconnectId)!;
      existingPlayer.connected = true;
      // Update connection mapping
      this.state.players.delete(reconnectId);
      this.state.players.set(connection.id, existingPlayer);
      // Update player order
      const orderIndex = this.state.playerOrder.indexOf(reconnectId);
      if (orderIndex !== -1) {
        this.state.playerOrder[orderIndex] = connection.id;
      }
      this.sendToConnection(connection, {
        type: 'STATE_SYNC',
        state: this.getClientState(),
        yourId: connection.id
      });
      this.broadcastState();
      return;
    }

    if (role === 'host') {
      this.state.hostId = connection.id;
      this.sendToConnection(connection, {
        type: 'GAME_CREATED',
        code: this.state.code
      });
    } else {
      // Player joining
      const player: Player = {
        id: connection.id,
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
      this.state.players.set(connection.id, player);
      this.state.playerOrder.push(connection.id);

      // Notify all clients
      this.broadcast({
        type: 'PLAYER_JOINED',
        player: this.toClientPlayer(player)
      });
    }

    // Send current state to new connection
    this.sendToConnection(connection, {
      type: 'STATE_SYNC',
      state: this.getClientState(),
      yourId: connection.id
    });

    await this.persistState();
  }

  async onMessage(message: string, sender: Party.Connection) {
    try {
      const msg = JSON.parse(message) as HostMessage | PlayerMessage;
      await this.handleMessage(msg, sender);
    } catch (e) {
      console.error('Message handling error:', e);
      this.sendToConnection(sender, {
        type: 'ERROR',
        message: 'Invalid message format'
      });
    }
  }

  async handleMessage(msg: HostMessage | PlayerMessage, sender: Party.Connection) {
    const isHost = sender.id === this.state.hostId;

    switch (msg.type) {
      case 'CREATE_GAME':
        if (isHost) {
          this.state.pack = msg.pack;
          this.state.settings = msg.settings;
          await this.persistState();
          this.broadcastState();
        }
        break;

      case 'START_GAME':
        if (isHost && this.state.phase === 'lobby' && this.state.players.size >= 1) {
          this.startGame();
        }
        break;

      case 'JOIN_GAME':
        // Already handled in onConnect, but can update name/language
        const joiningPlayer = this.state.players.get(sender.id);
        if (joiningPlayer) {
          joiningPlayer.name = msg.name;
          joiningPlayer.language = msg.language;
          this.broadcastState();
        }
        break;

      case 'SUBMIT_ANSWER':
        await this.handleAnswerSubmission(sender.id, msg.answer);
        break;

      case 'TYPING':
        const typingPlayer = this.state.players.get(sender.id);
        if (typingPlayer) {
          typingPlayer.typing = msg.isTyping;
          this.broadcast({
            type: 'PLAYER_TYPING',
            playerId: sender.id,
            isTyping: msg.isTyping
          });
        }
        break;

      case 'PASS':
        await this.handleAnswerSubmission(sender.id, null);
        break;

      case 'NEXT_PLAYER':
        if (isHost) {
          this.nextPlayer();
        }
        break;

      case 'NEXT_ROUND':
        if (isHost) {
          this.nextRound();
        }
        break;

      case 'SET_LANGUAGE':
        const langPlayer = this.state.players.get(sender.id);
        if (langPlayer) {
          langPlayer.language = msg.language;
          this.broadcastState();
        }
        break;

      case 'KICK_PLAYER':
        if (isHost && msg.playerId !== this.state.hostId) {
          this.state.players.delete(msg.playerId);
          this.state.playerOrder = this.state.playerOrder.filter(id => id !== msg.playerId);
          this.broadcast({ type: 'PLAYER_LEFT', playerId: msg.playerId });
          this.broadcastState();
        }
        break;
    }
  }

  startGame() {
    if (!this.state.pack || this.state.pack.categories.length === 0) {
      return;
    }

    // Select random categories for rounds
    const shuffled = [...this.state.pack.categories].sort(() => Math.random() - 0.5);
    this.state.roundCategories = shuffled.slice(0, this.state.settings.totalRounds);

    this.state.phase = 'playing';
    this.state.currentRound = 1;
    this.state.currentPlayerIndex = 0;
    this.state.jackpot = 1000;

    // Initialize player round scores
    for (const player of this.state.players.values()) {
      player.score = 0;
      player.roundScores = [];
      player.eliminated = false;
      player.eliminatedRound = null;
    }

    this.startRound();
  }

  startRound() {
    this.state.currentCategory = this.state.roundCategories[this.state.currentRound - 1];
    this.state.usedAnswersThisRound = new Set();
    this.state.answerBoardEntries = [];
    this.state.currentPlayerIndex = 0;

    // Reset player states for new round
    for (const player of this.state.players.values()) {
      player.typing = false;
      player.submittedAnswer = null;
    }

    this.broadcastState();
    this.startPlayerTurn();
  }

  startPlayerTurn() {
    const currentPlayerId = this.getCurrentPlayerId();
    if (!currentPlayerId) return;

    const player = this.state.players.get(currentPlayerId);
    if (!player) return;

    // Skip eliminated players
    if (player.eliminated) {
      this.state.currentPlayerIndex++;
      if (this.state.currentPlayerIndex < this.state.playerOrder.length) {
        this.startPlayerTurn();
      } else {
        this.endRound();
      }
      return;
    }

    player.typing = false;
    player.submittedAnswer = null;

    // Start timer if enabled
    if (this.state.settings.timerEnabled) {
      this.state.timerRemaining = this.state.settings.timerDuration;
      this.startTimer();
    }

    this.broadcast({
      type: 'TURN_START',
      playerId: currentPlayerId,
      playerName: player.name,
      timerDuration: this.state.settings.timerEnabled ? this.state.settings.timerDuration : null
    });

    this.broadcastState();
  }

  startTimer() {
    this.clearTimer();
    this.timerInterval = setInterval(() => {
      if (this.state.timerRemaining !== null && this.state.timerRemaining > 0) {
        this.state.timerRemaining--;
        if (this.state.timerRemaining === 0) {
          // Timer expired - auto pass
          const currentPlayerId = this.getCurrentPlayerId();
          if (currentPlayerId) {
            this.handleAnswerSubmission(currentPlayerId, null);
          }
        }
      }
    }, 1000);
  }

  clearTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.state.timerRemaining = null;
  }

  getCurrentPlayerId(): string | null {
    if (this.state.currentPlayerIndex >= this.state.playerOrder.length) {
      return null;
    }
    return this.state.playerOrder[this.state.currentPlayerIndex];
  }

  async handleAnswerSubmission(playerId: string, answer: string | null) {
    const currentPlayerId = this.getCurrentPlayerId();
    if (playerId !== currentPlayerId) {
      return; // Not their turn
    }

    const player = this.state.players.get(playerId);
    if (!player) return;

    this.clearTimer();
    player.typing = false;

    let score = 100;
    let isCorrect = false;
    let displayAnswer = answer || 'PASS';
    let isPointless = false;

    if (answer && this.state.currentCategory) {
      const normalizedInput = normalizeAnswer(answer);

      // Check if already used this round
      if (this.state.usedAnswersThisRound.has(normalizedInput)) {
        score = 100;
        isCorrect = false;
      } else {
        // Find matching answer
        const matchedAnswer = this.findAnswer(normalizedInput);
        if (matchedAnswer) {
          score = matchedAnswer.points;
          isCorrect = true;
          displayAnswer = matchedAnswer.text;
          isPointless = score === 0;
          this.state.usedAnswersThisRound.add(normalizedInput);

          if (isPointless) {
            this.state.jackpot += 250;
          }
        }
      }
    }

    // Update player score
    player.score += score;
    player.roundScores[this.state.currentRound - 1] = (player.roundScores[this.state.currentRound - 1] || 0) + score;
    player.submittedAnswer = displayAnswer;

    // Add to answer board
    this.state.answerBoardEntries.push({
      playerId,
      playerName: player.name,
      answer: displayAnswer,
      score,
      isCorrect
    });

    // Broadcast score reveal
    this.broadcast({
      type: 'SCORE_REVEAL',
      playerId,
      playerName: player.name,
      answer: displayAnswer,
      score,
      isCorrect,
      isPointless
    });

    this.state.phase = 'revealing';
    await this.persistState();
    this.broadcastState();
  }

  findAnswer(normalizedInput: string): Answer | null {
    if (!this.state.currentCategory) return null;

    for (const answer of this.state.currentCategory.answers) {
      if (normalizeAnswer(answer.text) === normalizedInput) {
        return answer;
      }
      if (answer.aliases) {
        for (const alias of answer.aliases) {
          if (normalizeAnswer(alias) === normalizedInput) {
            return answer;
          }
        }
      }
    }
    return null;
  }

  nextPlayer() {
    this.state.phase = 'playing';
    this.state.currentPlayerIndex++;

    // Find next non-eliminated player
    while (
      this.state.currentPlayerIndex < this.state.playerOrder.length &&
      this.state.players.get(this.state.playerOrder[this.state.currentPlayerIndex])?.eliminated
    ) {
      this.state.currentPlayerIndex++;
    }

    if (this.state.currentPlayerIndex >= this.state.playerOrder.length) {
      this.endRound();
    } else {
      this.startPlayerTurn();
    }
  }

  endRound() {
    this.state.phase = 'roundEnd';
    this.clearTimer();

    const activePlayers = Array.from(this.state.players.values()).filter(p => !p.eliminated);
    const standings = activePlayers
      .map(p => this.toClientPlayer(p))
      .sort((a, b) => a.score - b.score);

    let eliminatedPlayerId: string | undefined;

    // TV show mode: eliminate highest scorer this round
    if (this.state.settings.gameMode === 'tv-show' && activePlayers.length > 1) {
      const roundScores = activePlayers.map(p => ({
        player: p,
        roundScore: p.roundScores[this.state.currentRound - 1] || 0
      }));
      roundScores.sort((a, b) => b.roundScore - a.roundScore);

      const eliminated = roundScores[0].player;
      eliminated.eliminated = true;
      eliminated.eliminatedRound = this.state.currentRound;
      eliminatedPlayerId = eliminated.id;
    }

    this.broadcast({
      type: 'ROUND_END',
      standings,
      eliminatedPlayerId
    });

    this.broadcastState();
  }

  nextRound() {
    const activePlayers = Array.from(this.state.players.values()).filter(p => !p.eliminated);

    if (this.state.currentRound >= this.state.settings.totalRounds || activePlayers.length <= 1) {
      this.endGame();
    } else {
      this.state.currentRound++;
      this.startRound();
    }
  }

  endGame() {
    this.state.phase = 'gameOver';
    this.clearTimer();

    const allPlayers = Array.from(this.state.players.values())
      .map(p => this.toClientPlayer(p))
      .sort((a, b) => a.score - b.score);

    const winner = allPlayers[0];

    this.broadcast({
      type: 'GAME_END',
      winner,
      standings: allPlayers
    });

    this.broadcastState();
  }

  async onClose(connection: Party.Connection) {
    const player = this.state.players.get(connection.id);
    if (player) {
      player.connected = false;
      this.broadcast({ type: 'PLAYER_LEFT', playerId: connection.id });
      this.broadcastState();
    }

    if (connection.id === this.state.hostId) {
      // Host disconnected - game pauses but keeps state
      // Could implement host migration here
    }

    await this.persistState();
  }

  toClientPlayer(player: Player): ClientPlayer {
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

  getClientState(): ClientGameState {
    return {
      code: this.state.code,
      phase: this.state.phase,
      players: Array.from(this.state.players.values()).map(p => this.toClientPlayer(p)),
      playerOrder: this.state.playerOrder,
      settings: this.state.settings,
      packTitle: this.state.pack?.title || null,
      currentRound: this.state.currentRound,
      totalRounds: this.state.settings.totalRounds,
      currentPlayerIndex: this.state.currentPlayerIndex,
      currentPlayerId: this.getCurrentPlayerId(),
      currentCategory: this.state.currentCategory ? {
        prompt: this.state.currentCategory.prompt,
        question: this.state.currentCategory.question,
        type: this.state.currentCategory.type,
        translations: this.state.currentCategory.translations
      } : null,
      answerBoardEntries: this.state.answerBoardEntries,
      timerRemaining: this.state.timerRemaining,
      jackpot: this.state.jackpot
    };
  }

  broadcast(message: ServerMessage) {
    const json = JSON.stringify(message);
    for (const connection of this.room.getConnections()) {
      connection.send(json);
    }
  }

  broadcastState() {
    const state = this.getClientState();
    for (const connection of this.room.getConnections()) {
      connection.send(JSON.stringify({
        type: 'STATE_SYNC',
        state,
        yourId: connection.id
      }));
    }
  }

  sendToConnection(connection: Party.Connection, message: ServerMessage) {
    connection.send(JSON.stringify(message));
  }

  async persistState() {
    const serializable = {
      ...this.state,
      players: Array.from(this.state.players.entries()),
      usedAnswersThisRound: Array.from(this.state.usedAnswersThisRound)
    };
    await this.room.storage.put('state', JSON.stringify(serializable));
  }
}
