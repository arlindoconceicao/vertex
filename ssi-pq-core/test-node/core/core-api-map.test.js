/**
 * Mapa prático da biblioteca core SSI-PQ.
 *
 * Este teste é propositalmente didático: ele usa todas as funções públicas
 * exportadas pelo core Node.js, prepara os parâmetros necessários e valida os
 * retornos principais. A ideia é complementar o MANUAL_CORE.md com um exemplo
 * executável de ponta a ponta.
 *
 * Os números nos comentários seguem o MANUAL_CORE.md; a ordem de execução
 * respeita as dependências práticas entre objetos, chaves, credenciais e PDFs.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/core/core-api-map.test.js
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

const outputDir = path.join(__dirname, '..', '..', 'test-output', 'core-api-map');
fs.mkdirSync(outputDir, { recursive: true });

function decodeBase58Btc(multibaseValue) {
  if (multibaseValue[0] !== 'z') throw new Error('Not base58btc multibase');

  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const value = multibaseValue.slice(1);
  let decoded = 0n;

  for (const char of value) {
    const index = alphabet.indexOf(char);
    if (index === -1) throw new Error(`Invalid base58btc character: ${char}`);
    decoded = decoded * 58n + BigInt(index);
  }

  let hex = decoded.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;

  const bytes = Buffer.from(hex, 'hex');
  let leadingZeros = 0;
  while (value[leadingZeros] === '1') leadingZeros++;

  return Buffer.concat([Buffer.alloc(leadingZeros), bytes]);
}

function mlkemPublicKeyBase64urlFromDidDocument(didDocument) {
  const mlkemKey = didDocument.keys.find((key) => key.id === '#mlkem-1');
  assert.ok(mlkemKey, 'DID Document precisa conter a chave #mlkem-1');
  return core.base64urlEncode(decodeBase58Btc(mlkemKey.public_key_multibase));
}

function minimalPdfBase() {
  return Buffer.from(
    '%PDF-1.4\n%ABCD\n' +
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n' +
      'xref\n0 4\n' +
      '0000000000 65535 f \n' +
      '0000000015 00000 n \n' +
      '0000000064 00000 n \n' +
      '0000000121 00000 n \n' +
      'trailer\n<< /Size 4 /Root 1 0 R >>\n' +
      'startxref\n192\n' +
      '%%EOF\n',
    'latin1'
  );
}

test('Mapa prático: funções públicas do core', () => {
  const runId = crypto.randomUUID();
  const createdAt = '2026-05-27T00:00:00Z';
  const issuedAt = '2026-05-28T00:00:00Z';

  // 01. canonicalJson: transforma JSON textual em uma forma canônica estável.
  const canonical = core.canonicalJson('{"z":2,"a":{"b":2,"a":1}}');
  assert.equal(canonical, '{"a":{"a":1,"b":2},"z":2}');

  // 02. canonicalJsonFile: transforma um arquivo JSON UTF-8 em forma canônica RFC 8785/JCS.
  const canonicalJsonPath = path.join(outputDir, `${runId}-canonical.json`);
  fs.writeFileSync(canonicalJsonPath, '{ "z": 2, "a": { "b": 2, "a": 1 } }\n', 'utf8');
  assert.equal(core.canonicalJsonFile(canonicalJsonPath), canonical);

  // 03. canonicalJsonHashBase64url: calcula hash do JSON canônico em base64url.
  const canonicalHash = core.canonicalJsonHashBase64url('{"b":2,"a":1}');
  assert.equal(canonicalHash, core.canonicalJsonHashBase64url('{"a":1,"b":2}'));
  assert.equal(typeof canonicalHash, 'string');

  // 05. sha3_256Base64url: calcula SHA3-256 de bytes e retorna base64url.
  const bytesForHash = Buffer.from('exemplo de bytes', 'utf8');
  const hashBase64url = core.sha3_256Base64url(bytesForHash);
  assert.equal(typeof hashBase64url, 'string');

  // 06. sha3_256Hex: calcula SHA3-256 de bytes e retorna hexadecimal.
  const hashHex = core.sha3_256Hex(bytesForHash);
  assert.match(hashHex, /^[0-9a-f]{64}$/);

  // 07. base64urlEncode: codifica bytes para transporte textual seguro.
  const encoded = core.base64urlEncode(Buffer.from('SSI-PQ em português', 'utf8'));
  assert.equal(encoded.includes('='), false);

  // 08. base64urlDecode: recupera os bytes originais codificados em base64url.
  const decoded = Buffer.from(core.base64urlDecode(encoded));
  assert.equal(decoded.toString('utf8'), 'SSI-PQ em português');

  // 09. secureRandomKey: gera material de chave seguro dentro do core Rust.
  const randomKey = Buffer.from(core.secureRandomKey(32));
  assert.equal(randomKey.length, 32);

  // 10. supportedProfiles: lista os perfis pós-quânticos aceitos pelo core.
  const profiles = core.supportedProfiles();
  assert.equal(profiles.includes('ML-DSA-65'), true);
  assert.equal(profiles.includes('ML-KEM-768'), true);

  // 11. mldsaGenerateKeypair: gera chaves ML-DSA para assinatura digital.
  const mldsaKeyPair = core.mldsaGenerateKeypair('ML-DSA-65');
  assert.equal(mldsaKeyPair.profile, 'ML-DSA-65');
  assert.equal(typeof mldsaKeyPair.publicKey, 'string');
  assert.equal(typeof mldsaKeyPair.privateKey, 'string');

  // 12. mldsaSign: assina uma mensagem com a chave privada ML-DSA.
  const message = Buffer.from('mensagem assinada no mapa prático', 'utf8');
  const context = 'SSI_PQ_CORE_API_MAP_TEST';
  const signature = core.mldsaSign('ML-DSA-65', mldsaKeyPair.privateKey, message, context);
  assert.equal(typeof signature, 'string');

  // 13. mldsaVerify: verifica a assinatura com a chave pública correspondente.
  assert.equal(core.mldsaVerify('ML-DSA-65', mldsaKeyPair.publicKey, message, context, signature), true);
  assert.equal(
    core.mldsaVerify(
      'ML-DSA-65',
      mldsaKeyPair.publicKey,
      Buffer.from('mensagem alterada', 'utf8'),
      context,
      signature
    ),
    false
  );

  // 14. mlkemGenerateKeypair: gera chaves ML-KEM para encapsular segredos.
  const mlkemKeyPair = core.mlkemGenerateKeypair('ML-KEM-768');
  assert.equal(mlkemKeyPair.profile, 'ML-KEM-768');

  // 15. mlkemEncapsulate: cria ciphertext e segredo compartilhado para a chave pública.
  const encapsulation = core.mlkemEncapsulate('ML-KEM-768', mlkemKeyPair.publicKey);
  assert.equal(encapsulation.profile, 'ML-KEM-768');
  assert.equal(typeof encapsulation.ciphertext, 'string');
  assert.equal(typeof encapsulation.sharedSecret, 'string');

  // 16. mlkemDecapsulate: recupera o mesmo segredo com a chave privada.
  const decapsulated = core.mlkemDecapsulate(
    'ML-KEM-768',
    mlkemKeyPair.privateKey,
    encapsulation.ciphertext
  );
  assert.equal(decapsulated, encapsulation.sharedSecret);

  // 17. aes256GcmEncrypt: cifra bytes com AES-256-GCM e nonce gerado no core.
  const plaintext = Buffer.from('conteúdo confidencial', 'utf8');
  const aad = Buffer.from('metadado autenticado', 'utf8');
  const encrypted = core.aes256GcmEncrypt(randomKey, plaintext, aad);
  assert.equal(Buffer.from(encrypted.nonce).length, 12);
  assert.equal(Buffer.from(encrypted.authTag).length, 16);
  assert.notDeepEqual(Buffer.from(encrypted.ciphertext), plaintext);

  // 18. aes256GcmDecrypt: decifra e autentica ciphertext, nonce, tag e AAD.
  const decrypted = Buffer.from(
    core.aes256GcmDecrypt(randomKey, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, aad)
  );
  assert.deepEqual(decrypted, plaintext);

  // 19. createDid: cria DID SSI-PQ fora da wallet, retornando chaves privadas para testes.
  const issuer = core.createDid({
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });
  assert.equal(issuer.did.startsWith('did:ssipq:z'), true);
  assert.equal(typeof issuer.privateKeys.mldsaPrivateKey, 'string');
  assert.equal(typeof issuer.privateKeys.mlkemPrivateKey, 'string');

  // 20. didVerify: verifica assinatura e coerência do DID Document.
  assert.equal(core.didVerify(issuer.didDocument), true);

  // 21. didFingerprintMatchesKeys: confere se o DID bate com as chaves públicas.
  assert.equal(core.didFingerprintMatchesKeys(issuer.didDocument), true);

  // 04. issuerIdentifierBase64: deriva o identificador estável do emissor.
  const issuerIdentifier = core.issuerIdentifierBase64(issuer.didDocument);
  assert.equal(typeof issuerIdentifier, 'string');

  const attributes = {
    titular: {
      nome: 'Ana Silva',
      documento: {
        tipo: 'CPF',
        numero: '123.456.789-00'
      }
    },
    curso: 'Criptografia Aplicada',
    nivel: 'Avançado',
    carga_horaria: 40
  };

  // 22. createSchemaFromAttributes: infere um Schema SSI-PQ a partir dos atributos.
  const schema = core.createSchemaFromAttributes(attributes, {
    version: '1',
    createdAt
  });
  assert.equal(schema.type, 'ssi_schema_v1');
  assert.equal(Array.isArray(schema.attributes), true);

  // 03. schemaHashBase64: calcula o hash lógico do Schema já criado.
  const schemaHash = core.schemaHashBase64(schema);
  assert.equal(typeof schemaHash, 'string');

  // 23. issueCredentialFromSchema: emite credencial assinada usando chave privada direta.
  const signedCredential = core.issueCredentialFromSchema(
    schema,
    attributes,
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    {
      credentialId: `cred_core_api_map_${runId}`,
      issuedAt,
      visiblePaths: ['titular.nome', 'curso', 'nivel']
    }
  );
  assert.equal(signedCredential.credential.issuer_identifier, issuerIdentifier);
  assert.equal(signedCredential.credential.credential_id, `cred_core_api_map_${runId}`);

  // 24. verifySignedCredential: valida assinatura ML-DSA e provas Merkle da credencial.
  assert.equal(core.verifySignedCredential(signedCredential, issuer.didDocument), true);

  // 25. signedCredentialToPdf: renderiza a credencial em um PDF visual.
  const pdfBase = Buffer.from(
    core.signedCredentialToPdf(signedCredential, {
      labels: {
        'titular.nome': 'Nome do titular',
        curso: 'Curso',
        nivel: 'Nível'
      }
    })
  );
  assert.equal(pdfBase.subarray(0, 5).toString('latin1'), '%PDF-');

  // 26. embedSignedCredentialInPdf: embute a credencial no PDF e assina o vínculo PDF↔JSON.
  const finalCredentialPdf = Buffer.from(
    core.embedSignedCredentialInPdf(
      pdfBase,
      signedCredential,
      issuer.didDocument,
      issuer.privateKeys.mldsaPrivateKey,
      { createdAt, didDocCid: 'bafy-api-map-did-doc' }
    )
  );
  assert.equal(finalCredentialPdf.length > pdfBase.length, true);

  // 27. extractCredentialManifestFromPdf: lê o manifesto SSI-PQ embutido no PDF.
  const credentialManifest = core.extractCredentialManifestFromPdf(finalCredentialPdf);
  assert.equal(credentialManifest.type, 'ssi_pdf_signature_v1');
  assert.equal(credentialManifest.signed_credential.credential.credential_id, signedCredential.credential.credential_id);

  // 28. verifySignedCredentialPdf: valida PDF, manifesto, credencial interna e vínculo.
  const credentialPdfVerification = core.verifySignedCredentialPdf(finalCredentialPdf, issuer.didDocument);
  assert.equal(credentialPdfVerification.valid, true);
  assert.equal(credentialPdfVerification.credential_signature_valid, true);
  assert.equal(credentialPdfVerification.document_binding_signature_valid, true);
  assert.equal(credentialPdfVerification.pdf_base_hash_valid, true);

  const walletPath = path.join(outputDir, `core-api-map-wallet-${runId}.db`);
  const walletPassword = 'senha didatica forte 123';
  const changedWalletPassword = 'senha didatica forte alterada 456';

  // 31. walletCreate: cria uma wallet cifrada por SQLCipher.
  const walletInfo = core.walletCreate(walletPath, walletPassword, { createdAt });
  assert.equal(walletInfo.did_count, 0);
  assert.equal(walletInfo.version, 2);

  // 32. walletOpen: abre a wallet e retorna metadados públicos.
  const openedWallet = core.walletOpen(walletPath, walletPassword);
  assert.equal(openedWallet.did_count, 0);
  assert.equal(openedWallet.version, walletInfo.version);

  // 34. walletCreateDid: cria DID dentro da wallet sem exportar chaves privadas.
  const walletDid = core.walletCreateDid(walletPath, walletPassword, {
    label: 'Emissor didático na wallet',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt,
    didDocCid: 'bafy-wallet-did-doc'
  });
  assert.equal(walletDid.did.startsWith('did:ssipq:z'), true);
  assert.equal(walletDid.privateKeys, undefined);

  // 35. walletListDids: lista os DIDs armazenados na wallet.
  const walletDids = core.walletListDids(walletPath, walletPassword);
  assert.equal(walletDids.length, 1);
  assert.equal(walletDids[0].did, walletDid.did);
  assert.equal(walletDids[0].label, 'Emissor didático na wallet');

  // 36. walletGetDidDocument: exporta apenas o DID Document público da wallet.
  const walletDidDocument = core.walletGetDidDocument(walletPath, walletPassword, walletDid.did);
  assert.equal(walletDidDocument.id, walletDid.did);
  assert.equal(core.didVerify(walletDidDocument), true);

  // 37. walletIssueCredentialFromSchema: assina credencial usando a chave protegida na wallet.
  const walletSignedCredential = core.walletIssueCredentialFromSchema(
    walletPath,
    walletPassword,
    walletDid.did,
    schema,
    attributes,
    {
      credentialId: `cred_wallet_core_api_map_${runId}`,
      issuedAt,
      visiblePaths: ['titular.nome', 'curso', 'nivel']
    }
  );
  assert.equal(core.verifySignedCredential(walletSignedCredential, walletDidDocument), true);

  const walletPdfBase = Buffer.from(core.signedCredentialToPdf(walletSignedCredential));

  // 38. walletEmbedSignedCredentialInPdf: embute a credencial no PDF sem exportar chave privada.
  const walletCredentialPdf = Buffer.from(
    core.walletEmbedSignedCredentialInPdf(
      walletPath,
      walletPassword,
      walletDid.did,
      walletPdfBase,
      walletSignedCredential,
      { createdAt }
    )
  );
  assert.equal(core.verifySignedCredentialPdf(walletCredentialPdf, walletDidDocument).valid, true);

  // 39. walletSignGenericPdf: assina um PDF genérico com a chave ML-DSA da wallet.
  const genericPdfBase = minimalPdfBase();
  const genericSignedPdf = Buffer.from(
    core.walletSignGenericPdf(walletPath, walletPassword, walletDid.did, genericPdfBase, {
      createdAt,
      visualSignature: {
        mode: 'visible',
        placement: 'firstPageFooter',
        text: 'Assinado digitalmente pelo mapa prático SSI-PQ'
      }
    })
  );
  assert.equal(genericSignedPdf.length > genericPdfBase.length, true);

  // 29. extractGenericSignatureManifestFromPdf: extrai o manifesto de assinatura genérica.
  const genericManifest = core.extractGenericSignatureManifestFromPdf(genericSignedPdf);
  assert.equal(genericManifest.type, 'ssi_generic_pdf_signature_v1');
  assert.equal(genericManifest.signer_did, walletDid.did);

  // 30. verifySignedGenericPdf: valida assinatura genérica, ByteRange, manifesto e DID.
  const genericVerification = core.verifySignedGenericPdf(genericSignedPdf, walletDidDocument);
  assert.equal(genericVerification.valid, true);
  assert.equal(genericVerification.signature_valid, true);
  assert.equal(genericVerification.pdf_base_hash_valid, true);

  // Prepara um encapsulamento ML-KEM para demonstrar decapsulamento pela wallet.
  const walletMlkemPublicKey = mlkemPublicKeyBase64urlFromDidDocument(walletDidDocument);
  const walletEncapsulation = core.mlkemEncapsulate('ML-KEM-768', walletMlkemPublicKey);

  // 33. walletChangePassword: troca a senha e recifra banco e chaves privadas.
  const changedWallet = core.walletChangePassword(walletPath, walletPassword, changedWalletPassword);
  assert.equal(changedWallet.did_count, 1);
  assert.throws(() => core.walletOpen(walletPath, walletPassword));
  assert.equal(core.walletOpen(walletPath, changedWalletPassword).did_count, 1);

  // 40. walletMlkemDecapsulate: usa a chave ML-KEM protegida na wallet para recuperar o segredo.
  const walletSharedSecret = core.walletMlkemDecapsulate(
    walletPath,
    changedWalletPassword,
    walletDid.did,
    walletEncapsulation.ciphertext
  );
  assert.equal(walletSharedSecret, walletEncapsulation.sharedSecret);

  // Guarda alguns artefatos do mapa prático para inspeção manual quando desejado.
  fs.writeFileSync(path.join(outputDir, `credential-${runId}.pdf`), finalCredentialPdf);
  fs.writeFileSync(path.join(outputDir, `wallet-credential-${runId}.pdf`), walletCredentialPdf);
  fs.writeFileSync(path.join(outputDir, `generic-signed-${runId}.pdf`), genericSignedPdf);
});
