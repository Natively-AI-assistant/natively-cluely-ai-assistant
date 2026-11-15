// The demo film's address, alone so main can read it too (the first-run guide
// opens it at its first meeting: electron/ipcHandlers.ts) without pulling in
// the renderer's openDemoVideo (src/lib/demoVideo.ts).
export const DEMO_VIDEO_URL = 'https://youtu.be/Ha_ZiwG5Kwc';
