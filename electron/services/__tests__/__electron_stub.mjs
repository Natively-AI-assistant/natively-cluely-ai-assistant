// Minimal 'electron' stand-in for unit tests that import main-process modules
// needing only app.isPackaged / app.getAppPath(). Keeps those tests runnable
// under plain `node --test`, with no Electron runtime.
export const app = {
  isPackaged: false,
  getAppPath: () => '/fake/app',
};
export default { app };
