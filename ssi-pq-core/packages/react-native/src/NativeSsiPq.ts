import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export interface Spec extends TurboModule {
  supportedProfiles(): Promise<ReadonlyArray<string>>;
  canonicalJson(input: string): Promise<string>;
  canonicalJsonHashBase64url(input: string): Promise<string>;
  sha3_256Base64url(bytesBase64: string): Promise<string>;
  sha3_256Hex(bytesBase64: string): Promise<string>;
  base64urlEncode(bytesBase64: string): Promise<string>;
  base64urlDecodeToBase64(value: string): Promise<string>;

  createSchemaFromAttributes(
    attributesJson: string,
    optionsJson?: string | null,
  ): Promise<string>;
  verifyDidDocument(didDocumentJson: string): Promise<string>;
  verifySignedCredential(
    signedCredentialJson: string,
    issuerDidDocumentJson: string,
  ): Promise<string>;
  verifySignedCredentialPdfFile(
    inputUri: string,
    issuerDidDocumentJson: string,
  ): Promise<string>;
  verifySignedGenericPdfFile(
    inputUri: string,
    signerDidDocumentJson: string,
  ): Promise<string>;

  walletCreateJson(
    walletName: string,
    password: string,
    optionsJson?: string | null,
  ): Promise<string>;
  walletOpenJson(walletName: string, password: string): Promise<string>;
  walletChangePasswordJson(
    walletName: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<string>;
  walletCreateDidJson(
    walletName: string,
    password: string,
    optionsJson?: string | null,
  ): Promise<string>;
  walletListDidsJson(walletName: string, password: string): Promise<string>;
  walletGetDidDocumentJson(
    walletName: string,
    password: string,
    did: string,
  ): Promise<string>;
  walletIssueCredentialFromSchemaJson(
    walletName: string,
    password: string,
    did: string,
    schemaJson: string,
    attributesJson: string,
    optionsJson?: string | null,
  ): Promise<string>;
  walletEmbedSignedCredentialInPdfFile(
    walletName: string,
    password: string,
    did: string,
    inputUri: string,
    outputUri: string,
    signedCredentialJson: string,
    optionsJson?: string | null,
  ): Promise<string>;
  walletSignGenericPdfFile(
    walletName: string,
    password: string,
    did: string,
    inputUri: string,
    outputUri: string,
    optionsJson?: string | null,
  ): Promise<string>;
  walletMlkemDecapsulate(
    walletName: string,
    password: string,
    did: string,
    ciphertext: string,
  ): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('SsiPq');
