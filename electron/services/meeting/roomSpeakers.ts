/**
 * People sharing the user's microphone (a meeting room, a laptop on the table)
 * told apart at save time, from the transcription provider's own voice ids.
 *
 * Natively's two channels are "the mic is me, the system audio is them". That
 * holds for a headset, not for a room: everyone around the laptop lands on
 * the mic channel and the notes credit all of it to "Me". With the room
 * setting on, the mic channel is transcribed with provider diarization
 * (Deepgram, Soniox or Google: audio/sttDiarization.ts), so each mic line
 * carries a provider voice id. This turns those ids into speakers:
 *
 *   - the voice with the most words on the mic channel is the user and stays
 *     "Me" (the user is the one who started the recording and usually talks
 *     the most into their own machine);
 *   - every other voice that is clearly a person — at least MIN_SHARE of the
 *     mic channel's words AND at least MIN_LINES lines — becomes its own
 *     "Speaker N", numbered past every id already in use (the remote people
 *     named from the call's roster), so two people never share a number;
 *   - a voice under those thresholds is diarization flicker, not a person, and
 *     folds back into "Me"; so does every line without a voice id.
 *
 * Providers number voices afresh on every connection (a reconnect), so an id
 * may carry the connection it came from, `speaker_2@3`, and each connection
 * is its own window. Voices cannot be matched from one window to the next:
 * word counts cannot tell who is who (a colleague may talk most after a
 * reconnect), and guessing would put the user's own words under someone
 * else's name. So only the largest window, by words on the mic, is split; the
 * lines of every other window stay the user's, as they were before this
 * setting existed. Reconnects are rare, so that window is nearly always most
 * of the meeting. With a single window this is exactly the rule above.
 *
 * Pure and deterministic: no model call, no audio, no platform branches. The
 * live transcript is untouched (this runs at save), so there is no latency
 * cost; only the saved transcript and the notes see the split.
 */

import { parseVoiceId } from '../../audio/sttDiarization';

export interface RoomLineLike {
    speaker: string;
    text: string;
    speakerId?: string;
}

export interface RoomSplitOptions {
    /** Speaker ids already taken (the call's named people), never reused here. */
    usedIds?: Iterable<string>;
    /** A voice must carry this share of the mic channel's words to be a person. */
    minShare?: number;
    /** …and have said at least this many lines. */
    minLines?: number;
}

export interface RoomSplit<T> {
    transcript: T[];
    /** Line index → the new speaker name, for a parallel copy (the notes' named transcript). */
    renamed: Map<number, string>;
    /** How many extra people were found on the mic channel. */
    voices: number;
}

export const ROOM_MIN_SHARE = 0.15;
export const ROOM_MIN_LINES = 3;

const MIC = /^(user|me)$/i;
const words = (t: string) => (t.match(/\S+/g) ?? []).length;

/** The next free "Speaker N" number, past every id in use. */
export function nextSpeakerNumber(used: Set<string>, from = 2): number {
    let n = from;
    while (used.has(`speaker_${n}`)) n++;
    return n;
}

export function splitRoomSpeakers<T extends RoomLineLike>(lines: T[], opts: RoomSplitOptions = {}): RoomSplit<T> {
    const minShare = opts.minShare ?? ROOM_MIN_SHARE;
    const minLines = opts.minLines ?? ROOM_MIN_LINES;
    const renamed = new Map<number, string>();
    const unchanged = (): RoomSplit<T> => ({ transcript: lines, renamed, voices: 0 });

    // Words and lines per provider voice on the mic channel.
    const perVoice = new Map<string, { words: number; lines: number }>();
    let total = 0;
    lines.forEach((l) => {
        if (!MIC.test(l.speaker) || !l.speakerId) return;
        const w = words(l.text);
        const v = perVoice.get(l.speakerId) ?? { words: 0, lines: 0 };
        v.words += w; v.lines += 1;
        perVoice.set(l.speakerId, v);
        total += w;
    });
    if (perVoice.size < 2 || total === 0) return unchanged();

    // Only the largest connection window is split (see the header); a tie goes
    // to the earlier connection.
    const windowWords = new Map<string, number>();
    for (const [id, v] of perVoice) {
        const { epoch } = parseVoiceId(id);
        windowWords.set(epoch, (windowWords.get(epoch) ?? 0) + v.words);
    }
    const [main, windowTotal] = [...windowWords.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }))[0];
    const voices = [...perVoice.entries()]
        .filter(([id]) => parseVoiceId(id).epoch === main)
        .sort((a, b) => b[1].words - a[1].words || a[0].localeCompare(b[0]));
    if (voices.length < 2 || windowTotal === 0) return unchanged();
    const dominant = voices[0][0];

    // Ids in use: the caller's, plus any speaker_N already on a line.
    const used = new Set<string>(opts.usedIds ?? []);
    for (const l of lines) if (l.speakerId && /^speaker_\d+$/.test(l.speakerId) && !MIC.test(l.speaker)) used.add(l.speakerId);

    const nameFor = new Map<string, string>();
    for (const [id, v] of voices) {
        if (id === dominant) continue;
        if (v.words / windowTotal < minShare || v.lines < minLines) continue;
        const n = nextSpeakerNumber(used);
        used.add(`speaker_${n}`);
        nameFor.set(id, `Speaker ${n}`);
    }
    if (nameFor.size === 0) return unchanged();

    const transcript = lines.map((l, i) => {
        if (!MIC.test(l.speaker)) return l;
        const name = l.speakerId ? nameFor.get(l.speakerId) : undefined;
        // The provider's voice id has done its work; it is not a call id and is not kept.
        const { speakerId: _voice, ...rest } = l as T & { speakerId?: string };
        if (!name) return rest as T;
        renamed.set(i, name);
        return { ...rest, speaker: name } as T;
    });
    return { transcript, renamed, voices: nameFor.size };
}
