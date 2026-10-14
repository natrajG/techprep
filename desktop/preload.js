const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  audioSource: process.env.PULSE_SOURCE || "default microphone",
  setAlwaysOnTop: (on) => ipcRenderer.invoke("set-always-on-top", on),
  initializeContentProtection: (preference) => ipcRenderer.invoke("initialize-content-protection", preference),
  getContentProtection: () => ipcRenderer.invoke("get-content-protection"),
  setContentProtection: (enabled) => ipcRenderer.invoke("set-content-protection", enabled),
  loginSucceeded: () => ipcRenderer.invoke("login-succeeded"),
  signOut: () => ipcRenderer.invoke("sign-out"),
  minimize: () => ipcRenderer.invoke("minimize"),
  close: () => ipcRenderer.invoke("close"),
});
