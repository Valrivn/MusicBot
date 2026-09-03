/**
 * SyncController
 * Implements NTP clock synchronization and a PID loop controller to dynamically
 * warp local timeline progression to match server playback position smoothly.
 */
export class SyncController {
    private apiBaseUrl: string;
    private clockOffset: number = 0; // Server time minus client time
    private rtt: number = 0; // Round-trip time (ms)
    
    // PID Controller Parameters
    private kp: number = 0.05; // Proportional gain
    private ki: number = 0.005; // Integral gain
    private kd: number = 0.01; // Derivative gain
    
    // PID State
    private errorIntegral: number = 0;
    private lastError: number = 0;
    private lastTimestamp: number = 0;
    
    // Playback State
    private localPositionMs: number = 0;
    private targetPositionMs: number = 0;
    private isPlaying: boolean = false;
    private lastUpdateTime: number = 0;

    constructor(apiBaseUrl: string) {
        this.apiBaseUrl = apiBaseUrl;
    }

    /**
     * Perform multiple NTP handshakes with the bot server to find
     * client-server clock offset and RTT, discarding outliers.
     */
    async performNtpSync(samples: number = 5): Promise<{ offset: number; rtt: number }> {
        const offsets: number[] = [];
        const rtts: number[] = [];

        for (let i = 0; i < samples; i++) {
            const t1 = Date.now();
            try {
                const response = await fetch(`${this.apiBaseUrl}/api/time-sync`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'ngrok-skip-browser-warning': 'true'
                    },
                    body: JSON.stringify({ clientTx: t1 })
                });
                
                if (!response.ok) continue;
                
                const data = await response.json();
                const t4 = Date.now();
                
                const t23 = Number(data.serverTime);
                const currentRtt = t4 - t1;
                const currentOffset = t23 - (t1 + t4) / 2;

                offsets.push(currentOffset);
                rtts.push(currentRtt);
            } catch (err) {
                console.warn('NTP sync handshake failed:', err);
            }
            
            // Minimal pause between checks to avoid rate-limiting
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        if (offsets.length === 0) {
            return { offset: this.clockOffset, rtt: this.rtt };
        }

        // Sort and select median to filter network jitter
        offsets.sort((a, b) => a - b);
        rtts.sort((a, b) => a - b);
        
        const medianIdx = Math.floor(offsets.length / 2);
        this.clockOffset = offsets[medianIdx];
        this.rtt = rtts[medianIdx];

        console.log(`[SyncController] NTP Sync Complete. Offset: ${this.clockOffset}ms, RTT: ${this.rtt}ms`);
        return { offset: this.clockOffset, rtt: this.rtt };
    }

    /**
     * Start the virtual timeline
     */
    start(initialPositionMs: number) {
        this.localPositionMs = initialPositionMs;
        this.targetPositionMs = initialPositionMs;
        this.isPlaying = true;
        this.lastUpdateTime = performance.now();
        this.errorIntegral = 0;
        this.lastError = 0;
        this.lastTimestamp = performance.now();
    }

    /**
     * Stop the virtual timeline
     */
    stop() {
        this.isPlaying = false;
    }

    /**
     * Update target position reported by server
     */
    updateTargetPosition(serverPositionMs: number) {
        this.targetPositionMs = serverPositionMs;
    }

    /**
     * Runs on every frame (requestAnimationFrame) to update localPositionMs using PID loop correction
     */
    update(): number {
        if (!this.isPlaying) return this.localPositionMs;

        const now = performance.now();
        const dt = now - this.lastUpdateTime;
        this.lastUpdateTime = now;

        if (dt <= 0) return this.localPositionMs;

        // 1. Calculate base timeline step (running at normal 1.0x speed)
        const baseStep = dt;

        // 2. Compute sync error (Target position vs current virtual local position)
        const error = this.targetPositionMs - this.localPositionMs;

        // 3. Teleport/snap if the error is too large (e.g., > 1.5 seconds) to avoid dragging
        if (Math.abs(error) > 1500) {
            console.log(`[SyncController] Large sync gap (${error}ms). Snapping timeline.`);
            this.localPositionMs = this.targetPositionMs;
            this.errorIntegral = 0;
            this.lastError = 0;
            return this.localPositionMs;
        }

        // 4. PID loop computation
        const timeSincePID = now - this.lastTimestamp;
        this.lastTimestamp = now;

        this.errorIntegral += error * (timeSincePID / 1000);
        // Clamp integral to prevent windup
        this.errorIntegral = Math.max(-500, Math.min(500, this.errorIntegral));

        const errorDerivative = timeSincePID > 0 ? (error - this.lastError) / (timeSincePID / 1000) : 0;
        this.lastError = error;

        const pTerm = this.kp * error;
        const iTerm = this.ki * this.errorIntegral;
        const dTerm = this.kd * errorDerivative;

        // 5. Calculate speed adjustment factor (bounded between 0.5x and 1.5x)
        const speedCorrection = pTerm + iTerm + dTerm;
        const speedFactor = Math.max(0.5, Math.min(1.5, 1.0 + speedCorrection));

        // 6. Apply speed-adjusted step to local timeline
        this.localPositionMs += baseStep * speedFactor;

        return this.localPositionMs;
    }

    /**
     * Helper to get current estimated synced position
     */
    getCurrentPosition(): number {
        return Math.round(this.localPositionMs);
    }
}
