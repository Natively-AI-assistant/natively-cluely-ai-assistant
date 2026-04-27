/**
 * Barrel export for IPC handlers.
 * Registers all handler groups with AppState.
 */

import { AppState } from '../main';
import { registerLicenseHandlers } from './ipcHandlers.license';
import { registerSettingsHandlers } from './ipcHandlers.settings';
import { registerMeetingHandlers } from './ipcHandlers.meeting';
import { registerAudioHandlers } from './ipcHandlers.audio';
import { registerLLMHandlers } from './ipcHandlers.llm';
import { registerRAGHandlers } from './ipcHandlers.rag';
import { registerUpdateHandlers } from './ipcHandlers.updates';
import { registerThemeHandlers } from './ipcHandlers.theme';
import { registerProfileHandlers } from './ipcHandlers.profile';
import { registerModesHandlers } from './ipcHandlers.modes';
import { registerSystemHandlers } from './ipcHandlers.system';

/**
 * Registers all IPC handlers with the given AppState instance.
 * Called during app initialization.
 */
export function registerAllHandlers(appState: AppState): void {
  registerLicenseHandlers(appState);
  registerSettingsHandlers(appState);
  registerMeetingHandlers(appState);
  registerAudioHandlers(appState);
  registerLLMHandlers(appState);
  registerRAGHandlers(appState);
  registerUpdateHandlers(appState);
  registerThemeHandlers(appState);
  registerProfileHandlers(appState);
  registerModesHandlers(appState);
  registerSystemHandlers(appState);
}
