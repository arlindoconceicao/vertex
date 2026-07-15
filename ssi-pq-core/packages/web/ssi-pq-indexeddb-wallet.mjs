const DEFAULT_DB_NAME = 'ssi-pq-wallets';
const DEFAULT_STORE_NAME = 'walletSnapshots';

export async function initIndexedDbWallet(options = {}) {
  const {
    wasmModule = './pkg/ssi_pq_wasm.js',
    wasmInitInput,
    indexedDB = globalThis.indexedDB,
    dbName = DEFAULT_DB_NAME,
    storeName = DEFAULT_STORE_NAME
  } = options;

  const wasm = await loadWasmModule(wasmModule, wasmInitInput);
  return createIndexedDbWalletStore(wasm, { indexedDB, dbName, storeName });
}

export function createIndexedDbWalletStore(wasm, options = {}) {
  return createPersistentWebWallet(wasm, createIndexedDbSnapshotStore(options));
}

export function createPersistentWebWallet(wasm, snapshotStore) {
  assertWasmBindings(wasm);
  assertSnapshotStore(snapshotStore);

  async function loadSnapshot(walletName) {
    const snapshotJson = await snapshotStore.get(walletName);
    if (snapshotJson == null) {
      wasm.webWalletDeleteStorage(walletName);
      return null;
    }

    wasm.webWalletImportStorageJson(walletName, snapshotJson);
    return snapshotJson;
  }

  async function saveSnapshot(walletName) {
    const snapshotJson = wasm.webWalletExportStorageJson(walletName);
    await snapshotStore.put(walletName, snapshotJson);
    return snapshotJson;
  }

  return {
    async createWallet(walletName, password, options) {
      assertWalletName(walletName);
      if ((await snapshotStore.get(walletName)) != null) {
        throw new Error(`wallet already exists: ${walletName}`);
      }

      wasm.webWalletDeleteStorage(walletName);
      const result = parseJsonResult(
        wasm.webWalletCreateJson(walletName, password, encodeOptions(options))
      );
      await saveSnapshot(walletName);
      return result;
    },

    async openWallet(walletName, password) {
      await loadSnapshot(walletName);
      return parseJsonResult(wasm.webWalletOpenJson(walletName, password));
    },

    async changePassword(walletName, oldPassword, newPassword) {
      await loadSnapshot(walletName);
      const result = parseJsonResult(
        wasm.webWalletChangePasswordJson(walletName, oldPassword, newPassword)
      );
      await saveSnapshot(walletName);
      return result;
    },

    async createDid(walletName, password, options) {
      await loadSnapshot(walletName);
      const result = parseJsonResult(
        wasm.webWalletCreateDidJson(walletName, password, encodeOptions(options))
      );
      await saveSnapshot(walletName);
      return result;
    },

    async listDids(walletName, password) {
      await loadSnapshot(walletName);
      return parseJsonResult(wasm.webWalletListDidsJson(walletName, password));
    },

    async getDidDocument(walletName, password, did) {
      await loadSnapshot(walletName);
      return parseJsonResult(wasm.webWalletGetDidDocumentJson(walletName, password, did));
    },

    async issueCredentialFromSchema(walletName, password, did, schema, attributes, options) {
      await loadSnapshot(walletName);
      return parseJsonResult(
        wasm.webWalletIssueCredentialFromSchemaJson(
          walletName,
          password,
          did,
          encodeJson(schema),
          encodeJson(attributes),
          encodeOptions(options)
        )
      );
    },

    async embedSignedCredentialInPdf(
      walletName,
      password,
      did,
      pdfBase,
      signedCredential,
      options
    ) {
      await loadSnapshot(walletName);
      const pdf = wasm.webWalletEmbedSignedCredentialInPdfBytes(
        walletName,
        password,
        did,
        toUint8Array(pdfBase),
        encodeJson(signedCredential),
        encodeOptions(options)
      );
      await saveSnapshot(walletName);
      return pdf;
    },

    async signGenericPdf(walletName, password, did, pdfBase, options) {
      await loadSnapshot(walletName);
      return wasm.webWalletSignGenericPdfBytes(
        walletName,
        password,
        did,
        toUint8Array(pdfBase),
        encodeOptions(options)
      );
    },

    async mlkemDecapsulate(walletName, password, did, ciphertext) {
      await loadSnapshot(walletName);
      if (typeof ciphertext !== 'string') {
        throw new Error('ML-KEM ciphertext must be a base64url string');
      }
      return wasm.webWalletMlkemDecapsulate(walletName, password, did, ciphertext);
    },

    async deleteWallet(walletName) {
      assertWalletName(walletName);
      wasm.webWalletDeleteStorage(walletName);
      await snapshotStore.delete(walletName);
    },

    async exportWalletSnapshot(walletName) {
      assertWalletName(walletName);
      return snapshotStore.get(walletName);
    },

    async importWalletSnapshot(walletName, snapshotJson) {
      assertWalletName(walletName);
      wasm.webWalletImportStorageJson(walletName, snapshotJson);
      await snapshotStore.put(walletName, snapshotJson);
    },

    clearMemory() {
      wasm.webWalletClearMemory();
    }
  };
}

export function createIndexedDbSnapshotStore(options = {}) {
  const {
    indexedDB = globalThis.indexedDB,
    dbName = DEFAULT_DB_NAME,
    storeName = DEFAULT_STORE_NAME
  } = options;

  if (!indexedDB) {
    throw new Error('indexedDB is not available in this environment');
  }

  const dbPromise = openDatabase(indexedDB, dbName, storeName);

  return {
    async get(walletName) {
      const db = await dbPromise;
      const record = await requestFromStore(db, storeName, 'readonly', (store) =>
        store.get(walletName)
      );
      return record ? record.snapshotJson : null;
    },

    async put(walletName, snapshotJson) {
      const db = await dbPromise;
      await requestFromStore(db, storeName, 'readwrite', (store) =>
        store.put({ walletName, snapshotJson, updatedAt: new Date().toISOString() })
      );
    },

    async delete(walletName) {
      const db = await dbPromise;
      await requestFromStore(db, storeName, 'readwrite', (store) => store.delete(walletName));
    }
  };
}

export function createMemorySnapshotStore(initialRecords) {
  const records = new Map(initialRecords ? Object.entries(initialRecords) : []);

  return {
    async get(walletName) {
      return records.has(walletName) ? records.get(walletName) : null;
    },

    async put(walletName, snapshotJson) {
      records.set(walletName, snapshotJson);
    },

    async delete(walletName) {
      records.delete(walletName);
    },

    dump() {
      return Object.fromEntries(records.entries());
    }
  };
}

async function loadWasmModule(wasmModule, wasmInitInput) {
  const wasm = typeof wasmModule === 'string' ? await import(wasmModule) : await wasmModule;
  if (wasm && typeof wasm.default === 'function') {
    await wasm.default(wasmInitInput);
  }
  return wasm;
}

function openDatabase(indexedDB, dbName, storeName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: 'walletName' });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function requestFromStore(db, storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    let request;
    let requestResult;
    let settled = false;

    function fail(error) {
      if (!settled) {
        settled = true;
        reject(error || transaction.error || new Error('IndexedDB transaction failed'));
      }
    }

    try {
      request = operation(transaction.objectStore(storeName));
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already be inactive.
      }
      fail(error);
      return;
    }

    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      requestResult = request.result;
    };
    transaction.onerror = () => fail(transaction.error);
    transaction.onabort = () => fail(transaction.error || new Error('IndexedDB transaction aborted'));
    transaction.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve(requestResult);
      }
    };
  });
}

function assertWasmBindings(wasm) {
  const required = [
    'webWalletCreateJson',
    'webWalletOpenJson',
    'webWalletChangePasswordJson',
    'webWalletCreateDidJson',
    'webWalletListDidsJson',
    'webWalletGetDidDocumentJson',
    'webWalletIssueCredentialFromSchemaJson',
    'webWalletEmbedSignedCredentialInPdfBytes',
    'webWalletSignGenericPdfBytes',
    'webWalletMlkemDecapsulate',
    'webWalletExportStorageJson',
    'webWalletImportStorageJson',
    'webWalletDeleteStorage',
    'webWalletClearMemory'
  ];

  for (const name of required) {
    if (typeof wasm?.[name] !== 'function') {
      throw new Error(`missing WASM wallet binding: ${name}`);
    }
  }
}

function assertSnapshotStore(snapshotStore) {
  for (const name of ['get', 'put', 'delete']) {
    if (typeof snapshotStore?.[name] !== 'function') {
      throw new Error(`snapshot store must implement ${name}()`);
    }
  }
}

function assertWalletName(walletName) {
  if (typeof walletName !== 'string' || walletName.length === 0) {
    throw new Error('walletName must be a non-empty string');
  }
}

function encodeOptions(value) {
  return value == null ? undefined : encodeJson(value);
}

function encodeJson(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function parseJsonResult(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function toUint8Array(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}
