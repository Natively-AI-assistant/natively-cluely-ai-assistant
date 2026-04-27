import { describe, expect, it, vi } from 'vitest'
import { createElectronMock, resetElectronMock } from './electron.mock'

describe('createElectronMock', () => {
  it('returns object with all required electron APIs', () => {
    const mock = createElectronMock()

    const requiredApis = [
      'app',
      'BrowserWindow',
      'ipcMain',
      'globalShortcut',
      'Menu',
      'shell',
      'dialog',
      'screen',
      'powerMonitor',
      'nativeImage',
    ]

    for (const api of requiredApis) {
      expect(mock).toHaveProperty(api)
    }
  })

  it('returns object with additional electron APIs used in the codebase', () => {
    const mock = createElectronMock()

    const additionalApis = [
      'contextBridge',
      'ipcRenderer',
      'safeStorage',
      'net',
      'desktopCapturer',
      'systemPreferences',
      'nativeTheme',
      'Tray',
    ]

    for (const api of additionalApis) {
      expect(mock).toHaveProperty(api)
    }
  })

  it('each app method is a vi.fn() that can be spied on', () => {
    const mock = createElectronMock()

    // Verify all app methods are vi.fn()
    expect(vi.isMockFunction(mock.app.getPath)).toBe(true)
    expect(vi.isMockFunction(mock.app.getName)).toBe(true)
    expect(vi.isMockFunction(mock.app.getVersion)).toBe(true)
    expect(vi.isMockFunction(mock.app.getAppPath)).toBe(true)
    expect(vi.isMockFunction(mock.app.isReady)).toBe(true)
    expect(vi.isMockFunction(mock.app.on)).toBe(true)
    expect(vi.isMockFunction(mock.app.quit)).toBe(true)

    // Verify spy tracking works
    mock.app.getPath('userData')
    expect(mock.app.getPath).toHaveBeenCalledWith('userData')
  })

  it('each ipcMain method is a vi.fn()', () => {
    const mock = createElectronMock()

    expect(vi.isMockFunction(mock.ipcMain.handle)).toBe(true)
    expect(vi.isMockFunction(mock.ipcMain.on)).toBe(true)
    expect(vi.isMockFunction(mock.ipcMain.removeHandler)).toBe(true)
    expect(vi.isMockFunction(mock.ipcMain.removeAllListeners)).toBe(true)
  })

  it('each globalShortcut method is a vi.fn()', () => {
    const mock = createElectronMock()

    expect(vi.isMockFunction(mock.globalShortcut.register)).toBe(true)
    expect(vi.isMockFunction(mock.globalShortcut.unregister)).toBe(true)
    expect(vi.isMockFunction(mock.globalShortcut.unregisterAll)).toBe(true)
    expect(vi.isMockFunction(mock.globalShortcut.isRegistered)).toBe(true)
  })

  it('each dialog method is a vi.fn()', () => {
    const mock = createElectronMock()

    expect(vi.isMockFunction(mock.dialog.showOpenDialog)).toBe(true)
    expect(vi.isMockFunction(mock.dialog.showSaveDialog)).toBe(true)
    expect(vi.isMockFunction(mock.dialog.showMessageBox)).toBe(true)
  })

  it('each shell method is a vi.fn()', () => {
    const mock = createElectronMock()

    expect(vi.isMockFunction(mock.shell.openExternal)).toBe(true)
    expect(vi.isMockFunction(mock.shell.trashItem)).toBe(true)
    expect(vi.isMockFunction(mock.shell.openPath)).toBe(true)
  })

  it('each ipcRenderer method is a vi.fn()', () => {
    const mock = createElectronMock()

    expect(vi.isMockFunction(mock.ipcRenderer.invoke)).toBe(true)
    expect(vi.isMockFunction(mock.ipcRenderer.on)).toBe(true)
    expect(vi.isMockFunction(mock.ipcRenderer.send)).toBe(true)
    expect(vi.isMockFunction(mock.ipcRenderer.removeListener)).toBe(true)
    expect(vi.isMockFunction(mock.ipcRenderer.removeAllListeners)).toBe(true)
  })

  it('provides sensible defaults', () => {
    const mock = createElectronMock()

    expect(mock.app.getPath('userData')).toBe('/tmp/test')
    expect(mock.app.getName()).toBe('TestApp')
    expect(mock.app.getVersion()).toBe('1.0.0')
    expect(mock.app.isReady()).toBe(true)
    expect(mock.BrowserWindow.getAllWindows()).toEqual([])
    expect(mock.globalShortcut.isRegistered('Ctrl+A')).toBe(false)
    expect(mock.powerMonitor.isOnBatteryPower()).toBe(false)
    expect(mock.safeStorage.isEncryptionAvailable()).toBe(true)
  })

  it('merges overrides into default mock', () => {
    const mock = createElectronMock({
      app: {
        getPath: vi.fn(() => '/custom/path'),
      },
    })

    expect(mock.app.getPath()).toBe('/custom/path')
    // Non-overridden app methods still work
    expect(mock.app.getName()).toBe('TestApp')
    // Other top-level APIs still present
    expect(mock).toHaveProperty('ipcMain')
    expect(mock).toHaveProperty('globalShortcut')
  })

  it('merges BrowserWindow static overrides', () => {
    const mock = createElectronMock({
      BrowserWindow: {
        getAllWindows: vi.fn(() => [1, 2, 3]),
      },
    })

    expect(mock.BrowserWindow.getAllWindows()).toEqual([1, 2, 3])
    // Constructor still works
    const win = new mock.BrowserWindow()
    expect(vi.isMockFunction(win.show)).toBe(true)
  })

  it('resetElectronMock() clears all mock call history', () => {
    const mock = createElectronMock()

    // Call some methods to register calls
    mock.app.getPath('userData')
    mock.app.getName()
    mock.ipcMain.handle('test', vi.fn())
    mock.ipcRenderer.invoke('test')
    mock.shell.openExternal('https://example.com')
    mock.dialog.showMessageBox({ message: 'hi' })

    // Verify calls are registered
    expect(mock.app.getPath).toHaveBeenCalledTimes(1)
    expect(mock.app.getName).toHaveBeenCalledTimes(1)
    expect(mock.ipcMain.handle).toHaveBeenCalledTimes(1)

    // Reset
    resetElectronMock(mock)

    // All calls are cleared
    expect(mock.app.getPath).toHaveBeenCalledTimes(0)
    expect(mock.app.getName).toHaveBeenCalledTimes(0)
    expect(mock.ipcMain.handle).toHaveBeenCalledTimes(0)
    expect(mock.ipcRenderer.invoke).toHaveBeenCalledTimes(0)
    expect(mock.shell.openExternal).toHaveBeenCalledTimes(0)
    expect(mock.dialog.showMessageBox).toHaveBeenCalledTimes(0)
  })

  it('resetElectronMock() clears deeply nested mocks', () => {
    const mock = createElectronMock()

    mock.nativeImage.createFromPath('/test.png')
    mock.powerMonitor.on('suspend', vi.fn())
    mock.screen.getAllDisplays()

    expect(mock.nativeImage.createFromPath).toHaveBeenCalledTimes(1)

    resetElectronMock(mock)

    expect(mock.nativeImage.createFromPath).toHaveBeenCalledTimes(0)
    expect(mock.powerMonitor.on).toHaveBeenCalledTimes(0)
    expect(mock.screen.getAllDisplays).toHaveBeenCalledTimes(0)
  })

  it('factory returns valid shape for vi.mock() module mock', () => {
    // Simulate what vi.mock('electron', () => createElectronMock()) does:
    // The factory must return an object whose properties are importable as named exports.
    const mock = createElectronMock()

    // Named imports from electron: { app, BrowserWindow, ipcMain, ... }
    const {
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
    } = mock

    // Each must be an object or function (BrowserWindow/Tray are constructors)
    expect(typeof app).toBe('object')
    expect(typeof BrowserWindow).toBe('function')
    expect(typeof ipcMain).toBe('object')
    expect(typeof globalShortcut).toBe('object')
    expect(typeof Menu).toBe('object')
    expect(typeof shell).toBe('object')
    expect(typeof dialog).toBe('object')
    expect(typeof screen).toBe('object')
    expect(typeof powerMonitor).toBe('object')
    expect(typeof nativeImage).toBe('object')
    expect(typeof contextBridge).toBe('object')
    expect(typeof ipcRenderer).toBe('object')

    // BrowserWindow should be usable as a constructor
    const win = new BrowserWindow({ width: 800, height: 600 })
    expect(vi.isMockFunction(win.show)).toBe(true)
    expect(vi.isMockFunction(win.webContents.send)).toBe(true)
  })
})
