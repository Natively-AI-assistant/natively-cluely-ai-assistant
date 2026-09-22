/// <reference types="vite/client" />
import { ElectronAPI } from './types/electron';

interface ImportMetaEnv {
    readonly VITE_APP_VERSION?: string;
    readonly VITE_BUILD_COMMIT?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

interface Window {
    electronAPI: ElectronAPI
}
