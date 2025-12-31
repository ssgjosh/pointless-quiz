// Message types for Pointless multiplayer communication

// Host -> Server messages
export const HostMessages = {
  CREATE_GAME: 'CREATE_GAME',
  START_GAME: 'START_GAME',
  NEXT_PLAYER: 'NEXT_PLAYER',
  NEXT_ROUND: 'NEXT_ROUND',
  REVEAL_ANSWER: 'REVEAL_ANSWER',
  UNDO: 'UNDO',
  KICK_PLAYER: 'KICK_PLAYER'
};

// Player -> Server messages
export const PlayerMessages = {
  JOIN_GAME: 'JOIN_GAME',
  SUBMIT_ANSWER: 'SUBMIT_ANSWER',
  TYPING: 'TYPING',
  PASS: 'PASS',
  SET_LANGUAGE: 'SET_LANGUAGE'
};

// Server -> Client messages
export const ServerMessages = {
  STATE_SYNC: 'STATE_SYNC',
  GAME_CREATED: 'GAME_CREATED',
  PLAYER_JOINED: 'PLAYER_JOINED',
  PLAYER_LEFT: 'PLAYER_LEFT',
  PLAYER_TYPING: 'PLAYER_TYPING',
  ANSWER_SUBMITTED: 'ANSWER_SUBMITTED',
  TURN_START: 'TURN_START',
  SCORE_REVEAL: 'SCORE_REVEAL',
  ROUND_END: 'ROUND_END',
  GAME_END: 'GAME_END',
  ERROR: 'ERROR'
};

// Game phases
export const GamePhase = {
  LOBBY: 'lobby',
  PLAYING: 'playing',
  REVEALING: 'revealing',
  ROUND_END: 'roundEnd',
  GAME_OVER: 'gameOver'
};
