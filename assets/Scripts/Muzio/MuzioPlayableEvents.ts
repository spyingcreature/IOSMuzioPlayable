export const MuzioPlayableEvent = {
    MOOD_SELECTED: 'muzio:mood-selected',
    SONG_ADDED: 'muzio:song-added',
    PLAYLIST_READY: 'muzio:playlist-ready',
    PLAYLIST_GENERATED: 'muzio:playlist-generated',
} as const;

export type MuzioMood = 'Relax' | 'Energy' | 'Focus';

export interface MoodSelectedPayload {
    mood: MuzioMood;
}

export interface SongAddedPayload {
    songId: string;
    mood: MuzioMood;
    count: number;
    requiredCount: number;
}

export interface PlaylistReadyPayload {
    mood: MuzioMood;
    songIds: string[];
}

export function normalizeMuzioMood(value: string): MuzioMood | null {
    switch ((value ?? '').trim().toLowerCase()) {
        case 'relax':
            return 'Relax';
        case 'energy':
            return 'Energy';
        case 'focus':
            return 'Focus';
        default:
            return null;
    }
}
