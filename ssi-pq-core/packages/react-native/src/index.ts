import NativeSsiPq from './NativeSsiPq';
import {
  jsonToString,
  normalizeFileOperationResult,
  normalizeMobileError,
  optionalJsonToString,
  parseJson,
} from './serialization';
import type {
  CredentialIssueOptions,
  CredentialVerificationResult,
  FileOperationResult,
  JsonInput,
  JsonObject,
  PdfBindingOptions,
  PdfSignOptions,
  PdfVerificationResult,
  WalletCreateOptions,
  WalletCredentialPdfFileRequest,
  WalletDidCreateOptions,
  WalletDidCreationResult,
  WalletDidSummary,
  WalletInfo,
  WalletPdfFileRequest,
} from './types';

export type {
  CredentialIssueOptions,
  CredentialVerificationResult,
  FileOperationResult,
  JsonInput,
  JsonObject,
  MlDsaProfile,
  MlKemProfile,
  PdfBindingOptions,
  PdfSignOptions,
  PdfVerificationResult,
  SsiPqError,
  SsiPqErrorCode,
  WalletCreateOptions,
  WalletCredentialPdfFileRequest,
  WalletDidCreateOptions,
  WalletDidCreationResult,
  WalletDidSummary,
  WalletInfo,
  WalletPdfFileRequest,
} from './types';

export {jsonToString, normalizeFileOperationResult, normalizeMobileError, optionalJsonToString};

export const native = NativeSsiPq;

export function supportedProfiles(): Promise<ReadonlyArray<string>> {
  return NativeSsiPq.supportedProfiles();
}

export function canonicalJson(input: string): Promise<string> {
  return NativeSsiPq.canonicalJson(input);
}

export function canonicalJsonHashBase64url(input: string): Promise<string> {
  return NativeSsiPq.canonicalJsonHashBase64url(input);
}

export function sha3_256Base64url(bytesBase64: string): Promise<string> {
  return NativeSsiPq.sha3_256Base64url(bytesBase64);
}

export function sha3_256Hex(bytesBase64: string): Promise<string> {
  return NativeSsiPq.sha3_256Hex(bytesBase64);
}

export function base64urlEncode(bytesBase64: string): Promise<string> {
  return NativeSsiPq.base64urlEncode(bytesBase64);
}

export function base64urlDecodeToBase64(value: string): Promise<string> {
  return NativeSsiPq.base64urlDecodeToBase64(value);
}

export async function createSchemaFromAttributes(
  attributes: JsonInput,
  options?: {version?: string; createdAt: string} | string | null,
): Promise<JsonObject> {
  return parseJson(
    await NativeSsiPq.createSchemaFromAttributes(
      jsonToString(attributes, 'attributes'),
      optionalJsonToString(options, 'schema options'),
    ),
    'schema',
  );
}

export async function verifyDidDocument(didDocument: JsonInput): Promise<JsonObject> {
  return parseJson(
    await NativeSsiPq.verifyDidDocument(jsonToString(didDocument, 'didDocument')),
    'DID verification result',
  );
}

export async function verifySignedCredential(
  signedCredential: JsonInput,
  issuerDidDocument: JsonInput,
): Promise<CredentialVerificationResult> {
  return parseJson(
    await NativeSsiPq.verifySignedCredential(
      jsonToString(signedCredential, 'signedCredential'),
      jsonToString(issuerDidDocument, 'issuerDidDocument'),
    ),
    'credential verification result',
  );
}

export async function createWallet(
  walletName: string,
  password: string,
  options: WalletCreateOptions | string,
): Promise<WalletInfo> {
  return parseJson(
    await NativeSsiPq.walletCreateJson(
      walletName,
      password,
      jsonToString(options, 'wallet create options'),
    ),
    'wallet info',
  );
}

export async function openWallet(walletName: string, password: string): Promise<WalletInfo> {
  return parseJson(await NativeSsiPq.walletOpenJson(walletName, password), 'wallet info');
}

export async function changeWalletPassword(
  walletName: string,
  oldPassword: string,
  newPassword: string,
): Promise<WalletInfo> {
  return parseJson(
    await NativeSsiPq.walletChangePasswordJson(walletName, oldPassword, newPassword),
    'wallet info',
  );
}

export async function createDid(
  walletName: string,
  password: string,
  options: WalletDidCreateOptions | string,
): Promise<WalletDidCreationResult> {
  return parseJson(
    await NativeSsiPq.walletCreateDidJson(
      walletName,
      password,
      jsonToString(options, 'wallet DID options'),
    ),
    'wallet DID creation result',
  );
}

export async function listDids(
  walletName: string,
  password: string,
): Promise<ReadonlyArray<WalletDidSummary>> {
  return parseJson(await NativeSsiPq.walletListDidsJson(walletName, password), 'wallet DIDs');
}

export async function getDidDocument(
  walletName: string,
  password: string,
  did: string,
): Promise<JsonObject> {
  return parseJson(
    await NativeSsiPq.walletGetDidDocumentJson(walletName, password, did),
    'DID Document',
  );
}

export async function issueCredentialFromSchema(
  walletName: string,
  password: string,
  did: string,
  schema: JsonInput,
  attributes: JsonInput,
  options: CredentialIssueOptions | string,
): Promise<JsonObject> {
  return parseJson(
    await NativeSsiPq.walletIssueCredentialFromSchemaJson(
      walletName,
      password,
      did,
      jsonToString(schema, 'schema'),
      jsonToString(attributes, 'attributes'),
      jsonToString(options, 'credential issue options'),
    ),
    'signed credential',
  );
}

export async function embedSignedCredentialInPdf(
  request: WalletCredentialPdfFileRequest,
): Promise<FileOperationResult> {
  return normalizeFileOperationResult(
    await NativeSsiPq.walletEmbedSignedCredentialInPdfFile(
      request.walletName,
      request.password,
      request.did,
      request.inputUri,
      request.outputUri,
      jsonToString(request.signedCredential, 'signedCredential'),
      jsonToString(request.options, 'PDF binding options'),
    ),
  );
}

export async function signGenericPdf(request: WalletPdfFileRequest): Promise<FileOperationResult> {
  return normalizeFileOperationResult(
    await NativeSsiPq.walletSignGenericPdfFile(
      request.walletName,
      request.password,
      request.did,
      request.inputUri,
      request.outputUri,
      jsonToString(request.options, 'PDF sign options'),
    ),
  );
}

export async function verifySignedCredentialPdf(
  inputUri: string,
  issuerDidDocument: JsonInput,
): Promise<PdfVerificationResult> {
  return parseJson(
    await NativeSsiPq.verifySignedCredentialPdfFile(
      inputUri,
      jsonToString(issuerDidDocument, 'issuerDidDocument'),
    ),
    'credential PDF verification result',
  );
}

export async function verifySignedGenericPdf(
  inputUri: string,
  signerDidDocument: JsonInput,
): Promise<PdfVerificationResult> {
  return parseJson(
    await NativeSsiPq.verifySignedGenericPdfFile(
      inputUri,
      jsonToString(signerDidDocument, 'signerDidDocument'),
    ),
    'generic PDF verification result',
  );
}

export function mlkemDecapsulate(
  walletName: string,
  password: string,
  did: string,
  ciphertext: string,
): Promise<string> {
  return NativeSsiPq.walletMlkemDecapsulate(walletName, password, did, ciphertext);
}

export const issueCredential = issueCredentialFromSchema;
export const signPdf = signGenericPdf;
export const verifyCredentialPdf = verifySignedCredentialPdf;
export const verifyGenericPdf = verifySignedGenericPdf;

export const walletCreate = createWallet;
export const walletOpen = openWallet;
export const walletChangePassword = changeWalletPassword;
export const walletCreateDid = createDid;
export const walletListDids = listDids;
export const walletGetDidDocument = getDidDocument;
export const walletIssueCredentialFromSchema = issueCredentialFromSchema;
export const walletEmbedSignedCredentialInPdf = embedSignedCredentialInPdf;
export const walletSignGenericPdf = signGenericPdf;
export const walletMlkemDecapsulate = mlkemDecapsulate;
