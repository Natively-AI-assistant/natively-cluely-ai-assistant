export function decideLauncherClose(input: {
  platform: string;
  isDev: boolean;
  quitting: boolean;
  hasTray: boolean;
}): 'close' | 'hide' | 'quit';
