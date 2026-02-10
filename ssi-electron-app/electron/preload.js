// preload.js (Electron) — “ponte segura” entre o Renderer (UI) e o Main Process: usando `contextBridge` com
// `contextIsolation` habilitado, expõe no `window` apenas a API mínima `window.ssiApi`, evitando liberar Node.js
// diretamente na UI. Cada método da API encaminha chamadas para o backend via IPC assíncrono (`ipcRenderer.invoke`),
// usando canais "ssi:*" (ex.: "ssi:testConnection", "ssi:issueCredential"), e retorna Promises com os resultados
// produzidos pelos handlers `ipcMain.handle(...)` definidos no processo principal.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ssiApi", {
  testConnection: (cfg) => ipcRenderer.invoke("ssi:testConnection", cfg),
  createDidAndRegister: (cfg) => ipcRenderer.invoke("ssi:createDidAndRegister", cfg),
  createSchema: (cfg, schema) => ipcRenderer.invoke("ssi:createSchema", cfg, schema),
  createCredDef: (cfg, credDef) => ipcRenderer.invoke("ssi:createCredDef", cfg, credDef),
  issueCredential: (cfg, issue) => ipcRenderer.invoke("ssi:issueCredential", cfg, issue),
  verifyCredential: (cfg, verify) => ipcRenderer.invoke("ssi:verifyCredential", cfg, verify),

  saveCredentialToFile: (defaultName, pkg) => ipcRenderer.invoke("ssi:saveCredentialToFile", defaultName, pkg),
  openCredentialFromFile: () => ipcRenderer.invoke("ssi:openCredentialFromFile"),

  savePresentationToFile: (defaultName, pkg) => ipcRenderer.invoke("ssi:savePresentationToFile", defaultName, pkg),
  openPresentationFromFile: () => ipcRenderer.invoke("ssi:openPresentationFromFile"),

  createPresentationPackage: (cfg, input) => ipcRenderer.invoke("ssi:createPresentationPackage", cfg, input),
  verifyPresentationPackage: (cfg, input) => ipcRenderer.invoke("ssi:verifyPresentationPackage", cfg, input),

  // Fluxo multi-instância (Offer/Request/Credential)
  createCredentialOfferPackage: (cfg, input) => ipcRenderer.invoke("ssi:createCredentialOfferPackage", cfg, input),
  acceptCredentialOfferPackage: (cfg, input) => ipcRenderer.invoke("ssi:acceptCredentialOfferPackage", cfg, input),
  issueCredentialFromRequestPackage: (cfg, input) => ipcRenderer.invoke("ssi:issueCredentialFromRequestPackage", cfg, input),
  storeCredentialFromPackage: (cfg, input) => ipcRenderer.invoke("ssi:storeCredentialFromPackage", cfg, input),

});
