const { artworkCache } = require('./Cache');

/**
 * Cover Art Resolver
 * Handles checking Cover Art Archive URLs with fallback logic (Release -> Release-Group).
 * Performs active 404 verification to ensure smooth frontend rendering.
 */
class CoverArtResolver {
    /**
     * Attempts to verify if a Cover Art Archive URL is valid by sending a HEAD request.
     * The CAA redirects (HTTP 307) to the Internet Archive, which we follow to check for 200 OK.
     * @param {string} url The Cover Art Archive template URL.
     * @returns {Promise<boolean>} True if the artwork exists, False if 404 or network error.
     */
    static async verifyArtworkExists(url) {
        try {
            // We use method: 'HEAD' to avoid downloading the actual image data during verification
            const response = await fetch(url, {
                method: 'HEAD',
                redirect: 'follow'
            });
            
            return response.ok; // true if status is 2xx
        } catch (error) {
            // Network errors or invalid URLs result in false
            return false;
        }
    }

    /**
     * Resolves the best available cover art URL using the Triple-Tier Fallback Strategy.
     * Tier 1: Release Edition Art (releaseMbid)
     * Tier 2: Release Group Art (releaseGroupMbid)
     * Tier 3: Returns null (Signals consumer to use YouTube Thumbnail)
     * 
     * @param {string|null} releaseMbid The MBID of the specific release.
     * @param {string|null} releaseGroupMbid The MBID of the overarching release-group.
     * @param {string} resolution Suffix for resolution optimization (e.g., '250', '500', or '' for max resolution).
     * @returns {Promise<string|null>} The verified premium artwork URL, or null if neither exists.
     */
    static async resolveCoverArt(releaseMbid, releaseGroupMbid, resolution = '500') {
        const suffix = resolution ? `-${resolution}` : '';
        const cacheKey = `artwork:${releaseMbid || 'none'}:${releaseGroupMbid || 'none'}:${resolution}`;
        
        // Check cache first
        const cached = await artworkCache.get(cacheKey);
        if (cached) {
            console.log(`[CoverArtResolver] Cache hit for ${cacheKey}`);
            return cached;
        }
        
        let result = null;

        // Tier 1: Try Release Edition Art
        if (releaseMbid) {
            const releaseUrl = `https://coverartarchive.org/release/${releaseMbid}/front${suffix}`;
            console.log(`[CoverArtResolver] Testing Release Art: ${releaseUrl}`);
            const releaseExists = await this.verifyArtworkExists(releaseUrl);
            
            if (releaseExists) {
                console.log(`[CoverArtResolver] ✅ Release Art verified.`);
                result = releaseUrl;
            } else {
                console.log(`[CoverArtResolver] ❌ Release Art 404 Error. Attempting Fallback...`);
            }
        }

        // Tier 2: Try Release-Group Art Fallback
        if (!result && releaseGroupMbid) {
            const groupUrl = `https://coverartarchive.org/release-group/${releaseGroupMbid}/front${suffix}`;
            console.log(`[CoverArtResolver] Testing Release-Group Art: ${groupUrl}`);
            const groupExists = await this.verifyArtworkExists(groupUrl);
            
            if (groupExists) {
                console.log(`[CoverArtResolver] ✅ Release-Group Art verified.`);
                result = groupUrl;
            } else {
                console.log(`[CoverArtResolver] ❌ Release-Group Art 404 Error.`);
            }
        }

        // Tier 3: Exhausted CAA Options
        if (!result) {
            console.log(`[CoverArtResolver] ⚠️ No premium artwork found on Cover Art Archive. Triggering YouTube Thumbnail fallback.`);
        }

        // Cache the result (even if null, to avoid repeated 404 checks)
        await artworkCache.set(cacheKey, result);

        return result;
    }
}

module.exports = CoverArtResolver;
