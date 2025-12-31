// PartySocket client wrapper for Pointless multiplayer

export class PointlessClient {
  constructor(options = {}) {
    this.socket = null;
    this.roomCode = null;
    this.isHost = options.isHost || false;
    this.handlers = new Map();
    this.connectionPromise = null;
    this.reconnectAttempts = 0;
    this.maxReconnects = 5;
    this.myId = null;
  }

  getHost() {
    // For local development, use the same hostname but port 3000
    // This works for localhost AND local network IPs (e.g., 192.168.x.x)
    const hostname = window.location.hostname;

    // Check if it's a local/private IP or localhost
    if (hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.')) {
      return `${hostname}:3000`;
    }

    // Production: use localtunnel URL (temporary) or deployed server
    return 'moody-bars-boil.loca.lt';
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  }

  async connect(roomCode, options = {}) {
    this.roomCode = roomCode;

    // Build query string
    const params = new URLSearchParams({
      role: this.isHost ? 'host' : 'player',
      name: options.playerName || '',
      language: options.language || 'en'
    });

    // Check for reconnection ID
    const reconnectId = localStorage.getItem(`pointless-${roomCode}-id`);
    if (reconnectId && !this.isHost) {
      params.set('reconnectId', reconnectId);
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${this.getHost()}/party/${roomCode}?${params.toString()}`;

    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
          console.log('Connected to game server');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);

            // Store our ID for reconnection
            if (msg.type === 'STATE_SYNC' && msg.yourId) {
              this.myId = msg.yourId;
              if (!this.isHost) {
                localStorage.setItem(`pointless-${roomCode}-id`, msg.yourId);
              }
            }

            const handler = this.handlers.get(msg.type);
            if (handler) {
              handler(msg);
            }

            // Also call 'message' handler for all messages
            const messageHandler = this.handlers.get('message');
            if (messageHandler) {
              messageHandler(msg);
            }
          } catch (e) {
            console.error('Failed to parse message:', e);
          }
        };

        this.socket.onclose = (event) => {
          console.log('Disconnected from game server', event.code, event.reason);
          const closeHandler = this.handlers.get('close');
          if (closeHandler) {
            closeHandler(event);
          }
          this.attemptReconnect();
        };

        this.socket.onerror = (error) => {
          console.error('WebSocket error:', error);
          const errorHandler = this.handlers.get('error');
          if (errorHandler) {
            errorHandler(error);
          }
          reject(error);
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnects) {
      console.log('Max reconnection attempts reached');
      const reconnectFailedHandler = this.handlers.get('reconnectFailed');
      if (reconnectFailedHandler) {
        reconnectFailedHandler();
      }
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`Attempting reconnection in ${delay}ms (attempt ${this.reconnectAttempts})`);

    const reconnectingHandler = this.handlers.get('reconnecting');
    if (reconnectingHandler) {
      reconnectingHandler(this.reconnectAttempts);
    }

    setTimeout(() => {
      if (this.roomCode) {
        this.connect(this.roomCode, {
          playerName: localStorage.getItem('pointless-player-name') || '',
          language: localStorage.getItem('pointless-language') || 'en'
        }).catch(() => {
          // Will trigger another reconnect attempt via onclose
        });
      }
    }, delay);
  }

  send(type, payload = {}) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, ...payload }));
    } else {
      console.warn('Cannot send message - socket not connected');
    }
  }

  on(type, handler) {
    this.handlers.set(type, handler);
    return () => this.handlers.delete(type);
  }

  off(type) {
    this.handlers.delete(type);
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.roomCode = null;
    this.myId = null;
  }

  get connected() {
    return this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  get playerId() {
    return this.myId;
  }
}
