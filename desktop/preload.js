const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("folioWindowsAPI", {
  // Native Notifications
  sendNotification: (title, body, actions) => {
    ipcRenderer.send("native-notify", { title, body, actions });
  },

  // Window Controls
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),

  // Windows Badge (shows pending task count on Windows Taskbar icon)
  setBadgeCount: (count) => ipcRenderer.send("set-badge-count", count),

  // Auto-launch at Windows Startup
  setLaunchOnStartup: (enabled) => ipcRenderer.send("set-startup", enabled),
  getLaunchOnStartup: () => ipcRenderer.invoke("get-startup"),

  // Listeners from Windows OS
  onQuickAddTriggered: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("quick-add-shortcut", listener);
    return () => ipcRenderer.removeListener("quick-add-shortcut", listener);
  },
});