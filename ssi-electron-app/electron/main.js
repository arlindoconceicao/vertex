// main.js (Electron Main Process) — ponto de entrada do aplicativo: importa os módulos centrais do Electron
// (`app`, `BrowserWindow`, `ipcMain`, `Menu`) e utilitários de caminho (`path`). Também carrega a instância única
// do serviço SSI (`ssi`) a partir de `./services/ssiService`, garantindo que todas as operações (wallet/ledger/VC/VP)
// usem o mesmo objeto compartilhado e evitando múltiplas inicializações concorrentes do backend nativo.

// electron/main.js
const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");

// ✅ Usa a mesma instância para tudo
const { ssi } = require("./services/ssiService");

// (Opcional) deixe comentado se causar problemas no seu Linux
// app.commandLine.appendSwitch("disable-features", "UseOzonePlatform");

// Cria e configura a janela principal do Electron: define dimensões iniciais e endurece a segurança do Renderer
// habilitando `contextIsolation` e desabilitando `nodeIntegration`, de modo que a UI não tenha acesso direto ao Node.
// Injeta o `preload.js` como ponte controlada (window.ssiApi). Remove o menu nativo (incluindo o atalho Alt no Linux)
// para uma experiência mais “app-like” e carrega a interface `renderer/index.html`. Retorna a instância `win`.
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Remover menu e evitar reaparecer via Alt no Linux
  win.setAutoHideMenuBar(true);
  win.setMenuBarVisibility(false);
  win.removeMenu();

  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  return win;
}

// Helper para padronizar respostas de sucesso enviadas ao Renderer via IPC: retorna um objeto com `ok: true`
// e mescla (`...data`) os campos adicionais do resultado, garantindo um formato consistente para a UI tratar
function ok(data) {
  return { ok: true, ...data };
}

// Helper para padronizar respostas de erro no IPC: encapsula a exceção `e` em um objeto serializável contendo
// `ok:false`, o `context` (qual ação/handler falhou), mensagem amigável, código (quando disponível) e stack trace.
// Isso facilita diagnóstico no Renderer sem depender de tipos de erro não serializáveis do Node/Electron.
function err(e, context) {
  return {
    ok: false,
    context,
    message: e?.message || String(e),
    code: e?.code || "UNKNOWN",
    stack: e?.stack || null,
  };
}

// Registra um handler IPC com tratamento uniforme de sucesso/erro: cria `ipcMain.handle(name, ...)` e executa `fn`
// de forma assíncrona. Se `fn` já retornar um objeto no formato { ok: ... }, repassa sem re-encapsular; caso contrário,
// embrulha em { ok:true, result } via `ok(...)`. Em qualquer exceção, loga no console do Main Process e devolve um
// payload padronizado via `err(e, name)`, permitindo que o Renderer trate falhas de forma consistente.
function handle(name, fn) {
  ipcMain.handle(name, async (...args) => {
    try {
      const result = await fn(...args);

      // Se o service já retornar { ok: ... }, não embrulhar novamente
      if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "ok")) {
        return result;
      }
      return ok({ result });
    } catch (e) {
      console.error(`Error occurred in handler for '${name}':`, e);
      return err(e, name);
    }
  });
}

// Inicialização do app no evento `whenReady`: remove o menu global da aplicação e registra todos os handlers IPC
// usados pelo Renderer (via `ipcRenderer.invoke` exposto no preload). Cada canal "ssi:*" é mapeado para o método
// correspondente do serviço `ssi`, usando `handle(...)` para padronizar retorno ({ ok:true/false, result, ...}) e
// captura de exceções. Inclui rotinas de arquivo (salvar/abrir package JSON) e as operações de apresentação
// (criar/verificar Presentation Package). Por fim, cria a janela principal carregando a UI.
app.whenReady().then(() => {
  // Remove menu global
  Menu.setApplicationMenu(null);

  // IPC handlers (renderer -> main)
  handle("ssi:testConnection", (_, cfg) => ssi.testConnection(cfg));
  handle("ssi:createDidAndRegister", (_, cfg) => ssi.createDidAndRegister(cfg));
  handle("ssi:createSchema", (_, cfg, schema) => ssi.createSchema(cfg, schema));
  handle("ssi:createCredDef", (_, cfg, credDef) => ssi.createCredDef(cfg, credDef));
  handle("ssi:issueCredential", (_, cfg, issue) => ssi.issueCredential(cfg, issue));
  handle("ssi:verifyCredential", (_, cfg, verify) => ssi.verifyCredential(cfg, verify));

  // Arquivos
  handle("ssi:saveCredentialToFile", (_, defaultName, pkg) => ssi.saveCredentialToFile(defaultName, pkg));
  handle("ssi:openCredentialFromFile", () => ssi.openCredentialFromFile());

  // Arquivos (Presentation)
  handle("ssi:savePresentationToFile", (_, defaultName, pkg) => ssi.savePresentationToFile(defaultName, pkg));
  handle("ssi:openPresentationFromFile", () => ssi.openPresentationFromFile());

  // ✅ Presentation (use o MESMO padrão handle)
  handle("ssi:createPresentationPackage", (_, cfg, input) => ssi.createPresentationPackage(cfg, input));
  handle("ssi:verifyPresentationPackage", (_, cfg, input) => ssi.verifyPresentationPackage(cfg, input));

  // Fluxo multi-instância (Offer/Request/Credential)
  handle("ssi:createCredentialOfferPackage", (_, cfg, input) => ssi.createCredentialOfferPackage(cfg, input));
  handle("ssi:acceptCredentialOfferPackage", (_, cfg, input) => ssi.acceptCredentialOfferPackage(cfg, input));
  handle("ssi:issueCredentialFromRequestPackage", (_, cfg, input) => ssi.issueCredentialFromRequestPackage(cfg, input));
  handle("ssi:storeCredentialFromPackage", (_, cfg, input) => ssi.storeCredentialFromPackage(cfg, input));

  createWindow();
});

// Evento de encerramento quando todas as janelas forem fechadas: tenta finalizar o backend SSI de forma segura
// (`ssi.safeClose()`), liberando recursos como sessão, handles de carteira/DB e objetos nativos; ignora falhas no
// teardown para não bloquear o encerramento e, em seguida, finaliza o aplicativo com `app.quit()`.
app.on("window-all-closed", async () => {
  try {
    await ssi.safeClose();
  } catch (_) { }
  app.quit();
});
