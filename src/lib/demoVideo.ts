// The full setup & demo film on the Natively YouTube channel (8:57).
//
// Linked from the Welcome screen, from Settings › Setup & Help and from its own
// launcher card (src/components/onboarding/DemoVideoToaster.tsx). It opens in
// the user's browser through electronAPI.openExternal (https only, on macOS and
// Windows alike), never embedded: an embedded player would need YouTube let
// through the renderer and would play inside a window that can be hidden from
// screen share. The thumbnail ships in src/assets so nothing loads from YouTube
// until the user asks for the video.
export const DEMO_VIDEO_URL = 'https://youtu.be/Ha_ZiwG5Kwc';

/**
 * Open the film from a link outside its card (Welcome, Setup & Help). Once it
 * has opened, the card is retired in the card ledger: someone who has watched
 * it is not asked to watch it again. The card itself reports through the
 * toaster host instead.
 */
export async function openDemoVideo(): Promise<void> {
    try {
        const opened = (await window.electronAPI?.openExternal?.(DEMO_VIDEO_URL))?.ok === true;
        if (opened) await window.electronAPI?.cardsRecord?.('demo_video', 'acted');
    } catch {
        // The browser did not open, or the ledger was unavailable: nothing to retire.
    }
}
