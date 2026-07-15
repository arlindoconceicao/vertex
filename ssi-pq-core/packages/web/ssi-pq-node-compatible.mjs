import { createIndexedDbWalletStore } from './ssi-pq-indexeddb-wallet.mjs';

export async function initNodeCompatibleCore(options = {}) {
  const { wasmModule = './pkg/ssi_pq_wasm.js', wasmInitInput } = options;
  const wasm = await loadWasmModule(wasmModule, wasmInitInput);
  return createNodeCompatibleCore(wasm, options);
}

export function createNodeCompatibleCore(wasm, options = {}) {
  assertWasmBindings(wasm);
  const wallet = options.walletStore || createDefaultWalletStore(wasm, options);

  return {
    ...copyPublicWasmExports(wasm),

    createDid(options = {}) {
      return parseJsonResult(
        wasm.createDidJson(encodeOptions(withDefaultTimestamp(options, 'createdAt')))
      );
    },

    didVerify(didDocument) {
      return parseJsonResult(wasm.verifyDidDocumentJson(encodeJson(didDocument))).valid;
    },

    didFingerprintMatchesKeys(didDocument) {
      return parseJsonResult(wasm.verifyDidDocumentJson(encodeJson(didDocument)))
        .fingerprintMatchesKeys;
    },

    createSchemaFromAttributes(attributes, options = {}) {
      return parseJsonResult(
        wasm.createSchemaFromAttributesJson(
          encodeJson(attributes),
          encodeOptions(withDefaultTimestamp(options, 'createdAt'))
        )
      );
    },

    issueCredentialFromSchema(
      schema,
      attributes,
      issuerDidDocument,
      issuerPrivateKey,
      options = {}
    ) {
      return parseJsonResult(
        wasm.issueCredentialFromSchemaJson(
          encodeJson(schema),
          encodeJson(attributes),
          encodeJson(issuerDidDocument),
          issuerPrivateKey,
          encodeOptions(withDefaultTimestamp(options, 'issuedAt'))
        )
      );
    },

    verifySignedCredential(signedCredential, issuerDidDocument) {
      return parseJsonResult(
        wasm.verifySignedCredentialJson(encodeJson(signedCredential), encodeJson(issuerDidDocument))
      ).valid;
    },

    signedCredentialToPdf(signedCredential, options) {
      return wasm.signedCredentialToPdfBytes(encodeJson(signedCredential), encodeOptions(options));
    },

    embedSignedCredentialInPdf(
      pdfBase,
      signedCredential,
      issuerDidDocument,
      issuerPrivateKey,
      options = {}
    ) {
      return wasm.embedSignedCredentialInPdfBytes(
        toUint8Array(pdfBase),
        encodeJson(signedCredential),
        encodeJson(issuerDidDocument),
        issuerPrivateKey,
        encodeOptions(withDefaultTimestamp(options, 'createdAt'))
      );
    },

    extractCredentialManifestFromPdf(pdfBytes) {
      return parseJsonResult(wasm.extractCredentialManifestFromPdfBytes(toUint8Array(pdfBytes)));
    },

    verifySignedCredentialPdf(pdfBytes, issuerDidDocument) {
      return parseJsonResult(
        wasm.verifySignedCredentialPdfJson(toUint8Array(pdfBytes), encodeJson(issuerDidDocument))
      );
    },

    extractGenericSignatureManifestFromPdf(pdfBytes) {
      return parseJsonResult(
        wasm.extractGenericSignatureManifestFromPdfBytes(toUint8Array(pdfBytes))
      );
    },

    verifySignedGenericPdf(pdfBytes, signerDidDocument) {
      return parseJsonResult(
        wasm.verifySignedGenericPdfJson(toUint8Array(pdfBytes), encodeJson(signerDidDocument))
      );
    },

    async walletCreate(walletName, password, walletOptions) {
      return wallet.createWallet(
        walletName,
        password,
        withDefaultTimestamp(walletOptions || {}, 'createdAt')
      );
    },

    async walletOpen(walletName, password) {
      return wallet.openWallet(walletName, password);
    },

    async walletChangePassword(walletName, oldPassword, newPassword) {
      return wallet.changePassword(walletName, oldPassword, newPassword);
    },

    async walletCreateDid(walletName, password, didOptions) {
      return wallet.createDid(
        walletName,
        password,
        withDefaultTimestamp(didOptions || {}, 'createdAt')
      );
    },

    async walletListDids(walletName, password) {
      return wallet.listDids(walletName, password);
    },

    async walletGetDidDocument(walletName, password, did) {
      return wallet.getDidDocument(walletName, password, did);
    },

    async walletIssueCredentialFromSchema(
      walletName,
      password,
      did,
      schema,
      attributes,
      issueOptions
    ) {
      return wallet.issueCredentialFromSchema(
        walletName,
        password,
        did,
        schema,
        attributes,
        withDefaultTimestamp(issueOptions || {}, 'issuedAt')
      );
    },

    async walletEmbedSignedCredentialInPdf(
      walletName,
      password,
      did,
      pdfBase,
      signedCredential,
      bindingOptions
    ) {
      return wallet.embedSignedCredentialInPdf(
        walletName,
        password,
        did,
        pdfBase,
        signedCredential,
        withDefaultTimestamp(bindingOptions || {}, 'createdAt')
      );
    },

    async walletSignGenericPdf(walletName, password, did, pdfBase, signOptions) {
      return wallet.signGenericPdf(
        walletName,
        password,
        did,
        pdfBase,
        withDefaultTimestamp(signOptions || {}, 'createdAt')
      );
    },

    async walletMlkemDecapsulate(walletName, password, did, ciphertext) {
      return wallet.mlkemDecapsulate(walletName, password, did, ciphertext);
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

function copyPublicWasmExports(wasm) {
  const exports = {};
  for (const [name, value] of Object.entries(wasm)) {
    if (name === 'default' || name === 'initSync' || name.startsWith('__wbindgen')) {
      continue;
    }
    if (typeof value === 'function') {
      exports[name] = value;
    }
  }
  return exports;
}

function createDefaultWalletStore(wasm, options) {
  if (options.indexedDB === null || options.disableWalletPersistence === true) {
    return createUnavailableWalletStore();
  }
  if (!options.indexedDB && !globalThis.indexedDB) {
    return createUnavailableWalletStore();
  }
  return createIndexedDbWalletStore(wasm, options);
}

function createUnavailableWalletStore() {
  const fail = async () => {
    throw new Error(
      'wallet persistence is not configured; pass walletStore or IndexedDB options to createNodeCompatibleCore'
    );
  };

  return {
    createWallet: fail,
    openWallet: fail,
    changePassword: fail,
    createDid: fail,
    listDids: fail,
    getDidDocument: fail,
    issueCredentialFromSchema: fail,
    embedSignedCredentialInPdf: fail,
    signGenericPdf: fail,
    mlkemDecapsulate: fail
  };
}

function assertWasmBindings(wasm) {
  const required = [
    'createDidJson',
    'verifyDidDocumentJson',
    'createSchemaFromAttributesJson',
    'issueCredentialFromSchemaJson',
    'verifySignedCredentialJson',
    'signedCredentialToPdfBytes',
    'embedSignedCredentialInPdfBytes',
    'extractCredentialManifestFromPdfBytes',
    'verifySignedCredentialPdfJson',
    'extractGenericSignatureManifestFromPdfBytes',
    'verifySignedGenericPdfJson'
  ];

  for (const name of required) {
    if (typeof wasm?.[name] !== 'function') {
      throw new Error(`missing WASM core binding: ${name}`);
    }
  }
}

function withDefaultTimestamp(options, fieldName) {
  if (options && Object.prototype.hasOwnProperty.call(options, fieldName)) {
    return options;
  }
  return { ...options, [fieldName]: nowRfc3339Seconds() };
}

function nowRfc3339Seconds() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
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
