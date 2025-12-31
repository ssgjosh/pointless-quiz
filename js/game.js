/**
 * Pointless Game Engine
 *
 * Main game logic for the TV-friendly quiz game
 * Authentic recreation of the BBC show format
 */

class PointlessGame {
    constructor() {
        // Game state
        this.pack = null;
        this.players = [];
        this.currentPlayerIndex = 0;
        this.currentRound = 1;
        this.totalRounds = 10;
        this.roundCategories = [];
        this.currentCategory = null;
        this.usedAnswersThisRound = new Set();
        this.timerEnabled = false; // Disabled by default like real show
        this.timerInterval = null;
        this.timerRemaining = 30;
        this.reduceMotion = false;
        this.scoreAnimationInterval = null;
        this.answerIndex = [];
        this.answerLookup = new Map();
        this.currentImage = null;

        // Game mode: 'party' (everyone plays all rounds) or 'tv-show' (elimination)
        this.gameMode = 'party';

        // Question type for current category
        this.questionType = 'standard'; // standard | anagram | picture | missing_word

        // History for undo (with answer tracking)
        this.history = [];

        // Answer board - tracks all answers revealed this round
        this.answerBoardEntries = [];

        // Image credits for end screen
        this.imageCredits = [];

        // Jackpot system - like the real show!
        this.jackpot = 1000; // Starts at £1000
        this.pointlessThisGame = 0; // Count of pointless answers

        // Pass tracking for reverse order
        this.currentPass = 1; // 1 = first pass, 2 = second pass (reverse)
        this.passOrder = []; // Order of players for current pass

        // Bind methods
        this.handleKeyboard = this.handleKeyboard.bind(this);

        // Initialize UI
        this.initializeUI();
    }

    /**
     * Initialize UI elements and event listeners
     */
    initializeUI() {
        // Pack selection
        this.loadAvailablePacks();

        // Player management
        this.initializePlayers(2);
        document.getElementById('add-player-btn').addEventListener('click', () => this.addPlayer());
        document.getElementById('remove-player-btn').addEventListener('click', () => this.removePlayer());

        // Game controls
        document.getElementById('start-game-btn').addEventListener('click', () => this.startGame());
        document.getElementById('next-player-btn').addEventListener('click', () => this.nextPlayer());
        document.getElementById('next-round-btn').addEventListener('click', () => this.nextRound());
        document.getElementById('undo-btn').addEventListener('click', () => this.undo());

        // Answer input
        const answerInput = document.getElementById('answer-input');
        answerInput.addEventListener('input', (e) => this.handleAnswerInput(e));
        answerInput.addEventListener('keydown', (e) => this.handleInputKeydown(e));
        document.getElementById('submit-answer-btn').addEventListener('click', () => this.submitAnswer());
        document.getElementById('pass-btn').addEventListener('click', () => this.passAnswer());

        // Audio controls
        document.getElementById('mute-btn').addEventListener('click', () => this.toggleMute());
        document.getElementById('volume-slider').addEventListener('input', (e) => {
            soundManager.setVolume(e.target.value / 100);
        });
        document.getElementById('fullscreen-btn').addEventListener('click', () => this.toggleFullscreen());

        // Results screen
        document.getElementById('play-again-btn').addEventListener('click', () => this.resetGame());
        document.getElementById('credits-btn').addEventListener('click', () => this.showCredits());
        document.getElementById('close-credits').addEventListener('click', () => this.hideCredits());

        // Round results / elimination continue button
        document.getElementById('continue-btn')?.addEventListener('click', () => this.continueFromRoundResults());

        // Image modal
        document.getElementById('image-info-btn')?.addEventListener('click', () => this.showImageInfo());
        document.getElementById('close-image-modal').addEventListener('click', () => this.hideImageInfo());

        // Keyboard shortcuts
        document.addEventListener('keydown', this.handleKeyboard);

        // Close autocomplete when clicking outside input area
        document.addEventListener('click', (e) => {
            const hostArea = document.querySelector('.host-input-area');
            if (hostArea && !hostArea.contains(e.target)) {
                this.hideAutocomplete();
            }
        });

        // Settings
        document.getElementById('reduce-motion').addEventListener('change', (e) => {
            this.reduceMotion = e.target.checked;
            document.body.classList.toggle('reduce-motion', this.reduceMotion);
        });

        // Initialize sound on first interaction
        document.addEventListener('click', () => soundManager.init(), { once: true });
        document.addEventListener('keydown', () => soundManager.init(), { once: true });
    }

    /**
     * Load available packs from the packs directory
     */
    loadAvailablePacks() {
        // Use embedded packs (works without a server)
        const packIds = [
            'pointless-classics',
            'sports-and-games',
            'entertainment-culture',
            'uk-life-culture',
            'science-nature',
            'world-geography',
            'history'
        ];

        let gameNumber = 1;
        for (const packId of packIds) {
            if (EMBEDDED_PACKS && EMBEDDED_PACKS[packId]) {
                const pack = EMBEDDED_PACKS[packId];
                this.addPackCard(pack, packId, gameNumber);
                gameNumber++;
            }
        }

        // If no packs found, use demo
        if (gameNumber === 1) {
            const pack = EMBEDDED_PACKS?.demo || this.getSamplePack();
            this.addPackCard(pack, 'demo', 1);
        }
    }

    /**
     * Add a pack card to the selector
     */
    addPackCard(pack, packDir, gameNumber) {
        const packSelector = document.getElementById('pack-selector');
        const card = document.createElement('div');
        card.className = 'pack-card';
        const packName = pack.name || pack.title || 'Quiz Pack';
        card.innerHTML = `
            <div class="pack-number">Game ${gameNumber}</div>
            <h3>${packName}</h3>
            <p>${pack.categories.length} categories</p>
        `;
        card.dataset.packId = packDir;
        card.dataset.pack = JSON.stringify(pack);
        card.addEventListener('click', () => this.selectPack(card));
        packSelector.appendChild(card);

        // Select first pack by default
        if (packSelector.children.length === 1) {
            this.selectPack(card);
        }
    }

    /**
     * Select a pack
     */
    selectPack(card) {
        document.querySelectorAll('.pack-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');

        if (card.dataset.pack) {
            this.pack = JSON.parse(card.dataset.pack);
            this.normalizePack();
        } else if (card.dataset.packId === 'sample') {
            this.pack = this.getSamplePack();
        }
    }

    /**
     * Normalize pack format to handle different JSON schemas
     * Converts answer.answer to answer.text for compatibility
     */
    normalizePack() {
        if (!this.pack?.categories) return;

        this.pack.categories.forEach(category => {
            if (!category.answers) return;
            category.answers.forEach(answer => {
                // Convert 'answer' field to 'text' if needed
                if (answer.answer && !answer.text) {
                    answer.text = answer.answer;
                }
            });
        });
    }

    /**
     * Get built-in sample pack for demo
     */
    getSamplePack() {
        return {
            name: "Demo Game",
            categories: [
                {
                    name: "Colours of the Rainbow",
                    question: "Name a colour of the rainbow",
                    answers: [
                        { text: "Red", score: 95 },
                        { text: "Orange", score: 70 },
                        { text: "Yellow", score: 60 },
                        { text: "Green", score: 50 },
                        { text: "Blue", score: 85 },
                        { text: "Indigo", score: 0 },
                        { text: "Violet", score: 0 }
                    ]
                },
                {
                    name: "Planets",
                    question: "Name a planet in our solar system",
                    answers: [
                        { text: "Mercury", score: 40 },
                        { text: "Venus", score: 55 },
                        { text: "Earth", score: 98 },
                        { text: "Mars", score: 90 },
                        { text: "Jupiter", score: 75 },
                        { text: "Saturn", score: 70 },
                        { text: "Uranus", score: 15 },
                        { text: "Neptune", score: 0 }
                    ]
                },
                {
                    name: "Days of the Week",
                    question: "Name a day of the week",
                    answers: [
                        { text: "Monday", score: 85 },
                        { text: "Tuesday", score: 50 },
                        { text: "Wednesday", score: 45 },
                        { text: "Thursday", score: 40 },
                        { text: "Friday", score: 90 },
                        { text: "Saturday", score: 80 },
                        { text: "Sunday", score: 75 }
                    ]
                },
                {
                    name: "Continents",
                    question: "Name a continent",
                    answers: [
                        { text: "Africa", score: 60 },
                        { text: "Antarctica", score: 0 },
                        { text: "Asia", score: 70 },
                        { text: "Australia", score: 55 },
                        { text: "Europe", score: 80 },
                        { text: "North America", score: 75 },
                        { text: "South America", score: 45 }
                    ]
                },
                {
                    name: "Seasons",
                    question: "Name a season of the year",
                    answers: [
                        { text: "Spring", score: 70 },
                        { text: "Summer", score: 95 },
                        { text: "Autumn", score: 40 },
                        { text: "Winter", score: 80 }
                    ]
                }
            ]
        };
    }

    /**
     * Initialize player inputs
     */
    initializePlayers(count) {
        const container = document.getElementById('player-inputs');
        container.innerHTML = '';

        for (let i = 0; i < count; i++) {
            this.addPlayerInput(i + 1);
        }
    }

    /**
     * Add a player input field
     */
    addPlayerInput(num) {
        const container = document.getElementById('player-inputs');
        const div = document.createElement('div');
        div.className = 'player-input';
        div.innerHTML = `
            <label>${num}.</label>
            <input type="text" placeholder="Player ${num}" value="Player ${num}" data-player="${num}">
        `;
        container.appendChild(div);
    }

    /**
     * Add a player
     */
    addPlayer() {
        const inputs = document.querySelectorAll('.player-input');
        if (inputs.length < 6) {
            this.addPlayerInput(inputs.length + 1);
        }
    }

    /**
     * Remove a player
     */
    removePlayer() {
        const inputs = document.querySelectorAll('.player-input');
        if (inputs.length > 2) {
            inputs[inputs.length - 1].remove();
        }
    }

    /**
     * Start the game
     */
    startGame() {
        if (!this.pack || !this.pack.categories || this.pack.categories.length === 0) {
            alert('No game pack loaded yet. Please select a pack or try again.');
            return;
        }

        // Check play style - if multiplayer, redirect to host.html
        const playStyleInput = document.querySelector('input[name="play-style"]:checked');
        const playStyle = playStyleInput ? playStyleInput.value : 'local';

        if (playStyle === 'multiplayer') {
            // Get settings for multiplayer
            const gameModeInput = document.querySelector('input[name="game-mode"]:checked');
            const gameMode = gameModeInput ? gameModeInput.value : 'party';
            const rounds = document.getElementById('num-rounds').value || '5';
            const timer = document.getElementById('timer-enabled').checked;

            // Build URL with settings
            const params = new URLSearchParams({
                pack: this.pack.id || 'default',
                mode: gameMode,
                rounds: rounds,
                timer: timer.toString()
            });

            // Store pack in sessionStorage for host.html to access
            sessionStorage.setItem('pointless-pack', JSON.stringify(this.pack));

            // Redirect to host view
            window.location.href = `host.html?${params.toString()}`;
            return;
        }

        // Get player names
        const playerInputs = document.querySelectorAll('.player-input input');
        this.players = Array.from(playerInputs).map((input, i) => ({
            name: input.value || `Player ${i + 1}`,
            score: 0,
            roundScores: [],
            eliminated: false,
            eliminatedRound: null
        }));

        // Get game mode
        const gameModeInput = document.querySelector('input[name="game-mode"]:checked');
        this.gameMode = gameModeInput ? gameModeInput.value : 'party';

        // Get settings
        this.totalRounds = parseInt(document.getElementById('num-rounds').value) || 5;
        this.timerEnabled = document.getElementById('timer-enabled').checked;

        // In TV show mode, limit rounds based on players (need to eliminate down to 1)
        if (this.gameMode === 'tv-show') {
            // Max rounds is players - 1 (so we can have a winner)
            this.totalRounds = Math.min(this.totalRounds, this.players.length - 1);
        }

        // Select random categories for rounds
        this.selectRoundCategories();

        // Initialize audio
        soundManager.init();

        // Switch to game screen
        this.showScreen('game-screen');

        // Start first round
        this.startRound();
    }

    /**
     * Select random categories for all rounds
     */
    selectRoundCategories() {
        const categories = [...this.pack.categories];
        this.roundCategories = [];

        for (let i = 0; i < this.totalRounds; i++) {
            if (categories.length === 0) {
                // Reshuffle if we run out
                categories.push(...this.pack.categories);
            }
            const idx = Math.floor(Math.random() * categories.length);
            this.roundCategories.push(categories.splice(idx, 1)[0]);
        }
    }

    /**
     * Start a round
     */
    startRound() {
        this.currentCategory = this.roundCategories[this.currentRound - 1];
        this.usedAnswersThisRound = new Set();

        // Find first non-eliminated player
        this.currentPlayerIndex = this.players.findIndex(p => !p.eliminated);
        if (this.currentPlayerIndex === -1) this.currentPlayerIndex = 0;

        // Clear answer board for new round
        this.answerBoardEntries = [];
        this.clearAnswerBoard();

        // Reset player round scores
        this.players.forEach(p => {
            if (p.roundScores.length < this.currentRound) {
                p.roundScores.push(null);
            }
        });

        // Get question type for this category
        this.questionType = this.currentCategory.type || 'standard';
        this.buildAnswerIndex();

        // Update UI
        document.getElementById('current-round').textContent = this.currentRound;
        document.getElementById('total-rounds').textContent = this.totalRounds;
        document.getElementById('category-prompt').textContent = this.currentCategory.question || this.currentCategory.prompt;

        // Setup question type display
        this.setupQuestionTypeDisplay();

        // Show category intro
        this.showCategoryIntro();
    }

    /**
     * Setup display for different question types
     */
    setupQuestionTypeDisplay() {
        // Hide all type displays
        document.querySelectorAll('.type-display').forEach(el => el.classList.add('hidden'));

        switch (this.questionType) {
            case 'anagram':
                // Pick a random answer to scramble for display
                if (this.currentCategory.answers && this.currentCategory.answers.length > 0) {
                    const answer = this.currentCategory.answers[Math.floor(Math.random() * this.currentCategory.answers.length)];
                    const scrambled = answer.scrambled || this.scrambleText(answer.text);
                    document.getElementById('scrambled-text').textContent = scrambled;
                    document.getElementById('letter-count').textContent = answer.text.length;
                    document.getElementById('anagram-display').classList.remove('hidden');
                }
                break;

            case 'picture':
                // Picture rounds show images - handled during answer reveal
                document.getElementById('picture-display').classList.remove('hidden');
                break;

            case 'missing_word':
                // Show first answer's display format
                if (this.currentCategory.answers && this.currentCategory.answers.length > 0) {
                    const answer = this.currentCategory.answers[0];
                    if (answer.display) {
                        document.getElementById('phrase-text').textContent = answer.display;
                        document.getElementById('missing-word-display').classList.remove('hidden');
                    }
                }
                break;

            default:
                // Standard - no special display needed
                break;
        }
    }

    /**
     * Normalize text for matching (case/diacritics/punctuation)
     */
    normalizeAnswer(text) {
        return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Build answer lookup/index for fast matching and autocomplete
     */
    buildAnswerIndex() {
        this.answerIndex = [];
        this.answerLookup = new Map();

        if (!this.currentCategory?.answers) return;

        const addEntry = (answer, text, alias = null) => {
            if (!text) return;
            const normalized = this.normalizeAnswer(text);
            if (!normalized) return;
            this.answerIndex.push({ answer, matchText: normalized, alias });
            if (!this.answerLookup.has(normalized)) {
                this.answerLookup.set(normalized, answer);
            }
        };

        this.currentCategory.answers.forEach(answer => {
            addEntry(answer, answer.text);
            if (answer.aliases && answer.aliases.length) {
                answer.aliases.forEach(alias => addEntry(answer, alias, alias));
            }
        });
    }

    /**
     * Scramble text for anagram display
     */
    scrambleText(text) {
        const chars = text.toUpperCase().replace(/\s/g, '').split('');
        for (let i = chars.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [chars[i], chars[j]] = [chars[j], chars[i]];
        }
        return chars.join('');
    }

    /**
     * Clear the answer board display
     */
    clearAnswerBoard() {
        const entriesContainer = document.getElementById('answer-board-entries');
        if (entriesContainer) {
            entriesContainer.innerHTML = '';
        }
    }

    /**
     * Update the answer board with a new entry
     */
    updateAnswerBoard(playerName, answer, points) {
        this.answerBoardEntries.push({ playerName, answer, points });

        const entriesContainer = document.getElementById('answer-board-entries');
        if (!entriesContainer) return;

        const entry = document.createElement('div');
        entry.className = `answer-board-entry ${points === 0 ? 'pointless-entry' : ''}`;
        entry.innerHTML = `
            <span class="answer-board-player">${playerName}</span>
            <span class="answer-board-answer">${answer}</span>
            <span class="answer-board-score">${points}</span>
        `;
        entriesContainer.appendChild(entry);
    }

    /**
     * Show category introduction animation
     */
    showCategoryIntro() {
        const intro = document.getElementById('category-intro');
        document.getElementById('intro-round-num').textContent = this.currentRound;
        document.getElementById('intro-category-prompt').textContent = this.currentCategory.question || this.currentCategory.prompt;

        intro.classList.remove('hidden');
        soundManager.roundStart();

        setTimeout(() => {
            intro.classList.add('hidden');
            this.updatePlayerTurn();
            this.startTimer();
        }, this.reduceMotion ? 500 : 2500);
    }

    /**
     * Update current player display
     */
    updatePlayerTurn() {
        const player = this.players[this.currentPlayerIndex];
        document.getElementById('current-player-name').textContent = player.name;
        document.getElementById('answer-input').value = '';
        document.getElementById('answer-input').focus();
        this.hideAutocomplete();
        document.getElementById('score-reveal-area').classList.add('hidden');

        this.updateLeaderboard();
    }

    /**
     * Update leaderboard display (legacy support)
     */
    updateLeaderboard() {
        // Also update podiums
        this.renderPodiums();

        // Legacy leaderboard if it exists
        const leaderboard = document.getElementById('leaderboard');
        if (!leaderboard) return;

        const sorted = [...this.players]
            .map((p, i) => ({ ...p, originalIndex: i }))
            .sort((a, b) => a.score - b.score);

        leaderboard.innerHTML = sorted.map((player, rank) => {
            const isCurrentPlayer = player.originalIndex === this.currentPlayerIndex;
            const roundScore = player.roundScores[this.currentRound - 1];
            const roundScoreDisplay = roundScore !== null ? `+${roundScore}` : '';

            return `
                <div class="leaderboard-entry ${isCurrentPlayer ? 'current-player' : ''} ${rank === 0 ? 'first-place' : ''}">
                    <span class="leaderboard-rank">${rank + 1}</span>
                    <span class="leaderboard-name">${player.name}</span>
                    <span class="leaderboard-score">${player.score}</span>
                    <span class="leaderboard-round-score">${roundScoreDisplay}</span>
                </div>
            `;
        }).join('');
    }

    /**
     * Render contestant podiums - like the TV show!
     */
    renderPodiums() {
        const podiumsContainer = document.getElementById('contestant-podiums');
        if (!podiumsContainer) return;

        podiumsContainer.innerHTML = this.players.map((player, index) => {
            const isActive = index === this.currentPlayerIndex && !player.eliminated;
            const isEliminated = player.eliminated;
            const scoreClass = player.score < 200 ? 'low-score' : (player.score > 500 ? 'high-score' : '');

            return `
                <div class="contestant-podium ${isActive ? 'active' : ''} ${isEliminated ? 'eliminated' : ''}" data-player-index="${index}">
                    <div class="podium-name">${player.name}</div>
                    <div class="podium-base">
                        <div class="podium-score ${scoreClass}">${player.score}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Get active (non-eliminated) players
     */
    getActivePlayers() {
        return this.players.filter(p => !p.eliminated);
    }

    /**
     * Show round results with standings (TV show mode)
     */
    showRoundResults() {
        const overlay = document.getElementById('round-results');
        const standingsContainer = document.getElementById('round-standings');
        const eliminationDiv = document.getElementById('elimination-announcement');

        document.getElementById('results-round-num').textContent = this.currentRound;

        // Get active players sorted by round score (highest = worst)
        const activePlayers = this.getActivePlayers()
            .map(p => ({
                ...p,
                roundScore: p.roundScores[this.currentRound - 1] == null ? 100 : p.roundScores[this.currentRound - 1]
            }))
            .sort((a, b) => a.roundScore - b.roundScore);

        // In TV show mode, eliminate highest scorer
        let eliminatedPlayer = null;
        if (this.gameMode === 'tv-show' && activePlayers.length > 1) {
            eliminatedPlayer = activePlayers[activePlayers.length - 1];
            // Mark them eliminated
            const realPlayer = this.players.find(p => p.name === eliminatedPlayer.name);
            if (realPlayer) {
                realPlayer.eliminated = true;
                realPlayer.eliminatedRound = this.currentRound;
            }
        }

        // Render standings
        standingsContainer.innerHTML = activePlayers.map((player, idx) => {
            const isLowest = idx === 0;
            const isEliminated = eliminatedPlayer && player.name === eliminatedPlayer.name;
            let status = '';
            if (isEliminated) status = 'eliminated';
            else if (isLowest) status = 'lowest';
            else status = 'safe';

            return `
                <div class="standing-entry ${status}">
                    <span class="standing-name">${player.name}</span>
                    <span class="standing-score">+${player.roundScore}</span>
                </div>
            `;
        }).join('');

        // Show elimination announcement
        if (eliminatedPlayer) {
            document.getElementById('eliminated-player').textContent = eliminatedPlayer.name;
            eliminationDiv.classList.remove('hidden');
            soundManager.wrong(); // Play elimination sound
        } else {
            eliminationDiv.classList.add('hidden');
        }

        overlay.classList.remove('hidden');
    }

    /**
     * Continue from round results overlay
     */
    continueFromRoundResults() {
        document.getElementById('round-results').classList.add('hidden');

        // Update podiums to show eliminated
        this.renderPodiums();

        // Check if game should end
        const activePlayers = this.getActivePlayers();

        if (this.gameMode === 'tv-show' && activePlayers.length <= 1) {
            // Winner determined!
            this.endGame();
            return;
        }

        if (this.currentRound >= this.totalRounds) {
            this.endGame();
            return;
        }

        // Continue to next round
        this.currentRound++;
        this.startRound();
    }

    /**
     * Start the answer timer
     */
    startTimer() {
        const timerContainer = document.getElementById('timer-container');

        if (!this.timerEnabled) {
            timerContainer.classList.remove('visible');
            return;
        }

        timerContainer.classList.add('visible');
        this.timerRemaining = 30;
        this.updateTimerDisplay();

        const timerBar = document.getElementById('timer-bar');
        timerBar.classList.remove('warning');

        this.timerInterval = setInterval(() => {
            this.timerRemaining--;
            this.updateTimerDisplay();

            // Add warning class for last 10 seconds
            if (this.timerRemaining <= 10) {
                timerBar.classList.add('warning');
            }

            if (this.timerRemaining <= 5 && this.timerRemaining > 0) {
                soundManager.timerWarning();
            }

            if (this.timerRemaining <= 0) {
                this.stopTimer();
                soundManager.timerExpired();
                this.passAnswer();
            }
        }, 1000);
    }

    /**
     * Update timer display
     */
    updateTimerDisplay() {
        document.getElementById('timer-bar').style.width = `${(this.timerRemaining / 30) * 100}%`;
        document.getElementById('timer-text').textContent = this.timerRemaining;
    }

    /**
     * Stop the timer
     */
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        document.getElementById('timer-bar').classList.remove('warning');
    }

    /**
     * Get autocomplete suggestions for the current category
     */
    getAutocompleteSuggestions(query) {
        const normalizedQuery = this.normalizeAnswer(query);
        if (!normalizedQuery) return [];

        const suggestions = new Map();

        for (const entry of this.answerIndex) {
            const matchIndex = entry.matchText.indexOf(normalizedQuery);
            if (matchIndex === -1) continue;

            const matchType = matchIndex === 0 ? 0 : 1;
            const existing = suggestions.get(entry.answer.text);

            if (!existing ||
                matchType < existing.matchType ||
                (matchType === existing.matchType && matchIndex < existing.matchIndex)) {
                suggestions.set(entry.answer.text, {
                    answer: entry.answer,
                    alias: entry.alias,
                    matchType,
                    matchIndex
                });
            }
        }

        return Array.from(suggestions.values())
            .sort((a, b) =>
                a.matchType - b.matchType ||
                a.matchIndex - b.matchIndex ||
                a.answer.text.localeCompare(b.answer.text)
            )
            .slice(0, 8);
    }

    /**
     * Render autocomplete dropdown
     */
    renderAutocompleteSuggestions(suggestions, query) {
        const dropdown = document.getElementById('autocomplete-dropdown');
        if (!dropdown) return;

        dropdown.innerHTML = '';

        suggestions.forEach((suggestion, index) => {
            const item = document.createElement('div');
            item.className = `autocomplete-item${index === 0 ? ' selected' : ''}`;
            item.dataset.answer = suggestion.answer.text;

            const aliasText = suggestion.alias &&
                suggestion.alias.toLowerCase() !== suggestion.answer.text.toLowerCase()
                ? `<div class="autocomplete-alias">aka ${this.highlightMatch(suggestion.alias, query)}</div>`
                : '';

            item.innerHTML = `
                <div class="autocomplete-primary">${this.highlightMatch(suggestion.answer.text, query)}</div>
                ${aliasText}
            `;

            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.selectAutocompleteItem(item);
            });

            dropdown.appendChild(item);
        });

        dropdown.classList.remove('hidden');
    }

    /**
     * Hide autocomplete dropdown
     */
    hideAutocomplete() {
        const dropdown = document.getElementById('autocomplete-dropdown');
        if (!dropdown) return;
        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
    }

    /**
     * Select an autocomplete item
     */
    selectAutocompleteItem(item) {
        const input = document.getElementById('answer-input');
        if (!input) return;
        if (item?.dataset?.answer) {
            input.value = item.dataset.answer;
        }
        this.hideAutocomplete();
        input.focus();
    }

    /**
     * Handle answer input with host-facing autocomplete
     */
    handleAnswerInput() {
        // Autocomplete disabled - don't want to spoil the answers!
    }

    /**
     * Highlight matching text
     */
    escapeHtml(text) {
        return text.replace(/[&<>"']/g, (char) => {
            switch (char) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case "'": return '&#39;';
                default: return char;
            }
        });
    }

    highlightMatch(text, query) {
        if (!query) return this.escapeHtml(text);
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return this.escapeHtml(text);
        return this.escapeHtml(text.slice(0, idx)) +
            `<span class="match">${this.escapeHtml(text.slice(idx, idx + query.length))}</span>` +
            this.escapeHtml(text.slice(idx + query.length));
    }

    /**
     * Handle keyboard in input field
     */
    handleInputKeydown(e) {
        const dropdown = document.getElementById('autocomplete-dropdown');
        const dropdownVisible = dropdown && !dropdown.classList.contains('hidden');
        const items = dropdownVisible ? Array.from(dropdown.querySelectorAll('.autocomplete-item')) : [];
        const selected = dropdownVisible ? dropdown.querySelector('.autocomplete-item.selected') : null;

        if (e.key === 'ArrowDown') {
            if (!dropdownVisible || items.length === 0) return;
            e.preventDefault();
            const idx = items.indexOf(selected);
            const nextIndex = idx === -1 ? 0 : (idx + 1) % items.length;
            items.forEach(item => item.classList.remove('selected'));
            items[nextIndex].classList.add('selected');
        } else if (e.key === 'ArrowUp') {
            if (!dropdownVisible || items.length === 0) return;
            e.preventDefault();
            const idx = items.indexOf(selected);
            const nextIndex = idx === -1 ? items.length - 1 : (idx - 1 + items.length) % items.length;
            items.forEach(item => item.classList.remove('selected'));
            items[nextIndex].classList.add('selected');
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selected && dropdownVisible) {
                this.selectAutocompleteItem(selected);
            }
            this.submitAnswer();
        } else if (e.key === 'Tab') {
            if (selected && dropdownVisible) {
                e.preventDefault();
                this.selectAutocompleteItem(selected);
            }
        } else if (e.key === 'Escape') {
            this.hideAutocomplete();
        }
    }

    /**
     * Submit the current answer
     */
    submitAnswer() {
        this.stopTimer();
        this.hideAutocomplete();

        const input = document.getElementById('answer-input').value.trim();
        if (!input) {
            this.passAnswer();
            return;
        }

        // Find the answer
        const answer = this.findAnswer(input);

        if (!answer) {
            // Wrong answer - not in list
            this.revealScore(input, 100, false, null, null);
            return;
        }

        if (this.usedAnswersThisRound.has(answer.text.toLowerCase())) {
            // Already used
            this.revealScore(input, 100, false, 'Already said!', null);
            return;
        }

        // Correct answer
        this.usedAnswersThisRound.add(answer.text.toLowerCase());
        this.revealScore(answer.text, answer.score, true, null, answer.image);
    }

    /**
     * Find an answer by text or alias
     */
    findAnswer(input) {
        const normalizedInput = this.normalizeAnswer(input);
        if (!normalizedInput) return null;

        if (this.answerLookup && this.answerLookup.size > 0) {
            const directMatch = this.answerLookup.get(normalizedInput);
            if (directMatch) return directMatch;
        }

        return this.currentCategory.answers.find(answer => {
            if (this.normalizeAnswer(answer.text) === normalizedInput) return true;
            if (answer.aliases) {
                return answer.aliases.some(a => this.normalizeAnswer(a) === normalizedInput);
            }
            return false;
        });
    }

    /**
     * Pass (no answer / timeout)
     */
    passAnswer() {
        this.stopTimer();
        this.hideAutocomplete();
        this.revealScore('PASS', 100, false, null, null);
    }

    /**
     * Reveal score with countdown animation (like the real show!)
     */
    revealScore(answerText, points, isCorrect, customMessage = null, image = null) {
        const player = this.players[this.currentPlayerIndex];

        // Save to history for undo (including the answer for proper undo)
        this.history.push({
            playerIndex: this.currentPlayerIndex,
            round: this.currentRound,
            previousScore: player.score,
            previousRoundScore: player.roundScores[this.currentRound - 1],
            usedAnswer: isCorrect ? answerText.toLowerCase() : null
        });

        // Update scores
        player.score += points;
        player.roundScores[this.currentRound - 1] = points;

        // Add to answer board
        this.updateAnswerBoard(player.name, answerText, points);

        // Show score reveal
        const revealArea = document.getElementById('score-reveal-area');
        const revealedAnswer = document.getElementById('revealed-answer');
        const scoreBar = document.getElementById('score-bar');
        const scoreValue = document.getElementById('score-value');

        revealedAnswer.textContent = customMessage || answerText;
        revealArea.classList.remove('hidden');

        // Reset score display
        scoreBar.style.height = '100%';  // Start full (at 100)
        scoreValue.textContent = '100';
        scoreValue.classList.remove('pointless');
        scoreValue.classList.add('counting');

        // Animate score COUNTDOWN from 100 to target (like the real show!)
        this.animateScoreCountdown(scoreValue, scoreBar, 100, points, () => {
            scoreValue.classList.remove('counting');

            // Play appropriate sound and celebration
            if (points === 0) {
                scoreValue.classList.add('pointless');
                soundManager.pointless();
                this.showPointlessCelebration();
            } else if (isCorrect) {
                soundManager.correct();
            } else {
                soundManager.wrong();
            }
        });

        // Show image if available
        const imageContainer = document.getElementById('answer-image');
        if (image && image.url) {
            document.getElementById('answer-img').src = image.url;
            imageContainer.classList.remove('hidden');
            this.currentImage = image;
            this.imageCredits.push(image);
        } else {
            imageContainer.classList.add('hidden');
            this.currentImage = null;
        }

        // Update leaderboard
        this.updateLeaderboard();
    }

    /**
     * Animate score counting DOWN from 100 to target (authentic Pointless style!)
     */
    animateScoreCountdown(element, bar, from, to, onComplete) {
        // Clear any existing animation
        if (this.scoreAnimationInterval) {
            clearInterval(this.scoreAnimationInterval);
        }

        const duration = this.reduceMotion ? 500 : 2000;
        const steps = from - to;
        const stepTime = Math.max(duration / Math.max(steps, 1), 20);

        let current = from;

        // Quick countdown for wrong answers, slower dramatic countdown for correct
        const tick = () => {
            if (current > to) {
                current--;
                element.textContent = current;
                bar.style.height = `${current}%`;

                // Play tick sound every few steps
                if (current % 5 === 0) {
                    soundManager.tick();
                }

                this.scoreAnimationInterval = setTimeout(tick, stepTime);
            } else {
                element.textContent = to;
                bar.style.height = `${to}%`;
                this.scoreAnimationInterval = null;
                if (onComplete) onComplete();
            }
        };

        // Small delay before starting countdown for dramatic effect
        setTimeout(tick, 300);
    }

    /**
     * Show pointless celebration
     */
    showPointlessCelebration() {
        const celebration = document.getElementById('pointless-celebration');
        celebration.classList.remove('hidden');

        // Add £250 to jackpot!
        this.jackpot += 250;
        this.pointlessThisGame++;
        this.updateJackpotDisplay();

        // Update the celebration subtitle with current jackpot
        const subtitle = document.querySelector('.celebration-subtitle');
        if (subtitle) {
            subtitle.textContent = `+£250 TO THE JACKPOT (NOW £${this.jackpot.toLocaleString()})`;
        }

        // Create confetti
        if (!this.reduceMotion) {
            this.createConfetti();
        }

        setTimeout(() => {
            celebration.classList.add('hidden');
        }, this.reduceMotion ? 1500 : 3500);
    }

    /**
     * Update jackpot display
     */
    updateJackpotDisplay() {
        const jackpotEl = document.getElementById('jackpot-amount');
        if (jackpotEl) {
            jackpotEl.textContent = `£${this.jackpot.toLocaleString()}`;
        }
    }

    /**
     * Create confetti particles
     */
    createConfetti() {
        const container = document.getElementById('confetti-container');
        container.innerHTML = '';

        const colors = ['#ffd700', '#00ff88', '#00b4ff', '#ff3355', '#ff9500', '#8b5cf6'];

        for (let i = 0; i < 80; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = `${Math.random() * 100}%`;
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.animationDelay = `${Math.random() * 0.8}s`;
            confetti.style.animationDuration = `${2.5 + Math.random() * 2}s`;
            container.appendChild(confetti);
        }
    }

    /**
     * Move to next player (skipping eliminated in TV show mode)
     */
    nextPlayer() {
        // IMPORTANT: Stop timer before changing player (bug fix)
        this.stopTimer();

        // Find next non-eliminated player
        let nextIndex = this.currentPlayerIndex + 1;
        while (nextIndex < this.players.length && this.players[nextIndex].eliminated) {
            nextIndex++;
        }

        if (nextIndex >= this.players.length) {
            // Round complete
            this.endRound();
        } else {
            this.currentPlayerIndex = nextIndex;
            this.updatePlayerTurn();
            this.startTimer();
        }
    }

    /**
     * End current round
     */
    endRound() {
        this.stopTimer();
        soundManager.roundEnd();

        // Check if game over
        if (this.currentRound >= this.totalRounds) {
            this.endGame();
        } else {
            // Ready for next round
            document.getElementById('score-reveal-area').classList.add('hidden');
        }
    }

    /**
     * Start next round
     */
    nextRound() {
        // In TV show mode, show round results with elimination
        if (this.gameMode === 'tv-show') {
            this.showRoundResults();
            return;
        }

        // Party mode - just continue
        if (this.currentRound >= this.totalRounds) {
            this.endGame();
            return;
        }

        this.currentRound++;
        this.startRound();
    }

    /**
     * Undo last answer (with proper answer removal from used set)
     */
    undo() {
        if (this.history.length === 0) return;

        const last = this.history.pop();
        const player = this.players[last.playerIndex];

        // Restore scores
        player.score = last.previousScore;
        player.roundScores[last.round - 1] = last.previousRoundScore;

        // IMPORTANT: Remove the answer from used set (bug fix)
        if (last.usedAnswer && last.round === this.currentRound) {
            this.usedAnswersThisRound.delete(last.usedAnswer);
        }

        // Remove last entry from answer board
        if (last.round === this.currentRound && this.answerBoardEntries.length > 0) {
            this.answerBoardEntries.pop();
            const entriesContainer = document.getElementById('answer-board-entries');
            if (entriesContainer && entriesContainer.lastChild) {
                entriesContainer.removeChild(entriesContainer.lastChild);
            }
        }

        // IMPORTANT: If undoing in current round, reset to that player's turn (bug fix)
        if (last.round === this.currentRound) {
            this.currentPlayerIndex = last.playerIndex;
            document.getElementById('score-reveal-area').classList.add('hidden');
            this.updatePlayerTurn();
            this.startTimer();
        } else {
            this.updateLeaderboard();
        }

        soundManager.click();
    }

    /**
     * End the game
     */
    endGame() {
        soundManager.gameOver();

        // Determine winner(s) (lowest score wins)
        const sorted = [...this.players].sort((a, b) => a.score - b.score);
        const lowestScore = sorted[0].score;
        const winners = sorted.filter(p => p.score === lowestScore);

        // Show results screen
        this.showScreen('results-screen');

        // Handle ties properly
        const winnerText = winners.length > 1
            ? `${winners.map(w => w.name).join(' & ')} tie with ${lowestScore} points!`
            : `${winners[0].name} wins with ${lowestScore} points!`;

        document.getElementById('winner-announcement').innerHTML = `
            <span class="winner-name">${winnerText}</span>
        `;

        const standings = document.getElementById('final-standings');
        standings.innerHTML = sorted.map((player, rank) => `
            <div class="leaderboard-entry ${winners.some(w => w.name === player.name) ? 'first-place' : ''}">
                <span class="leaderboard-rank">${rank + 1}</span>
                <span class="leaderboard-name">${player.name}</span>
                <span class="leaderboard-score">${player.score}</span>
            </div>
        `).join('');
    }

    /**
     * Reset game to setup
     */
    resetGame() {
        this.currentRound = 1;
        this.currentPlayerIndex = 0;
        this.history = [];
        this.imageCredits = [];
        this.answerIndex = [];
        this.answerLookup = new Map();
        this.hideAutocomplete();

        // Reset jackpot to starting value
        this.jackpot = 1000;
        this.pointlessThisGame = 0;
        this.updateJackpotDisplay();

        // Reset all player state
        this.players.forEach(p => {
            p.score = 0;
            p.roundScores = [];
            p.eliminated = false;
            p.eliminatedRound = null;
        });

        this.showScreen('setup-screen');
    }

    /**
     * Show a specific screen
     */
    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    }

    /**
     * Handle global keyboard shortcuts
     */
    handleKeyboard(e) {
        const isAnswerInput = e.target.tagName === 'INPUT' && e.target.id === 'answer-input';
        if (isAnswerInput) {
            if (e.key === 'ArrowRight' && !e.target.value) {
                e.preventDefault();
                this.nextPlayer();
            }
            if (e.key === 'Backspace' && !e.target.value) {
                e.preventDefault();
                this.undo();
            }
            return;
        }

        switch (e.key) {
            case 'ArrowRight':
                e.preventDefault();
                this.nextPlayer();
                break;
            case 'n':
            case 'N':
                if (!e.target.matches('input')) {
                    e.preventDefault();
                    this.nextRound();
                }
                break;
            case 'Backspace':
                if (!e.target.matches('input')) {
                    e.preventDefault();
                    this.undo();
                }
                break;
            case 'm':
            case 'M':
                if (!e.target.matches('input')) {
                    e.preventDefault();
                    this.toggleMute();
                }
                break;
            case 'f':
            case 'F':
                if (!e.target.matches('input')) {
                    e.preventDefault();
                    this.toggleFullscreen();
                }
                break;
            case '?':
                e.preventDefault();
                document.getElementById('shortcuts-help').classList.toggle('hidden');
                break;
        }
    }

    /**
     * Toggle mute
     */
    toggleMute() {
        const muted = soundManager.toggleMute();
        document.getElementById('mute-btn').textContent = muted ? '🔇' : '🔊';
    }

    /**
     * Toggle fullscreen
     */
    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen?.();
        } else {
            document.exitFullscreen?.();
        }
    }

    /**
     * Show credits modal
     */
    showCredits() {
        const content = document.getElementById('credits-content');
        content.innerHTML = `
            <div class="credit-section">
                <h3>Data Sources</h3>
                <p>Questions and answers powered by:</p>
                <ul>
                    <li><a href="https://www.wikidata.org" target="_blank">Wikidata</a> - Structured knowledge database</li>
                    <li><a href="https://wikimedia.org/api/rest_v1/" target="_blank">Wikimedia REST API</a> - Wikipedia pageviews</li>
                    <li><a href="https://commons.wikimedia.org" target="_blank">Wikimedia Commons</a> - Free images</li>
                </ul>
            </div>
            <div class="credit-section">
                <h3>Image Credits</h3>
                ${this.imageCredits.length > 0 ? this.imageCredits.map(img => `
                    <p>
                        <strong>${img.description || 'Image'}</strong><br>
                        Author: ${img.author}<br>
                        License: ${img.license}${img.licenseUrl ? ` (<a href="${img.licenseUrl}" target="_blank">details</a>)` : ''}<br>
                        <a href="${img.source}" target="_blank">Source</a>
                    </p>
                `).join('') : '<p>No images used in this game.</p>'}
            </div>
            <div class="credit-section">
                <h3>Sound Effects</h3>
                <p>All sounds are procedurally generated using the Web Audio API.</p>
            </div>
            <div class="credit-section">
                <h3>About</h3>
                <p>Pointless is a family quiz game inspired by the BBC TV show format. This implementation uses only publicly available data and generates genuine "pointless" scores based on real Wikipedia pageview statistics.</p>
                <p>Lower scores are better - aim for a POINTLESS answer!</p>
            </div>
        `;

        document.getElementById('credits-modal').classList.remove('hidden');
    }

    /**
     * Hide credits modal
     */
    hideCredits() {
        document.getElementById('credits-modal').classList.add('hidden');
    }

    /**
     * Show image info modal
     */
    showImageInfo() {
        if (!this.currentImage) return;

        const content = document.getElementById('image-credit-content');
        content.innerHTML = `
            <p><strong>Author:</strong> ${this.currentImage.author}</p>
            <p><strong>License:</strong> ${this.currentImage.license}</p>
            ${this.currentImage.licenseUrl ? `<p><a href="${this.currentImage.licenseUrl}" target="_blank">View license</a></p>` : ''}
            <p><a href="${this.currentImage.source}" target="_blank">View on Wikimedia Commons</a></p>
        `;

        document.getElementById('image-modal').classList.remove('hidden');
    }

    /**
     * Hide image info modal
     */
    hideImageInfo() {
        document.getElementById('image-modal').classList.add('hidden');
    }
}

// Initialize game on load
document.addEventListener('DOMContentLoaded', () => {
    window.game = new PointlessGame();
});
