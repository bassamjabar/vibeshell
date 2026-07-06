// Transport-agnostic IPC registry.
//
// The desktop app (Electron) and the VS Code extension host register the
// SAME feature handlers here. Each platform then supplies its own services
// (storage location, native folder picker) and its own way to invoke the
// handlers — Electron through ipcMain, VS Code through webview messaging.
//
// This is what lets main/agent.js, tools.js, projects.js, chats.js and
// settings.js run unchanged in both worlds.

let electronIpcMain = null;
const handlers = new Map();

const services = {
  userDataPath: null,            // string — where JSON state is kept
  pickFolder: async () => null,  // ({title, buttonLabel}) => absolute path | null
};

// Register a request handler. In Electron it is also wired to ipcMain so the
// desktop preload keeps working; in VS Code the host dispatches from the map.
function handle(channel, fn) {
  handlers.set(channel, fn);
  if (electronIpcMain) electronIpcMain.handle(channel, fn);
}

function get(channel) {
  return handlers.get(channel);
}

// Platform wiring, called once at startup before the register*Handlers().
function useElectron(ipcMain) {
  electronIpcMain = ipcMain;
}

function setServices(next) {
  Object.assign(services, next);
}

module.exports = {
  handle,
  get,
  useElectron,
  setServices,
  userDataPath: () => services.userDataPath,
  pickFolder: (opts) => services.pickFolder(opts || {}),
};
