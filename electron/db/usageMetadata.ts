/*
 * ai_interactions.metadata_json, read and written in one place.
 *
 * It used to hold only a bare JSON array (a usage entry's `items`, or a
 * follow-up-questions answer array). An entry with screenshot previews needs a
 * second field, so those rows store an object: { items?, images? }. Rows without
 * previews keep the bare-array form, so everything already saved reads as before.
 */

const isPreviewUrl = (value: unknown): value is string =>
    typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(value);

/** The metadata_json to store for a usage entry, or null for none. */
export function encodeUsageMetadata(usage: { type?: string; answer?: unknown; items?: unknown; images?: unknown }): string | null {
    let items: unknown[] | undefined;
    if (Array.isArray(usage.items)) items = usage.items;
    else if (usage.type === 'followup_questions' && Array.isArray(usage.answer)) items = usage.answer;
    const images = Array.isArray(usage.images) ? usage.images.filter(isPreviewUrl) : [];
    if (images.length > 0) return JSON.stringify(items ? { items, images } : { images });
    return items ? JSON.stringify(items) : null;
}

/** Reads either form back. Anything unexpected yields no items and no images. */
export function decodeUsageMetadata(json: string | null | undefined): { items?: string[]; images?: string[] } {
    if (!json) return {};
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { return {}; }
    if (Array.isArray(parsed)) return { items: parsed };
    if (!parsed || typeof parsed !== 'object') return {};
    const obj = parsed as { items?: unknown; images?: unknown };
    const out: { items?: string[]; images?: string[] } = {};
    if (Array.isArray(obj.items)) out.items = obj.items;
    if (Array.isArray(obj.images)) {
        const images = obj.images.filter(isPreviewUrl);
        if (images.length > 0) out.images = images;
    }
    return out;
}
