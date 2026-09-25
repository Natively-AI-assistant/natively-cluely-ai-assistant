// The process/app name each disguise mode presents (Activity Monitor / Task
// Manager via process.title, the macOS menu via app.setName).
//
// One source for two callers: AppState._applyDisguise and the undetectable
// startup path in main.ts, which must write the SAME title before hiding the
// macOS Dock tile (see utils/macDockPolicy.ts — a title write after the hide
// re-shows the tile). The trailing spaces are deliberate and long-standing;
// keep them. Pure module, platform injectable.

export type DisguiseModeName = 'terminal' | 'settings' | 'activity' | 'none';

export function disguiseAppName(mode: DisguiseModeName, platform: NodeJS.Platform): string {
  const isWin = platform === 'win32';
  switch (mode) {
    case 'terminal':
      return isWin ? 'Command Prompt ' : 'Terminal ';
    case 'settings':
      return isWin ? 'Settings ' : 'System Settings ';
    case 'activity':
      return isWin ? 'Task Manager ' : 'Activity Monitor ';
    case 'none':
    default:
      return 'Natively';
  }
}
