import Store from 'electron-store';
import crypto from 'crypto';

interface DonationState {
    hasDonated: boolean;
    lastShownAt: number | null;
    lifetimeShows: number;
}


export class DonationManager {
    private static instance: DonationManager;
    private store: Store<DonationState>;

    // Constants
    private readonly MAX_LIFETIME_SHOWS = 5;
    private readonly DAYS_INTERVAL = 21;

    private constructor() {
        this.store = new Store<DonationState>({
            name: 'natively-preferences-secure', // Different file than main config
            defaults: {
                hasDonated: false,
                lastShownAt: null,
                lifetimeShows: 0
            },
            // Encryption in v8 worked fine, keeping it for "obvious tampering" protection
            encryptionKey: 'natively-secure-storage-key'
        });
    }

    public static getInstance(): DonationManager {
        if (!DonationManager.instance) {
            DonationManager.instance = new DonationManager();
        }
        return DonationManager.instance;
    }

    public getDonationState(): DonationState {
        return {
            hasDonated: this.store.get('hasDonated'),
            lastShownAt: this.store.get('lastShownAt'),
            lifetimeShows: this.store.get('lifetimeShows')
        };
    }

    public shouldShowToaster(): boolean {
        const state = this.getDonationState();

        // 1. If already donated, never show
        if (state.hasDonated) return false;

        // 2. If exceeded max shows, never show
        if (state.lifetimeShows >= this.MAX_LIFETIME_SHOWS) return false;

        // 3. Check time interval
        if (state.lastShownAt === null) {
            // First time ever? Show it
            return true;
        }

        const now = Date.now();
        const daysSinceLastShow = (now - state.lastShownAt) / (1000 * 60 * 60 * 24);

        return daysSinceLastShow >= this.DAYS_INTERVAL;
    }

    public markAsShown(): void {
        const state = this.getDonationState();
        this.store.set({
            hasDonated: state.hasDonated, // Preserve existing
            lastShownAt: Date.now(),
            lifetimeShows: state.lifetimeShows + 1
        });
        console.log('[DonationManager] Toaster shown. Count:', state.lifetimeShows + 1);
    }

    public setHasDonated(status: boolean): void {
        this.store.set('hasDonated', status);
    }
}
