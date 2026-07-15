import {
  base64urlDecodeToBase64,
  base64urlEncode,
  canonicalJson,
  canonicalJsonHashBase64url,
  createSchemaFromAttributes,
  createWallet,
  createDid,
  embedSignedCredentialInPdf,
  getDidDocument,
  issueCredentialFromSchema,
  listDids,
  mlkemDecapsulate,
  openWallet,
  sha3_256Base64url,
  sha3_256Hex,
  signGenericPdf,
  supportedProfiles,
  verifyDidDocument,
  verifySignedCredential,
  verifySignedCredentialPdf,
  verifySignedGenericPdf,
  walletChangePassword,
} from './index';

export const nodeCompatibilityNotes = [
  'React Native wallet APIs use walletName, not a Node.js filesystem path.',
  'React Native wallet/PDF APIs are Promise-based and run on native background queues.',
  'PDF APIs use inputUri/outputUri instead of copying large buffers through JavaScript.',
  'APIs that return or receive private keys are omitted from the safe public API.',
  'base64urlDecode returns base64 transport text in this facade, not a Node.js Buffer.',
] as const;

export {
  supportedProfiles,
  canonicalJson,
  canonicalJsonHashBase64url,
  sha3_256Base64url,
  sha3_256Hex,
  base64urlEncode,
  createSchemaFromAttributes,
  verifySignedCredential,
};

export const base64urlDecode = base64urlDecodeToBase64;
export const didVerify = verifyDidDocument;
export const didFingerprintMatchesKeys = verifyDidDocument;
export const verifySignedCredentialPdfFromUri = verifySignedCredentialPdf;
export const verifySignedGenericPdfFromUri = verifySignedGenericPdf;
export const verifySignedCredentialPdfFile = verifySignedCredentialPdf;
export const verifySignedGenericPdfFile = verifySignedGenericPdf;

export const walletCreate = createWallet;
export const walletOpen = openWallet;
export const walletChangePasswordJson = walletChangePassword;
export const walletCreateDid = createDid;
export const walletListDids = listDids;
export const walletGetDidDocument = getDidDocument;
export const walletIssueCredentialFromSchema = issueCredentialFromSchema;
export const walletEmbedSignedCredentialInPdf = embedSignedCredentialInPdf;
export const walletEmbedSignedCredentialInPdfFromUri = embedSignedCredentialInPdf;
export const walletSignGenericPdf = signGenericPdf;
export const walletSignGenericPdfFromUri = signGenericPdf;
export const walletMlkemDecapsulate = mlkemDecapsulate;

export function canonicalJsonFile(): never {
  throw unavailable('canonicalJsonFile', 'read the URI/text in React Native and call canonicalJson');
}

export const unsafe = Object.freeze({
  createDid: () => {
    throw unavailable('createDid', 'use walletCreateDid/createDid so private keys stay native');
  },
  issueCredentialFromSchema: () => {
    throw unavailable(
      'issueCredentialFromSchema',
      'use walletIssueCredentialFromSchema so private keys stay native',
    );
  },
  embedSignedCredentialInPdf: () => {
    throw unavailable(
      'embedSignedCredentialInPdf',
      'use walletEmbedSignedCredentialInPdf with inputUri/outputUri',
    );
  },
  mldsaGenerateKeypair: () => {
    throw unavailable('mldsaGenerateKeypair', 'use walletCreateDid for product flows');
  },
  mldsaSign: () => {
    throw unavailable('mldsaSign', 'use walletSignGenericPdf or walletIssueCredentialFromSchema');
  },
  mlkemGenerateKeypair: () => {
    throw unavailable('mlkemGenerateKeypair', 'use walletCreateDid for product flows');
  },
  mlkemDecapsulate: () => {
    throw unavailable('mlkemDecapsulate', 'use walletMlkemDecapsulate');
  },
});

function unavailable(name: string, alternative: string): Error {
  return new Error(`${name} is not exposed by the safe React Native facade; ${alternative}.`);
}
