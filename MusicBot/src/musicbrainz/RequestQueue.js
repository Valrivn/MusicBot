class RequestQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.minIntervalMs = 1050;
        this.lastRequestTime = 0;
    }

    enqueue(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.process();
        });
    }

    async process() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const now = Date.now();
            const waitTime = Math.max(0, this.minIntervalMs - (now - this.lastRequestTime));
            if (waitTime > 0) await new Promise(r => setTimeout(r, waitTime));

            const { fn, resolve, reject } = this.queue.shift();
            this.lastRequestTime = Date.now();
            try {
                resolve(await fn());
            } catch (e) {
                reject(e);
            }
        }
        this.processing = false;
    }
}

module.exports = new RequestQueue();