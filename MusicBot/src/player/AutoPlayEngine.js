const YouTube = require('../YouTube');

class AutoPlayEngine {
    /**
     * Recommends and fetches the next track autonomously based on the current genre.
     */
    static async handleAutoplay(engine) {
        if (!engine.player.autoplay || typeof engine.player.autoplay !== 'string') return;

        try {
            const genreKeywords = {
                pop: ['pop music 2024', 'top pop songs', 'pop hits official', 'best pop music'],
                rock: ['rock music official', 'rock songs 2024', 'classic rock hits', 'best rock music'],
                hiphop: ['hip hop music', 'rap songs official', 'hip hop 2024', 'best rap music'],
                electronic: ['edm music', 'electronic dance music', 'house music official', 'best edm'],
                jazz: ['jazz music', 'jazz standards', 'smooth jazz official', 'best jazz'],
                classical: ['classical music', 'classical piano', 'orchestra music', 'best classical'],
                metal: ['metal music official', 'heavy metal songs', 'metal 2024', 'best metal'],
                country: ['country music official', 'country songs 2024', 'best country music'],
                rnb: ['r&b music official', 'rnb songs 2024', 'soul music', 'best rnb'],
                indie: ['indie music official', 'indie songs 2024', 'alternative music', 'best indie'],
                latin: ['latin music official', 'reggaeton 2024', 'latin hits', 'best latin music'],
                kpop: ['kpop official mv', 'kpop songs 2024', 'korean music official', 'best kpop'],
                anime: ['anime opening official', 'anime songs official', 'anime music 2024', 'best anime op'],
                lofi: ['lofi hip hop music', 'lofi beats official', 'chill lofi music', 'best lofi'],
                blues: ['blues music official', 'blues songs', 'blues guitar music', 'best blues'],
                reggae: ['reggae music official', 'reggae songs 2024', 'best reggae music'],
                disco: ['disco music official', 'disco hits', 'best disco music'],
                punk: ['punk rock official', 'punk music 2024', 'pop punk songs', 'best punk'],
                ambient: ['ambient music official', 'ambient soundscape', 'atmospheric music', 'best ambient'],
                random: ['music official video', 'top songs 2024', 'music video official', 'best music']
            };

            const keywords = genreKeywords[engine.player.autoplay] || genreKeywords.random;
            const randomKeyword = keywords[Math.floor(Math.random() * keywords.length)];

            const results = await YouTube.search(randomKeyword, 15, engine.player.guild.id);

            if (!results || results.length === 0) {
                return;
            }

            const filteredResults = results.filter(track => {
                if (!track.duration) return false;
                if (track.duration < 30 || track.duration > 600) return false;
                
                const title = (track.title || '').toLowerCase();
                const blockedKeywords = [
                    'tutorial', 'lesson', 'course', 'learn', 'learning',
                    'podcast', 'interview', 'talk', 'speech', 'lecture',
                    'review', 'unboxing', 'reaction', 'gameplay',
                    'full movie', 'full album', 'full episode', 'documentary',
                    'how to', 'guide', 'tips', 'tricks', 'vlog',
                    'practice', 'exercise', 'workout', 'meditation',
                    'asmr', 'story', 'audiobook', 'mix |', 'compilation'
                ];
                
                const hasBlockedKeyword = blockedKeywords.some(keyword => title.includes(keyword));
                if (hasBlockedKeyword) return false;
                
                const emojiCount = (title.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
                const bracketCount = (title.match(/[\[\]【】]/g) || []).length;
                if (emojiCount > 3 || bracketCount > 4) return false;
                
                return true;
            });

            if (filteredResults.length === 0) {
                const fallbackKeyword = keywords[Math.floor(Math.random() * keywords.length)];
                const fallbackResults = await YouTube.search(fallbackKeyword, 10, engine.player.guild.id);
                const fallbackFiltered = (fallbackResults || []).filter(track => 
                    track.duration >= 30 && track.duration <= 600
                );
                
                if (fallbackFiltered.length === 0) {
                    return;
                }
                filteredResults.push(...fallbackFiltered);
            }

            const randomTrack = filteredResults[Math.floor(Math.random() * filteredResults.length)];
            randomTrack.requestedBy = engine.player.guild.members.me.user;
            randomTrack.addedAt = Date.now();

            engine.player.queue.push(randomTrack);
           
            // Preload track using the AudioEngineCore instance method (AutoPlayEngine orchestrates, AudioEngineCore executes infrastructure)
            engine.preloadTrack(randomTrack).catch(err => {
                if (err && err.message) {
                    console.error(`❌ Autoplay preload failed: ${err.message}`);
                }
            });

            engine.player.currentTrack = engine.player.queue.shift();
            await engine.play(null, 0);

            // Update UI
            if (engine.player.ui) {
                await engine.player.ui.updateNowPlayingEmbed();
            }

        } catch (error) {
            console.error('❌ Autoplay error:', error.message);
        }
    }
}

module.exports = AutoPlayEngine;
