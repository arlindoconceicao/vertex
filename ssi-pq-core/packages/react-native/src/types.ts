export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = {[key: string]: JsonValue};
export type JsonInput = JsonObject | string;

export type MlDsaProfile = 'ML-DSA-44' | 'ML-DSA-65' | 'ML-DSA-87';
export type MlKemProfile = 'ML-KEM-512' | 'ML-KEM-768' | 'ML-KEM-1024';
export type SignedCredentialVersion = 'v1' | 'v2' | 'ssi_signed_credential_v1' | 'ssi_signed_credential_v2';

export type SsiPqErrorCode =
  | 'InvalidInput'
  | 'Crypto'
  | 'Wallet'
  | 'Pdf'
  | 'Storage'
  | 'Io'
  | 'Unavailable'
  | 'Unknown';

export type SsiPqError = {
  code: SsiPqErrorCode;
  message: string;
  cause?: unknown;
};

export type WalletCreateOptions = {
  createdAt: string;
};

export type WalletDidCreateOptions = {
  label?: string | null;
  mldsa?: MlDsaProfile;
  mlkem?: MlKemProfile;
  createdAt: string;
  didDocCid?: string | null;
};

export type CredentialIssueOptions = {
  credentialId?: string | null;
  issuedAt: string;
  expiresAt?: string | null;
  statusRef?: JsonObject | null;
  visiblePaths?: string[] | null;
  credentialVersion?: SignedCredentialVersion | null;
};

export type PdfBindingOptions = {
  createdAt: string;
  didDocCid?: string | null;
};

export type PdfVisibleSignatureOptions = {
  mode: 'visible';
  placement?: 'firstPageFooter' | 'footer' | 'firstPageRightMargin' | 'rightMargin';
  text?: string | null;
};

export type PdfInvisibleSignatureOptions = {
  mode?: 'invisible';
};

export type PdfSignOptions = {
  createdAt: string;
  didDocCid?: string | null;
  visualSignature?: PdfVisibleSignatureOptions | PdfInvisibleSignatureOptions | null;
};

export type WalletInfo = {
  wallet_id: string;
  version: number;
  created_at: string;
  did_count: number;
  backend: string;
};

export type WalletDidSummary = {
  did: string;
  label?: string | null;
  mldsa_alg: MlDsaProfile | string;
  mlkem_alg: MlKemProfile | string;
  status: string;
  created_at: string;
  did_doc_cid?: string | null;
};

export type WalletDidCreationResult = {
  did: string;
  fingerprint: string;
  did_document: JsonObject;
  label?: string | null;
  created_at: string;
};

export type FileOperationResult = {
  outputUri: string;
  bytesWritten: number;
  metadataJson?: string | null;
};

export type CredentialVerificationResult = {
  valid: boolean;
  [key: string]: JsonValue;
};

export type PdfVerificationResult = {
  valid: boolean;
  status?: string;
  errors?: string[];
  [key: string]: JsonValue | string[] | undefined;
};

export type WalletPdfFileRequest = {
  walletName: string;
  password: string;
  did: string;
  inputUri: string;
  outputUri: string;
  options: PdfSignOptions | string;
};

export type WalletCredentialPdfFileRequest = {
  walletName: string;
  password: string;
  did: string;
  inputUri: string;
  outputUri: string;
  signedCredential: JsonInput;
  options: PdfBindingOptions | string;
};
