/**
 * Este teste cobre um ciclo completo executado pela biblioteca WebAssembly:
 * geracao de DID, schema aninhado, credencial assinada, PDF com labels
 * visuais PT-BR, manifesto SSI-PQ embutido e verificacao do PDF final.
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

const outputDir = path.join(__dirname, '..', 'test-output', 'wasm-nested-labels-flow');
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

function winAnsiHex(text) {
  return [...text.normalize('NFC')]
    .map((char) => {
      const codePoint = char.codePointAt(0);

      if (codePoint >= 0x20 && codePoint <= 0x7e) {
        return codePoint;
      }
      if (codePoint >= 0xa0 && codePoint <= 0xff) {
        return codePoint;
      }
      return 0x3f;
    })
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

test('WASM full flow: DID, nested credential, labeled PDF and verification', () => {
  const runId = crypto.randomUUID();
  const issuer = fromJson(
    wasm.createDidJson(
      toJson({
        mldsa: 'ML-DSA-65',
        mlkem: 'ML-KEM-768',
        createdAt
      })
    )
  );
  const mlkemKey = issuer.didDocument.keys.find((key) => key.id === '#mlkem-1');

  assert.equal(issuer.did.startsWith('did:ssipq:z'), true);
  assert.equal(issuer.didDocument.id, issuer.did);
  assert.equal(typeof issuer.privateKeys.mldsaPrivateKey, 'string');
  assert.equal(mlkemKey.type, 'ML-KEM-768');
  assert.deepEqual(fromJson(wasm.verifyDidDocumentJson(toJson(issuer.didDocument))), {
    valid: true,
    fingerprintMatchesKeys: true
  });
  writeJson(`issuer-public-${runId}.json`, {
    did: issuer.did,
    fingerprint: issuer.fingerprint,
    didDocument: issuer.didDocument
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
      rua: 'Rua S\u00e3o Jos\u00e9',
      numero: 42,
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
  writeJson(`credential-data-${runId}.json`, credentialData);

  const schema = fromJson(
    wasm.createSchemaFromAttributesJson(
      toJson(credentialData),
      toJson({ version: '1', createdAt })
    )
  );
  writeJson(`schema-${runId}.json`, schema);

  const signedCredential = fromJson(
    wasm.issueCredentialFromSchemaJson(
      toJson(schema),
      toJson(credentialData),
      toJson(issuer.didDocument),
      issuer.privateKeys.mldsaPrivateKey,
      toJson({
        credentialId: 'cred_wasm_nested_labels_test',
        issuedAt,
        visiblePaths
      })
    )
  );
  writeJson(`signed-credential-${runId}.json`, signedCredential);

  assert.equal(signedCredential.type, 'ssi_signed_credential_v2');
  assert.deepEqual(
    fromJson(
      wasm.verifySignedCredentialJson(toJson(signedCredential), toJson(issuer.didDocument))
    ),
    { valid: true }
  );

  const pdfBase = wasm.signedCredentialToPdfBytes(
    toJson(signedCredential),
    toJson({ labels: pdfLabels })
  );
  fs.writeFileSync(
    path.join(outputDir, `credencial-labels-base-${runId}.pdf`),
    Buffer.from(pdfBase)
  );
  const pdfBaseText = Buffer.from(pdfBase).toString('latin1');

  assert.equal(Buffer.from(pdfBase).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(pdfBaseText.includes(winAnsiHex('Endere\u00e7o')), true);
  assert.equal(pdfBaseText.includes(winAnsiHex('Forma\u00e7\u00e3o')), true);
  assert.equal(
    pdfBaseText.includes(winAnsiHex('Documento > Numero: 123.456.789-00')),
    true
  );
  assert.equal(pdfBaseText.includes(winAnsiHex('Documento > Tipo: CPF')), true);
  assert.equal(
    pdfBaseText.includes(winAnsiHex('Institui\u00e7\u00e3o > Nome: SSI-PQ Academy')),
    true
  );
  assert.equal(pdfBaseText.includes(winAnsiHex('N\u00edvel: Avan\u00e7ado')), true);
  assert.equal(pdfBaseText.includes(winAnsiHex('Cidade: S\u00e3o Paulo')), true);

  const finalPdf = wasm.embedSignedCredentialInPdfBytes(
    pdfBase,
    toJson(signedCredential),
    toJson(issuer.didDocument),
    issuer.privateKeys.mldsaPrivateKey,
    toJson({ createdAt, didDocCid: 'bafy-wasm-nested-labels-did-doc' })
  );
  fs.writeFileSync(
    path.join(outputDir, `credencial-labels-${runId}.pdf`),
    Buffer.from(finalPdf)
  );

  assert.equal(Buffer.from(finalPdf).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(finalPdf.length > pdfBase.length, true);

  const verification = fromJson(
    wasm.verifySignedCredentialPdfJson(finalPdf, toJson(issuer.didDocument))
  );
  assert.equal(verification.valid, true);
  assert.equal(verification.pdf_base_hash_valid, true);
  assert.equal(verification.credential_signature_valid, true);
  assert.equal(verification.document_binding_signature_valid, true);
  writeJson(`credencial-labels-verification-${runId}.json`, verification);

  const manifest = fromJson(wasm.extractCredentialManifestFromPdfBytes(finalPdf));
  writeJson(`credencial-labels-manifest-${runId}.json`, manifest);
  const extractedCredential = manifest.signed_credential;

  assert.equal(extractedCredential.type, 'ssi_signed_credential_v2');
  assert.equal(
    extractedCredential.credential.credential_id,
    'cred_wasm_nested_labels_test'
  );
  assert.deepEqual(
    extractedCredential.attribute_disclosures.map((disclosure) => [
      disclosure.path,
      disclosure.value
    ]),
    [
      ['subject.endereco.cidade', 'S\u00e3o Paulo'],
      ['subject.formacao.curso', 'Criptografia P\u00f3s-Qu\u00e2ntica'],
      ['subject.formacao.instituicao.nome', 'SSI-PQ Academy'],
      ['subject.nivel', 'Avan\u00e7ado'],
      ['subject.titular.documento.numero', '123.456.789-00'],
      ['subject.titular.documento.tipo', 'CPF'],
      ['subject.titular.nome', 'Alice Silva']
    ]
  );
});
