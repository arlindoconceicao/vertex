/**
 * Este teste exercita o backend wallet_storage exposto pelo WebAssembly.
 * A implementacao atual usa Storage em memoria no adapter WASM, mas a wallet
 * ja segue o contrato sem rusqlite: estado cifrado, chaves internas e API
 * sem exportar privateKey.
 *
 * Comando para rodar:
 *   npm run test:wasm
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const wasm = require('../packages/wasm-node/pkg/ssi_pq_wasm.js');

const outputDir = path.join(__dirname, '..', 'test-output', 'wasm-web-wallet-storage-flow');
fs.mkdirSync(outputDir, { recursive: true });

const createdAt = '2026-05-27T00:00:00Z';
const issuedAt = '2026-05-27T00:00:00Z';

function toJson(value) {
  return JSON.stringify(value);
}

function fromJson(text) {
  return JSON.parse(text);
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(outputDir, name), JSON.stringify(value, null, 2));
}

test('WASM web wallet storage flow signs without exporting private keys', () => {
  wasm.webWalletClearMemory();

  const runId = crypto.randomUUID();
  const walletName = `issuer-${runId}`;
  const password = 'senha-web-wallet-storage-123';
  const createdWallet = fromJson(
    wasm.webWalletCreateJson(walletName, password, toJson({ createdAt }))
  );

  assert.equal(createdWallet.backend, 'storage');
  assert.equal(createdWallet.did_count, 0);
  assert.throws(
    () => wasm.webWalletOpenJson(walletName, 'senha-errada'),
    /wallet password is invalid/
  );

  const didResult = fromJson(
    wasm.webWalletCreateDidJson(
      walletName,
      password,
      toJson({
        label: 'Emissor Web',
        mldsa: 'ML-DSA-65',
        mlkem: 'ML-KEM-768',
        createdAt
      })
    )
  );

  assert.equal(didResult.did.startsWith('did:ssipq:z'), true);
  assert.equal(didResult.did_document.id, didResult.did);
  assert.equal(didResult.privateKeys, undefined);

  const openedWallet = fromJson(wasm.webWalletOpenJson(walletName, password));
  const dids = fromJson(wasm.webWalletListDidsJson(walletName, password));
  const didDocument = fromJson(
    wasm.webWalletGetDidDocumentJson(walletName, password, didResult.did)
  );

  assert.equal(openedWallet.did_count, 1);
  assert.equal(dids.length, 1);
  assert.equal(dids[0].did, didResult.did);
  assert.deepEqual(didDocument, didResult.did_document);
  assert.deepEqual(fromJson(wasm.verifyDidDocumentJson(toJson(didDocument))), {
    valid: true,
    fingerprintMatchesKeys: true
  });

  const credentialData = {
    titular: {
      nome: 'Alice Silva',
      documento: {
        tipo: 'CPF',
        numero: '123.456.789-00'
      }
    },
    formacao: {
      curso: 'Criptografia P\u00f3s-Qu\u00e2ntica',
      instituicao: {
        nome: 'SSI-PQ Academy',
        cidade: 'S\u00e3o Paulo'
      }
    },
    endereco: {
      cidade: 'S\u00e3o Paulo'
    },
    nivel: 'Avan\u00e7ado'
  };
  const visiblePaths = [
    'titular.nome',
    'titular.documento.tipo',
    'titular.documento.numero',
    'formacao.curso',
    'formacao.instituicao.nome',
    'endereco.cidade',
    'nivel'
  ];
  const pdfLabels = {
    endereco: 'Endere\u00e7o',
    'endereco.cidade': 'Cidade',
    formacao: 'Forma\u00e7\u00e3o',
    'formacao.curso': 'Curso',
    'formacao.instituicao': 'Institui\u00e7\u00e3o',
    'formacao.instituicao.nome': 'Nome',
    nivel: 'N\u00edvel',
    titular: 'Titular',
    'titular.documento': 'Documento',
    'titular.documento.tipo': 'Tipo',
    'titular.nome': 'Nome'
  };

  const schema = fromJson(
    wasm.createSchemaFromAttributesJson(
      toJson(credentialData),
      toJson({ version: '1', createdAt })
    )
  );
  const signedCredential = fromJson(
    wasm.webWalletIssueCredentialFromSchemaJson(
      walletName,
      password,
      didResult.did,
      toJson(schema),
      toJson(credentialData),
      toJson({
        credentialId: 'cred_wasm_web_wallet_storage_test',
        issuedAt,
        visiblePaths
      })
    )
  );

  assert.equal(signedCredential.type, 'ssi_signed_credential_v2');
  assert.deepEqual(
    fromJson(wasm.verifySignedCredentialJson(toJson(signedCredential), toJson(didDocument))),
    { valid: true }
  );

  const pdfBase = wasm.signedCredentialToPdfBytes(
    toJson(signedCredential),
    toJson({ labels: pdfLabels })
  );
  const finalPdf = wasm.webWalletEmbedSignedCredentialInPdfBytes(
    walletName,
    password,
    didResult.did,
    pdfBase,
    toJson(signedCredential),
    toJson({ createdAt, didDocCid: 'bafy-web-wallet-storage-did-doc' })
  );
  const verification = fromJson(
    wasm.verifySignedCredentialPdfJson(finalPdf, toJson(didDocument))
  );
  const manifest = fromJson(wasm.extractCredentialManifestFromPdfBytes(finalPdf));

  assert.equal(Buffer.from(finalPdf).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(verification.valid, true);
  assert.equal(verification.pdf_base_hash_valid, true);
  assert.equal(verification.credential_signature_valid, true);
  assert.equal(verification.document_binding_signature_valid, true);
  assert.equal(
    manifest.signed_credential.credential.credential_id,
    'cred_wasm_web_wallet_storage_test'
  );

  writeJson(`wallet-info-${runId}.json`, openedWallet);
  writeJson(`did-document-${runId}.json`, didDocument);
  writeJson(`schema-${runId}.json`, schema);
  writeJson(`signed-credential-${runId}.json`, signedCredential);
  writeJson(`credencial-labels-manifest-${runId}.json`, manifest);
  writeJson(`credencial-labels-verification-${runId}.json`, verification);
  fs.writeFileSync(path.join(outputDir, `credencial-labels-base-${runId}.pdf`), Buffer.from(pdfBase));
  fs.writeFileSync(path.join(outputDir, `credencial-labels-${runId}.pdf`), Buffer.from(finalPdf));
});
