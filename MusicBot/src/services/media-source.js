class MediaSource {
    constructor(name) {
        this.name = name;
    }

    async resolve(query) {
        throw new Error('resolve() must be implemented by subclass');
    }

    async probe(url) {
        throw new Error('probe() must be implemented by subclass');
    }
}

module.exports = { MediaSource };