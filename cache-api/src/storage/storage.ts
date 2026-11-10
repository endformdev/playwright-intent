/** Where the API keeps zips. Paths are relative and use `/`. */
export interface CacheApiStorage {
	put(path: string, data: ArrayBuffer, contentType: string): Promise<void>;
	/** Returns null when nothing is stored at `path`. */
	get(path: string): Promise<ArrayBuffer | null>;
	head(path: string): Promise<boolean>;
	list(prefix: string): Promise<string[]>;
}
