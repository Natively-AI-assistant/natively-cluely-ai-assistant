import { vi } from 'vitest'

/**
 * Shared Electron mock factory for the test suite.
 *
 * Usage:
 *   vi.mock('electron', () => createElectronMock())
 *
 * Or with overrides:
 *   vi.mock('electron', () => createElectronMock({
 *     app: { getPath: vi.fn(() => '/custom/path') }
 *   }))
 */

export function createElectronMock(overrides: Record<string, any> = {}) {
  const app = {
    getPath: vi.fn(() => '/tmp/test'),
    getName: vi.fn(() => 'TestApp'),
    getVersion: vi.fn(() => '1.0.0'),
    getAppPath: vi.fn(() => '/tmp/test/app'),
    isReady: vi.fn(() => true),
    on: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    dock: {
      show: vi.fn(),
      hide: vi.fn(),
      setMenu: vi.fn(),
      bounce: vi.fn(),
    },
    ...overrides.app,
  }

  // Use vi.fn() as a real constructor — 'this' binding ensures 'new BrowserWindow()' works
  const BrowserWindow = vi.fn(function (this: Record<string, any>) {
    Object.assign(this, {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      close: vi.fn(),
      destroy: vi.fn(),
      focus: vi.fn(),
      blur: vi.fn(),
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      isMaximized: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      isVisible: vi.fn(() => true),
      setSize: vi.fn(),
      setPosition: vi.fn(),
      getContentSize: vi.fn(() => [800, 600]),
      setContentSize: vi.fn(),
      setBounds: vi.fn(),
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
      setAlwaysOnTop: vi.fn(),
      setSkipTaskbar: vi.fn(),
      setResizable: vi.fn(),
      setFullScreen: vi.fn(),
      webContents: {
        send: vi.fn(),
        on: vi.fn(),
        executeJavaScript: vi.fn(),
        openDevTools: vi.fn(),
        closeDevTools: vi.fn(),
        id: 1,
        getURL: vi.fn(() => ''),
        isLoading: vi.fn(() => false),
        reload: vi.fn(),
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
        goBack: vi.fn(),
        goForward: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        session: {
          defaultSession: {
            webRequest: { onBeforeRequest: vi.fn() },
          },
        },
      },
      on: vi.fn(),
      once: vi.fn(),
      ...overrides.browserWindowInstance,
    })
  })
  ;(BrowserWindow as any).getAllWindows = vi.fn(() => [])
  ;(BrowserWindow as any).fromWebContents = vi.fn(() => null)
  ;(BrowserWindow as any).fromId = vi.fn(() => null)
  ;(BrowserWindow as any).getFocusedWindow = vi.fn(() => null)
  ;(BrowserWindow as any).addDevToolsExtension = vi.fn()
  ;(BrowserWindow as any).removeDevToolsExtension = vi.fn()
  // Merge any static overrides
  if (overrides.BrowserWindow) {
    Object.assign(BrowserWindow, overrides.BrowserWindow)
  }

  const ipcMain = {
    handle: vi.fn(),
    handleOnce: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
    ...overrides.ipcMain,
  }

  const globalShortcut = {
    register: vi.fn(),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(() => false),
    ...overrides.globalShortcut,
  }

  const Menu = {
    buildFromTemplate: vi.fn(() => ({
      popup: vi.fn(),
      append: vi.fn(),
      insert: vi.fn(),
      items: [],
    })),
    setApplicationMenu: vi.fn(),
    getApplicationMenu: vi.fn(() => null),
    ...overrides.Menu,
  }

  const shell = {
    openExternal: vi.fn(() => Promise.resolve()),
    trashItem: vi.fn(() => Promise.resolve()),
    openPath: vi.fn(() => Promise.resolve('')),
    beep: vi.fn(),
    moveItemToTrash: vi.fn(),
    writeShortcutLink: vi.fn(),
    readShortcutLink: vi.fn(),
    ...overrides.shell,
  }

  const dialog = {
    showOpenDialog: vi.fn(() =>
      Promise.resolve({ canceled: false, filePaths: [] }),
    ),
    showSaveDialog: vi.fn(() =>
      Promise.resolve({ canceled: false, filePath: '' }),
    ),
    showMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
    showErrorBox: vi.fn(),
    showCertificateTrustDialog: vi.fn(),
    ...overrides.dialog,
  }

  const screen = {
    getAllDisplays: vi.fn(() => []),
    getPrimaryDisplay: vi.fn(() => ({
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
      workAreaSize: { width: 1920, height: 1040 },
      scaleFactor: 1,
      rotation: 0,
      touchSupport: 'unknown',
      monochrome: false,
      accelerometerSupport: 'unknown',
      colorSpace: '',
      colorDepth: 24,
      depthPerComponent: 8,
      displayFrequency: 60,
      internal: false,
      label: 'Test Display',
      nativeOrigin: { x: 0, y: 0 },
    })),
    getDisplayNearestPoint: vi.fn(() => ({
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
    getDisplayMatching: vi.fn(() => ({
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    on: vi.fn(),
    ...overrides.screen,
  }

  const powerMonitor = {
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
    isOnBatteryPower: vi.fn(() => false),
    ...overrides.powerMonitor,
  }

  const nativeImage = {
    createFromPath: vi.fn(() => ({
      toPNG: vi.fn(() => Buffer.from('')),
      toJPEG: vi.fn(() => Buffer.from('')),
      toBitmap: vi.fn(() => Buffer.from('')),
      toDataURL: vi.fn(() => ''),
      getSize: vi.fn(() => ({ width: 0, height: 0 })),
      isEmpty: vi.fn(() => true),
      resize: vi.fn(),
      crop: vi.fn(),
    })),
    createFromBuffer: vi.fn(() => ({
      toPNG: vi.fn(() => Buffer.from('')),
      toJPEG: vi.fn(() => Buffer.from('')),
      toBitmap: vi.fn(() => Buffer.from('')),
      toDataURL: vi.fn(() => ''),
      getSize: vi.fn(() => ({ width: 0, height: 0 })),
      isEmpty: vi.fn(() => true),
      resize: vi.fn(),
      crop: vi.fn(),
    })),
    createEmpty: vi.fn(() => ({
      toPNG: vi.fn(() => Buffer.from('')),
      toJPEG: vi.fn(() => Buffer.from('')),
      toBitmap: vi.fn(() => Buffer.from('')),
      toDataURL: vi.fn(() => ''),
      getSize: vi.fn(() => ({ width: 0, height: 0 })),
      isEmpty: vi.fn(() => true),
      resize: vi.fn(),
      crop: vi.fn(),
    })),
    ...overrides.nativeImage,
  }

  const contextBridge = {
    exposeInMainWorld: vi.fn(),
    ...overrides.contextBridge,
  }

  const ipcRenderer = {
    invoke: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    once: vi.fn(),
    send: vi.fn(),
    sendSync: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
    postMessage: vi.fn(),
    ...overrides.ipcRenderer,
  }

  const safeStorage = {
    encryptString: vi.fn(() => Buffer.from('')),
    decryptString: vi.fn(() => ''),
    isEncryptionAvailable: vi.fn(() => true),
    ...overrides.safeStorage,
  }

  const net = {
    request: vi.fn(() => ({
      on: vi.fn(),
      end: vi.fn(),
      write: vi.fn(),
      abort: vi.fn(),
    })),
    ...overrides.net,
  }

  const desktopCapturer = {
    getSources: vi.fn(() => Promise.resolve([])),
    ...overrides.desktopCapturer,
  }

  const systemPreferences = {
    getMediaAccessStatus: vi.fn(() => 'granted'),
    askForMediaAccess: vi.fn(() => Promise.resolve(true)),
    isDarkMode: vi.fn(() => false),
    on: vi.fn(),
    ...overrides.systemPreferences,
  }

  const nativeTheme = {
    shouldUseDarkColors: vi.fn(() => false),
    shouldUseHighContrastColors: vi.fn(() => false),
    shouldUseInvertedColorScheme: vi.fn(() => false),
    themeSource: 'system' as const,
    on: vi.fn(),
    ...overrides.nativeTheme,
  }

  const Tray = vi.fn(function (this: Record<string, any>) {
    Object.assign(this, {
      setContextMenu: vi.fn(),
      setToolTip: vi.fn(),
      setImage: vi.fn(),
      setTitle: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn(),
      ...overrides.trayInstance,
    })
  })

  return {
    app,
    BrowserWindow,
    ipcMain,
    globalShortcut,
    Menu,
    shell,
    dialog,
    screen,
    powerMonitor,
    nativeImage,
    contextBridge,
    ipcRenderer,
    safeStorage,
    net,
    desktopCapturer,
    systemPreferences,
    nativeTheme,
    Tray,
  }
}

/**
 * Recursively collects all vi.fn() instances from an object tree.
 */
function collectMockFns(
  obj: unknown,
  visited = new Set(),
): Array<{ owner: any; key: string }> {
  if (!obj || typeof obj !== 'object' || visited.has(obj)) return []
  visited.add(obj)

  const fns: Array<{ owner: any; key: string }> = []
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const value = (obj as Record<string, unknown>)[key]
    if (typeof value === 'function' && 'mockClear' in value) {
      fns.push({ owner: obj, key })
    } else if (value && typeof value === 'object') {
      fns.push(...collectMockFns(value, visited))
    }
  }
  return fns
}

/**
 * Clears all vi.fn() call history on every mock in the electron mock object.
 * Call this in beforeEach/afterEach to reset state between tests.
 */
export function resetElectronMock(mock: ReturnType<typeof createElectronMock>) {
  const fns = collectMockFns(mock)
  for (const { owner, key } of fns) {
    ;(owner[key] as ReturnType<typeof vi.fn>).mockClear()
  }
}
