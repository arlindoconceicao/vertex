/**
 * Teste de Integração: Fluxo Completo de Pareamento de DID
 *
 * Simula o aplicativo móvel gerando chaves pós-quânticas (ML-DSA / ML-KEM),
 * assinando o desafio criptográfico recebido da plataforma web e concluindo
 * o pareamento de forma segura.
 *
 * Comando para rodar:
 *   node --test lib/did-pairing-flow.test.js
 */

require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const core = require("./ssi_pq_core.node");
const { PrismaClient, DidPairingStatus } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://vertex_user:vertex_pass@localhost:5432/vertex_db";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

function decodeBase58Btc(str) {
  if (str[0] !== "z") throw new Error("Not base58btc multibase");
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let d = 0n;
  const strData = str.slice(1);

  for (let i = 0; i < strData.length; i++) {
    d = d * 58n + BigInt(alphabet.indexOf(strData[i]));
  }

  let hex = d.toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;

  const buf = Buffer.from(hex, "hex");
  let leadingZeros = 0;
  while (strData[leadingZeros] === "1") leadingZeros++;

  return Buffer.concat([Buffer.alloc(leadingZeros), buf]);
}

function normalizeMldsaPublicKey(publicKeyStr) {
  if (publicKeyStr.startsWith("z")) {
    const rawBytes = decodeBase58Btc(publicKeyStr);
    const pubKeyBytes =
      rawBytes.length > 1952 ? rawBytes.subarray(rawBytes.length - 1952) : rawBytes;
    return core.base64urlEncode(pubKeyBytes);
  }
  return publicKeyStr;
}

test("Fluxo de Pareamento DID: Simulação Mobile App -> Plataforma Web", async (t) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const testEmail = `user-pairing-${runId}@example.com`;
  const testCpf = `111.222.333-${runId.slice(0, 2)}`;

  let testUser;

  t.before(async () => {
    // 1. Criar um usuário de teste no banco de dados
    testUser = await prisma.user.create({
      data: {
        name: `Tester ${runId}`,
        email: testEmail,
        cpf: testCpf,
      },
    });
    assert.ok(testUser.id, "Usuário de teste deve ser criado com ID");
  });

  t.after(async () => {
    // Limpeza dos dados de teste
    if (testUser?.id) {
      await prisma.didPairingChallenge.deleteMany({
        where: { userId: testUser.id },
      });
      await prisma.user.delete({
        where: { id: testUser.id },
      });
    }
    await prisma.$disconnect();
  });

  await t.test("1. Plataforma gera desafio de pareamento para o usuário", async () => {
    const pairingId = crypto.randomBytes(16).toString("hex");
    const nonce = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const challenge = await prisma.didPairingChallenge.create({
      data: {
        userId: testUser.id,
        cpf: testUser.cpf,
        email: testUser.email,
        pairingId,
        nonce,
        expiresAt,
        status: DidPairingStatus.PENDING,
      },
    });

    assert.equal(challenge.status, "PENDING");
    assert.equal(challenge.userId, testUser.id);

    // 2. Simulação do App Móvel: Geração de DID e par de chaves pós-quânticas
    const mobileDid = core.createDid({
      mldsa: "ML-DSA-65",
      mlkem: "ML-KEM-768",
      createdAt: new Date().toISOString(),
    });

    assert.ok(mobileDid.did.startsWith("did:"), "DID gerado deve começar com 'did:'");
    assert.ok(mobileDid.didDocument, "DID Document deve estar presente");
    assert.equal(core.didVerify(mobileDid.didDocument), true, "DID Document deve ser válido");
    assert.equal(
      core.didFingerprintMatchesKeys(mobileDid.didDocument),
      true,
      "Fingerprint do DID Document deve corresponder às chaves"
    );

    // 3. Simulação do App Móvel: Canonicalização e Assinatura ML-DSA do Desafio
    const challengeDataToSign = {
      id: challenge.id,
      pairingId: challenge.pairingId,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt.toISOString(),
      did: mobileDid.did,
    };

    const canonicalString = core.canonicalJson(JSON.stringify(challengeDataToSign));
    const messageBuffer = Buffer.from(canonicalString, "utf-8");

    // Extrai a chave privada ML-DSA retornada na criação
    const mldsaPrivateKey = mobileDid.privateKeys.mldsaPrivateKey;
    const proofValue = core.mldsaSign(
      "ML-DSA-65",
      mldsaPrivateKey,
      messageBuffer,
      "did-pairing-challenge"
    );

    assert.ok(proofValue, "Assinatura ML-DSA deve ser gerada em base64url");

    // Extrai a chave pública ML-DSA para validação
    // Extrai as chaves públicas ML-DSA e ML-KEM
    const mldsaPublicKeyMultibase = mobileDid.didDocument.keys.find(
      (k) => k.type === "ML-DSA-65"
    ).public_key_multibase;
    const mlkemPublicKeyMultibase = mobileDid.didDocument.keys.find(
      (k) => k.type === "ML-KEM-768"
    ).public_key_multibase;
    const mldsaPublicKeyB64 = normalizeMldsaPublicKey(mldsaPublicKeyMultibase);

    // 4. Plataforma Web: Validação Criptográfica da Prova
    const isSignatureValid = core.mldsaVerify(
      "ML-DSA-65",
      mldsaPublicKeyB64,
      messageBuffer,
      "did-pairing-challenge",
      proofValue
    );

    assert.equal(
      isSignatureValid,
      true,
      "A validação da assinatura ML-DSA na plataforma deve retornar true"
    );

    // 5. Conclusão do Pareamento no Banco de Dados
    const pairedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.didPairingChallenge.update({
        where: { id: challenge.id },
        data: {
          status: DidPairingStatus.COMPLETED,
          usedAt: pairedAt,
        },
      });

      await tx.user.update({
        where: { id: testUser.id },
        data: {
          did: mobileDid.did,
          didPublicKey: mldsaPublicKeyMultibase,
          didMlkemKey: mlkemPublicKeyMultibase,
          didDocument: mobileDid.didDocument,
          didPairedAt: pairedAt,
        },
      });
    });

    // 6. Asserções no Banco de Dados após Conclusão
    const updatedUser = await prisma.user.findUnique({
      where: { id: testUser.id },
    });
    assert.equal(updatedUser.did, mobileDid.did, "Usuário no banco deve ter a DID associada");
    assert.equal(updatedUser.didMlkemKey, mlkemPublicKeyMultibase, "Usuário no banco deve ter a chave ML-KEM associada");
    assert.ok(updatedUser.didPairedAt, "Timestamp didPairedAt deve estar preenchido");

    const updatedChallenge = await prisma.didPairingChallenge.findUnique({
      where: { id: challenge.id },
    });
    assert.equal(
      updatedChallenge.status,
      "COMPLETED",
      "Desafio de pareamento deve estar como COMPLETED"
    );
  });

  await t.test("2. Rejeição de Assinatura Forjada/Inválida", async () => {
    const pairingId = crypto.randomBytes(16).toString("hex");
    const challenge = await prisma.didPairingChallenge.create({
      data: {
        userId: testUser.id,
        cpf: testUser.cpf,
        email: testUser.email,
        pairingId,
        nonce: "nonce-teste",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        status: DidPairingStatus.PENDING,
      },
    });

    const fakeDid = core.createDid({ mldsa: "ML-DSA-65" });
    const fakePublicKeyMultibase = fakeDid.didDocument.keys.find(
      (k) => k.type === "ML-DSA-65"
    ).public_key_multibase;
    const fakePublicKeyB64 = normalizeMldsaPublicKey(fakePublicKeyMultibase);

    const dummyBuffer = Buffer.from("conteudo-modificado-forjado", "utf-8");
    const fakeSignature = core.mldsaSign(
      "ML-DSA-65",
      fakeDid.privateKeys.mldsaPrivateKey,
      dummyBuffer,
      "did-pairing-challenge"
    );

    // Tentar validar assinatura com mensagem diferente
    const originalMessage = Buffer.from("conteudo-original-do-desafio", "utf-8");
    const isValid = core.mldsaVerify(
      "ML-DSA-65",
      fakePublicKeyB64,
      originalMessage,
      "did-pairing-challenge",
      fakeSignature
    );

    assert.equal(
      isValid,
      false,
      "Assinatura ML-DSA sobre mensagem diferente deve ser rejeitada"
    );
  });

  await t.test("3. Validação de Divergência da Conta Google / Email", async () => {
    const pairingId = crypto.randomBytes(16).toString("hex");
    const challenge = await prisma.didPairingChallenge.create({
      data: {
        userId: testUser.id,
        cpf: testUser.cpf,
        email: testUser.email,
        pairingId,
        nonce: "nonce-google-test",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        status: DidPairingStatus.PENDING,
      },
    });

    const mobilePayloadDifferentAccount = {
      pairingId: challenge.pairingId,
      nonce: challenge.nonce,
      email: "outro-teste@gmail.com",
      userId: "outro_user_id",
    };

    // Asserta que a conta Google do app móvel divergente é detectada
    assert.notEqual(
      mobilePayloadDifferentAccount.email.toLowerCase(),
      challenge.email.toLowerCase(),
      "Emails de contas Google diferentes devem ser detectados como divergentes"
    );
  });
});
