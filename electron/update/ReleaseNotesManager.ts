
import { net } from "electron";

const RELEASE_NOTE_BULLET_SECTIONS = new Set(["What's New", "Improvements", "Fixes", "Technical"]);
const GITHUB_REQUEST_TIMEOUT_MS = 10000;

export interface ReleaseNoteSection {
    title: string;
    items: string[];
}

export interface ParsedReleaseNotes {
    version: string;
    summary: string;
    sections: ReleaseNoteSection[];
    fullBody: string; // Fallback
    url: string;
}

export class ReleaseNotesManager {
    private static instance: ReleaseNotesManager;
    private cachedNotes: ParsedReleaseNotes | null = null;
    private readonly repoOwner = "Natively-AI-assistant";
    private readonly repoName = "natively-cluely-ai-assistant";

    private constructor() { }

    public static getInstance(): ReleaseNotesManager {
        if (!ReleaseNotesManager.instance) {
            ReleaseNotesManager.instance = new ReleaseNotesManager();
        }
        return ReleaseNotesManager.instance;
    }

    public async fetchReleaseNotes(version: string, forceRefresh = false): Promise<ParsedReleaseNotes | null> {
        if (!forceRefresh && this.cachedNotes && this.cachedNotes.version === version) {
            console.log("[ReleaseNotesManager] Returning cached release notes for", version);
            return this.cachedNotes;
        }

        console.log(`[ReleaseNotesManager] Fetching release notes for ${version}...`);

        try {
            const response = await this.makeRequest(this.buildReleaseUrl(version));

            if (!response) {
                console.warn("[ReleaseNotesManager] Failed to fetch release notes from API.");
                return null;
            }

            const data = JSON.parse(response);
            const body = data.body || "";
            const htmlUrl = data.html_url || "";
            const tagName = data.tag_name || version; // Use tag_name from API if available

            const parsed = this.parseReleaseNotes(body, tagName, htmlUrl);
            this.cachedNotes = parsed;
            return parsed;

        } catch (error) {
            console.error("[ReleaseNotesManager] Error fetching release notes:", error);
            return null;
        }
    }

    private buildReleaseUrl(version: string): string {
        if (version === 'latest') {
            return `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`;
        }

        const tag = version.startsWith('v') ? version : `v${version}`;
        return `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/tags/${tag}`;
    }

    private parseReleaseNotes(body: string, version: string, url: string): ParsedReleaseNotes {
        console.log(`[ReleaseNotesManager] Parsing body for ${version}. Length: ${body.length}`);

        const sections: ReleaseNoteSection[] = [];
        let summary = "";

        const normalizedBody = body.replace(/\r\n/g, "\n");
        const headingMatches = [...normalizedBody.matchAll(/^#{2,3}\s+(.+)$/gm)];

        for (let i = 0; i < headingMatches.length; i++) {
            const match = headingMatches[i];
            const nextMatch = headingMatches[i + 1];
            const title = this.normalizeHeadingTitle(match[1]);
            if (!title) continue;

            const contentStart = (match.index ?? 0) + match[0].length;
            const contentEnd = nextMatch?.index ?? normalizedBody.length;
            const content = normalizedBody.slice(contentStart, contentEnd).trim();
            const contentLines = content.split('\n');

            if (title === 'Summary') {
                summary = content.replace(/\n/g, ' ').trim();
                console.log(`[ReleaseNotesManager] Found Summary: "${summary.substring(0, 50)}..."`);
                continue;
            }

            if (!RELEASE_NOTE_BULLET_SECTIONS.has(title)) continue;

            const items = contentLines
                .map((line) => line.trim())
                .filter((line) => line.startsWith('- ') || line.startsWith('* '))
                .map((line) => line.substring(2).trim())
                .filter(Boolean);

            if (items.length > 0) {
                sections.push({ title, items });
                console.log(`[ReleaseNotesManager] Found Section: "${title}" (${items.length} items)`);
            } else {
                console.warn(`[ReleaseNotesManager] Section "${title}" found but no valid bullet points extracted.`);
            }
        }

        return {
            version,
            summary,
            sections,
            fullBody: body,
            url
        };
    }

    private normalizeHeadingTitle(rawTitle: string): string | null {
        const normalized = rawTitle
            .replace(/^\s*[^\p{L}\p{N}'’]+/u, '')
            .replace(/[*_`#]/g, '')
            .replace(/[’]/g, "'")
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();

        if (!normalized) return null;
        if (normalized === 'summary') return 'Summary';
        if (normalized.includes("what's new") || normalized.includes('whats new')) return "What's New";
        if (normalized.includes('technical')) return 'Technical';
        if (normalized.includes('improvement')) return 'Improvements';
        if (normalized.includes('fix')) return 'Fixes';
        return null;
    }

    private makeRequest(url: string): Promise<string | null> {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value: string | null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve(value);
            };

            const request = net.request(url);
            const timeout = setTimeout(() => {
                console.warn(`[ReleaseNotesManager] Request timed out for ${url}`);
                request.abort();
                finish(null);
            }, GITHUB_REQUEST_TIMEOUT_MS);

            request.on('response', (response) => {
                if (response.statusCode !== 200) {
                    console.warn(`[ReleaseNotesManager] HTTP ${response.statusCode} for ${url}`);
                    finish(null);
                    return;
                }

                let responseBody = '';
                response.on('data', (chunk) => {
                    responseBody += chunk.toString();
                });

                response.on('end', () => {
                    finish(responseBody);
                });

                response.on('error', (err) => {
                    console.error("[ReleaseNotesManager] Stream error:", err);
                    finish(null);
                });
            });

            request.on('error', (err) => {
                if (!settled) {
                    console.error("[ReleaseNotesManager] Request error:", err);
                }
                finish(null);
            });

            request.end();
        });
    }

    public getCachedNotes(): ParsedReleaseNotes | null {
        return this.cachedNotes;
    }
}
