import {
  createDid,
  createSchemaFromAttributes,
  createWallet,
  embedSignedCredentialInPdf,
  getDidDocument,
  issueCredentialFromSchema,
  openWallet,
  verifySignedCredentialPdf,
} from '../src';

export type MinimalFlowInput = {
  walletName: string;
  password: string;
  inputPdfUri: string;
  outputPdfUri: string;
};

export async function runMinimalFlow(input: MinimalFlowInput) {
  const createdAt = new Date().toISOString();
  const issuedAt = createdAt;

  try {
    await createWallet(input.walletName, input.password, {createdAt});
  } catch (error) {
    await openWallet(input.walletName, input.password);
  }

  const didResult = await createDid(input.walletName, input.password, {
    label: 'React Native issuer',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt,
  });

  const didDocument = await getDidDocument(input.walletName, input.password, didResult.did);
  const attributes = {
    name: 'Ana Silva',
    course: 'Post-Quantum Credentials',
    level: 'mobile example',
  };
  const schema = await createSchemaFromAttributes(attributes, {
    version: '1',
    createdAt,
  });
  const signedCredential = await issueCredentialFromSchema(
    input.walletName,
    input.password,
    didResult.did,
    schema,
    attributes,
    {
      credentialId: `rn-example-${Date.now()}`,
      issuedAt,
      visiblePaths: ['name', 'course'],
      credentialVersion: 'v2',
    },
  );

  const fileResult = await embedSignedCredentialInPdf({
    walletName: input.walletName,
    password: input.password,
    did: didResult.did,
    inputUri: input.inputPdfUri,
    outputUri: input.outputPdfUri,
    signedCredential,
    options: {createdAt},
  });
  const verification = await verifySignedCredentialPdf(input.outputPdfUri, didDocument);

  return {
    did: didResult.did,
    didDocument,
    signedCredential,
    fileResult,
    verification,
  };
}
