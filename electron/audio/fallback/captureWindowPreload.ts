// Preload for the hidden audio capture window (captureHost.ts). Exposes only
// the two channels the page needs: commands in, capture events out. Sandboxed:
// electron's contextBridge and ipcRenderer only.
import { contextBridge, ipcRenderer } from 'electron';
import { CAPTURE_COMMAND_CHANNEL, CAPTURE_EVENT_CHANNEL } from './captureChannels';

contextBridge.exposeInMainWorld('nativelyCapture', {
  onCommand(callback: (command: unknown) => void): void {
    ipcRenderer.on(CAPTURE_COMMAND_CHANNEL, (_event, command) => callback(command));
  },
  emit(event: unknown): void {
    ipcRenderer.send(CAPTURE_EVENT_CHANNEL, event);
  },
});
