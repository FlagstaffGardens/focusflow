export type LogFunction = (message: string) => void;
/**
 * Resolve a Plaud share URL to a direct audio URL
 * Tries multiple strategies in order:
 * 1. temp_url API
 * 2. share-content API
 * 3. HTML page parsing
 * 4. Returns original URL as fallback
 */
export declare function resolvePlaudAudioUrl(url: string, log: LogFunction): Promise<string>;
