/**
 * Pointless Sound Effects System
 *
 * Authentic quiz show sound design using Web Audio API
 * All sounds are synthesized - no external files needed
 */

class SoundManager {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.muted = false;
        this.volume = 0.7;
        this.initialized = false;
    }

    /**
     * Initialize audio context (must be called after user interaction)
     */
    init() {
        if (this.initialized) return;

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.audioContext.createGain();
            this.masterGain.connect(this.audioContext.destination);
            this.masterGain.gain.value = this.volume;
            this.initialized = true;

            // Resume if suspended
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
        } catch (e) {
            console.warn('Web Audio API not supported:', e);
        }
    }

    /**
     * Set master volume (0-1)
     */
    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        if (this.masterGain) {
            this.masterGain.gain.linearRampToValueAtTime(
                this.muted ? 0 : this.volume,
                this.audioContext.currentTime + 0.01
            );
        }
    }

    /**
     * Toggle mute
     */
    toggleMute() {
        this.muted = !this.muted;
        if (this.masterGain) {
            this.masterGain.gain.linearRampToValueAtTime(
                this.muted ? 0 : this.volume,
                this.audioContext.currentTime + 0.01
            );
        }
        return this.muted;
    }

    /**
     * Create an oscillator with ADSR envelope
     */
    createTone(freq, type, duration, attack = 0.01, decay = 0.1, sustain = 0.5, release = 0.1, volume = 1) {
        if (!this.initialized) return null;

        const osc = this.audioContext.createOscillator();
        const env = this.audioContext.createGain();

        osc.type = type;
        osc.frequency.value = freq;
        osc.connect(env);
        env.connect(this.masterGain);

        const now = this.audioContext.currentTime;
        env.gain.setValueAtTime(0, now);
        env.gain.linearRampToValueAtTime(volume, now + attack);
        env.gain.linearRampToValueAtTime(sustain * volume, now + attack + decay);
        env.gain.setValueAtTime(sustain * volume, now + duration - release);
        env.gain.linearRampToValueAtTime(0, now + duration);

        osc.start(now);
        osc.stop(now + duration + 0.1);

        return { osc, env };
    }

    /**
     * Create a layered chord for richer sound
     */
    createChord(frequencies, type, duration, attack, decay, sustain, release, volume = 0.3) {
        frequencies.forEach(freq => {
            this.createTone(freq, type, duration, attack, decay, sustain, release, volume);
            // Add subtle detuned layer for richness
            this.createTone(freq * 1.003, type, duration, attack, decay, sustain * 0.5, release, volume * 0.3);
        });
    }

    /**
     * Play a drumroll using filtered noise
     */
    playDrumroll(duration, intensity = 0.3) {
        if (!this.initialized) return;

        const bufferSize = this.audioContext.sampleRate * duration;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * intensity;
        }

        const noise = this.audioContext.createBufferSource();
        noise.buffer = buffer;

        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 200;
        filter.Q.value = 1;

        const env = this.audioContext.createGain();
        const now = this.audioContext.currentTime;

        // Crescendo effect
        env.gain.setValueAtTime(0.1, now);
        env.gain.linearRampToValueAtTime(intensity, now + duration * 0.8);
        env.gain.linearRampToValueAtTime(0, now + duration);

        noise.connect(filter);
        filter.connect(env);
        env.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + duration);
    }

    /**
     * Round start sound - Dramatic ascending fanfare
     */
    roundStart() {
        if (!this.initialized) return;

        // Ascending brass-like fanfare
        const notes = [
            { freq: 261.63, delay: 0 },      // C4
            { freq: 329.63, delay: 120 },    // E4
            { freq: 392.00, delay: 240 },    // G4
            { freq: 523.25, delay: 360 },    // C5
        ];

        notes.forEach(({ freq, delay }) => {
            setTimeout(() => {
                this.createTone(freq, 'sawtooth', 0.35, 0.02, 0.08, 0.6, 0.15, 0.4);
                this.createTone(freq * 2, 'sine', 0.3, 0.02, 0.05, 0.4, 0.1, 0.2);
            }, delay);
        });

        // Final chord
        setTimeout(() => {
            this.createChord([523.25, 659.25, 783.99], 'sawtooth', 0.6, 0.02, 0.1, 0.5, 0.3, 0.35);
        }, 500);
    }

    /**
     * Correct answer sound - Pleasant confirmation chime
     */
    correct() {
        if (!this.initialized) return;

        // Two-tone bell-like chime
        this.createTone(880, 'sine', 0.25, 0.01, 0.05, 0.6, 0.12, 0.5);
        this.createTone(880 * 1.5, 'sine', 0.25, 0.01, 0.03, 0.3, 0.1, 0.2); // Harmonic

        setTimeout(() => {
            this.createTone(1108.73, 'sine', 0.35, 0.01, 0.05, 0.5, 0.18, 0.5);
            this.createTone(1108.73 * 1.5, 'sine', 0.3, 0.01, 0.03, 0.25, 0.15, 0.15);
        }, 120);
    }

    /**
     * Wrong answer sound (100 points) - Disappointed buzz
     */
    wrong() {
        if (!this.initialized) return;

        // Low disappointing buzz
        this.createTone(130, 'sawtooth', 0.5, 0.02, 0.1, 0.4, 0.25, 0.5);
        this.createTone(138, 'sawtooth', 0.5, 0.02, 0.1, 0.3, 0.25, 0.3);

        // Add some noise for "X" sound
        const bufferSize = this.audioContext.sampleRate * 0.15;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * 0.3;
        }

        const noise = this.audioContext.createBufferSource();
        noise.buffer = buffer;

        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 500;

        const env = this.audioContext.createGain();
        env.gain.setValueAtTime(0.2, this.audioContext.currentTime);
        env.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.15);

        noise.connect(filter);
        filter.connect(env);
        env.connect(this.masterGain);
        noise.start();
    }

    /**
     * POINTLESS sound - The BIG celebratory fanfare! (3+ seconds)
     */
    pointless() {
        if (!this.initialized) return;

        const now = this.audioContext.currentTime;

        // === PART 1: Dramatic silence break with brass hit (0-300ms) ===
        this.createChord([523.25, 659.25, 783.99], 'sawtooth', 0.4, 0.01, 0.1, 0.7, 0.2, 0.5);
        this.createChord([523.25, 659.25, 783.99], 'triangle', 0.4, 0.01, 0.08, 0.5, 0.2, 0.3);

        // === PART 2: Rising flourish (300-800ms) ===
        const flourishNotes = [783.99, 880, 987.77, 1046.50, 1174.66, 1318.51];
        flourishNotes.forEach((freq, i) => {
            setTimeout(() => {
                this.createTone(freq, 'sine', 0.12, 0.01, 0.02, 0.6, 0.06, 0.4);
                this.createTone(freq * 0.5, 'triangle', 0.1, 0.01, 0.02, 0.3, 0.05, 0.2);
            }, 300 + i * 70);
        });

        // === PART 3: The big sustained "POINTLESS" chord (800-2500ms) ===
        setTimeout(() => {
            // Main triumphant chord - C major with extensions
            const mainChord = [523.25, 659.25, 783.99, 1046.50];
            mainChord.forEach(freq => {
                this.createTone(freq, 'sawtooth', 1.8, 0.02, 0.2, 0.6, 0.5, 0.4);
                this.createTone(freq, 'sine', 2.0, 0.02, 0.15, 0.7, 0.6, 0.3);
            });

            // Add shimmering high notes
            this.createTone(1567.98, 'sine', 1.5, 0.1, 0.2, 0.4, 0.4, 0.25);
            this.createTone(2093.00, 'sine', 1.2, 0.15, 0.2, 0.3, 0.3, 0.15);
        }, 800);

        // === PART 4: Sparkling arpeggios (1200-2200ms) ===
        const sparkleNotes = [1318.51, 1567.98, 1975.53, 2093.00, 2637.02];
        sparkleNotes.forEach((freq, i) => {
            setTimeout(() => {
                this.createTone(freq, 'sine', 0.3, 0.01, 0.05, 0.5, 0.15, 0.25);
            }, 1200 + i * 180);
        });

        // === PART 5: Final triumphant stab (2500-3500ms) ===
        setTimeout(() => {
            const finalChord = [523.25, 783.99, 1046.50, 1318.51, 1567.98];
            finalChord.forEach(freq => {
                this.createTone(freq, 'sawtooth', 1.0, 0.01, 0.15, 0.6, 0.5, 0.35);
                this.createTone(freq, 'triangle', 1.2, 0.02, 0.1, 0.5, 0.6, 0.25);
            });
        }, 2500);

        // === Cymbal-like noise swell ===
        setTimeout(() => {
            const bufferSize = this.audioContext.sampleRate * 0.8;
            const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * 0.15;
            }

            const noise = this.audioContext.createBufferSource();
            noise.buffer = buffer;

            const filter = this.audioContext.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = 3000;

            const env = this.audioContext.createGain();
            const t = this.audioContext.currentTime;
            env.gain.setValueAtTime(0, t);
            env.gain.linearRampToValueAtTime(0.15, t + 0.1);
            env.gain.exponentialRampToValueAtTime(0.01, t + 0.8);

            noise.connect(filter);
            filter.connect(env);
            env.connect(this.masterGain);
            noise.start();
        }, 800);
    }

    /**
     * Score counting tick - Quick blip for each number
     */
    tick() {
        if (!this.initialized) return;
        this.createTone(1200, 'square', 0.025, 0.003, 0.005, 0.4, 0.01, 0.15);
    }

    /**
     * Round end sound - Concluding phrase
     */
    roundEnd() {
        if (!this.initialized) return;

        const notes = [783.99, 659.25, 523.25]; // G5, E5, C5
        notes.forEach((freq, i) => {
            setTimeout(() => {
                this.createTone(freq, 'sine', 0.3, 0.01, 0.06, 0.6, 0.15, 0.45);
                this.createTone(freq * 0.5, 'triangle', 0.25, 0.01, 0.05, 0.3, 0.12, 0.2);
            }, i * 140);
        });
    }

    /**
     * Game over fanfare - Grand finale
     */
    gameOver() {
        if (!this.initialized) return;

        // Build up arpeggio
        const buildUp = [261.63, 329.63, 392.00];
        buildUp.forEach((freq, i) => {
            setTimeout(() => {
                this.createTone(freq, 'sawtooth', 0.4, 0.02, 0.1, 0.6, 0.2, 0.35);
            }, i * 220);
        });

        // Final grand chord
        setTimeout(() => {
            const finalChord = [523.25, 659.25, 783.99, 1046.50];
            finalChord.forEach(freq => {
                this.createTone(freq, 'sawtooth', 1.5, 0.02, 0.2, 0.5, 0.7, 0.4);
                this.createTone(freq, 'sine', 1.8, 0.02, 0.15, 0.6, 0.8, 0.3);
            });
        }, 700);
    }

    /**
     * Timer warning beep - Urgent tick
     */
    timerWarning() {
        if (!this.initialized) return;
        this.createTone(880, 'sine', 0.08, 0.01, 0.02, 0.5, 0.04, 0.4);
    }

    /**
     * Timer expired sound - Time's up!
     */
    timerExpired() {
        if (!this.initialized) return;
        this.createTone(220, 'square', 0.4, 0.01, 0.1, 0.4, 0.2, 0.5);
        this.createTone(165, 'square', 0.5, 0.05, 0.1, 0.3, 0.25, 0.3);
    }

    /**
     * Button click feedback
     */
    click() {
        if (!this.initialized) return;
        this.createTone(800, 'sine', 0.04, 0.005, 0.01, 0.4, 0.015, 0.25);
    }
}

// Global sound manager instance
window.soundManager = new SoundManager();
