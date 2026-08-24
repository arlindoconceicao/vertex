/**
 * Script de Teste: Verificação de Autenticidade e Integridade de DID Documents Pós-Quânticos
 * 
 * Uso: 
 *   npx tsx lib/test-did-verify.ts <email_do_usuario>
 *   Exemplo: npx tsx lib/test-did-verify.ts usuario@exemplo.com
 * 
 * Descrição:
 *   Este script realiza um teste completo ponta a ponta para atestar a segurança e a integridade
 *   dos DID Documents armazenados na plataforma. Ele busca o documento W3C a partir do e-mail
 *   fornecido, utilizando os fluxos nativos de desafio M2M da API.
 * 
 * Ênfase em Validação Criptográfica:
 *   O principal objetivo do teste é colocar à prova a função `verifyDidDocument`, a qual delega
 *   as rotinas criptográficas pesadas (ML-DSA) para o módulo nativo (ssi_pq_core.node). O sistema
 *   atesta se o documento é genuíno validando tanto a assinatura digital embutida (proof/signature)
 *   quanto a consistência do identificador DID em relação à chave pública contida no payload (fingerprint).
 * 
 *   O teste simula 4 cenários (1 de sucesso e 3 ataques maliciosos):
 *   - Verificação do documento íntegro.
 *   - Teste A: Mutação no ID base do DID.
 *   - Teste B: Mutação na string Multibase da chave ML-DSA.
 *   - Teste C: Mutação na string Multibase da chave ML-KEM.
 *   - Teste D: Mutação na própria assinatura (signature/proof).
 *   Todos os testes de mutação (ataques) devem resultar em REJEIÇÃO do pacote pelas rotinas matemáticas nativas.
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getSsiPqCore, verifyDidDocument } from "../src/lib/ssi-pq";
import { generateSignerToken } from "../src/lib/signer-auth";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/dids/search/challenge/route";
import { GET } from "../src/app/api/dids/search/route";

async function runTest() {
  const emailToSearch = process.argv[2];
  if (!emailToSearch) {
    throw new Error("Por favor, forneça o e-mail do usuário como parâmetro. Ex: npx tsx lib/test-did-verify.ts usuario@exemplo.com");
  }

  const core = getSsiPqCore();
  console.log(`[1] Iniciando teste de verificação do DID Document para o e-mail: ${emailToSearch}`);

  // Create a temporary requester user to access the API
  console.log("[2] Criando usuário requisitante (Mobile App) temporário...");
  const requesterDidData = core.createDid({});
  const requesterUser = await prisma.user.create({
    data: {
      email: "temp-requester@test.com",
      did: requesterDidData.did,
      didPublicKey: requesterDidData.didDocument.verificationMethod
        ? (requesterDidData.didDocument.verificationMethod as any)[0].publicKeyMultibase
        : null,
      didDocument: requesterDidData.didDocument as any,
    },
  });

  try {
    // Generate M2M token
    console.log("[3] Gerando token M2M e solicitando desafio...");
    const m2mToken = generateSignerToken(requesterUser.did!);

    // Request Challenge
    const challengeReq = new NextRequest("http://localhost/api/dids/search/challenge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${m2mToken}`,
      },
      body: JSON.stringify({ requesterId: requesterUser.id }),
    });

    const challengeRes = await POST(challengeReq);
    const challengeData = await challengeRes.json();
    
    if (challengeRes.status !== 201) {
      throw new Error(`Falha ao obter desafio: ${JSON.stringify(challengeData)}`);
    }

    const nonceBuffer = Buffer.from(challengeData.nonce, "utf-8");

    // Sign the challenge
    const signature = core.mldsaSign(
      "ML-DSA-65",
      requesterDidData.privateKeys.mldsaPrivateKey,
      nonceBuffer,
      "did-search-challenge"
    );

    // Request Target User DID by email
    console.log("[4] Buscando o DID Document via endpoint da plataforma...");
    const searchReq = new NextRequest(`http://localhost/api/dids/search?email=${encodeURIComponent(emailToSearch)}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${m2mToken}`,
        "x-requester-id": requesterUser.id,
        "x-challenge-id": challengeData.id,
        "x-challenge-signature": signature,
      },
    });

    const searchRes = await GET(searchReq);
    const searchData = await searchRes.json();
    
    if (searchRes.status !== 200) {
      throw new Error(`Falha ao buscar DID: ${JSON.stringify(searchData)}`);
    }

    const didDocument = searchData.didDocument;
    if (!didDocument) {
      throw new Error("O usuário foi encontrado, mas não possui um DID Document estruturado.");
    }

    console.log("\n--- DID Document Recebido ---");
    console.log(JSON.stringify(didDocument, null, 2));

    // Validating the legitimate document
    console.log("\n[5] Verificando o documento íntegro...");
    const isAuthentic = verifyDidDocument(didDocument);
    if (isAuthentic) {
      console.log("✅ Sucesso: A assinatura e a integridade do DID Document original são VÁLIDAS.");
    } else {
      console.log("❌ Falha: O DID Document original não passou na verificação (esperado válido).");
    }

    // Tampering with the document
    console.log("\n[6] Realizando 3 alterações maliciosas no documento (uma de cada vez)...");
    
    // 6.1 Adulterando o ID
    console.log("\n--- Teste A: Adulterando o ID do DID Document ---");
    const tamperedIdDoc = JSON.parse(JSON.stringify(didDocument));
    tamperedIdDoc.id = tamperedIdDoc.id + "x";
    console.log(`ID Original: ${didDocument.id}`);
    console.log(`ID Adulterado: ${tamperedIdDoc.id}`);
    if (!verifyDidDocument(tamperedIdDoc)) {
      console.log("✅ Pacote Rejeitado: O DID Document com ID adulterado foi INVÁLIDO (comportamento correto).");
    } else {
      console.log("❌ Erro Crítico: O sistema aceitou um DID Document com ID adulterado.");
    }

    // 6.2 Adulterando a chave ML-DSA
    console.log("\n--- Teste B: Adulterando a chave pública ML-DSA ---");
    const tamperedDsaDoc = JSON.parse(JSON.stringify(didDocument));
    let dsaKeyFound = false;
    if (tamperedDsaDoc.keys) {
      const k = tamperedDsaDoc.keys.find((key: any) => key.type === "ML-DSA-65" || key.type === "ML-DSA" || key.id?.includes("mldsa"));
      if (k && (k.public_key_multibase || k.publicKeyMultibase)) {
        if (k.public_key_multibase) k.public_key_multibase = k.public_key_multibase + "a";
        if (k.publicKeyMultibase) k.publicKeyMultibase = k.publicKeyMultibase + "a";
        dsaKeyFound = true;
      }
    }
    if (!dsaKeyFound && tamperedDsaDoc.verificationMethod) {
      const vm = tamperedDsaDoc.verificationMethod.find((m: any) => m.type === "ML-DSA" || m.type === "ML-DSA-65" || m.id?.includes("mldsa"));
      if (vm && (vm.publicKeyMultibase || vm.public_key_multibase)) {
        if (vm.publicKeyMultibase) vm.publicKeyMultibase = vm.publicKeyMultibase + "a";
        if (vm.public_key_multibase) vm.public_key_multibase = vm.public_key_multibase + "a";
        dsaKeyFound = true;
      }
    }
    if (dsaKeyFound) {
      if (!verifyDidDocument(tamperedDsaDoc)) {
        console.log("✅ Pacote Rejeitado: O DID Document com chave ML-DSA adulterada foi INVÁLIDO (comportamento correto).");
      } else {
        console.log("❌ Erro Crítico: O sistema aceitou um DID Document com chave ML-DSA adulterada.");
      }
    } else {
      console.log("⚠️ Nenhuma chave ML-DSA explícita encontrada no documento para adulterar.");
    }

    // 6.3 Adulterando a chave ML-KEM
    console.log("\n--- Teste C: Adulterando a chave pública ML-KEM ---");
    const tamperedKemDoc = JSON.parse(JSON.stringify(didDocument));
    let kemKeyFound = false;
    if (tamperedKemDoc.keys) {
      const k = tamperedKemDoc.keys.find((key: any) => key.type === "ML-KEM-768" || key.type === "ML-KEM" || key.id?.includes("mlkem"));
      if (k && (k.public_key_multibase || k.publicKeyMultibase)) {
        if (k.public_key_multibase) k.public_key_multibase = k.public_key_multibase + "b";
        if (k.publicKeyMultibase) k.publicKeyMultibase = k.publicKeyMultibase + "b";
        kemKeyFound = true;
      }
    }
    if (!kemKeyFound && tamperedKemDoc.verificationMethod) {
      const vm = tamperedKemDoc.verificationMethod.find((m: any) => m.type === "ML-KEM" || m.type === "ML-KEM-768" || m.id?.includes("mlkem"));
      if (vm && (vm.publicKeyMultibase || vm.public_key_multibase)) {
        if (vm.publicKeyMultibase) vm.publicKeyMultibase = vm.publicKeyMultibase + "b";
        if (vm.public_key_multibase) vm.public_key_multibase = vm.public_key_multibase + "b";
        kemKeyFound = true;
      }
    }
    if (kemKeyFound) {
      if (!verifyDidDocument(tamperedKemDoc)) {
        console.log("✅ Pacote Rejeitado: O DID Document com chave ML-KEM adulterada foi INVÁLIDO (comportamento correto).");
      } else {
        console.log("❌ Erro Crítico: O sistema aceitou um DID Document com chave ML-KEM adulterada.");
      }
    } else {
      console.log("⚠️ Nenhuma chave ML-KEM explícita encontrada no documento para adulterar.");
    }

    // 6.4 Adulterando a própria assinatura (signature/proof)
    console.log("\n--- Teste D: Adulterando a própria assinatura (signature/proof) do documento ---");
    const tamperedSigDoc = JSON.parse(JSON.stringify(didDocument));
    let sigFound = false;
    
    // Função auxiliar para adulterar sem mudar o tamanho do base64url
    const tamperBase64 = (str: string) => {
      if (!str) return str;
      const lastChar = str[str.length - 1];
      const newChar = lastChar === 'A' ? 'B' : 'A';
      return str.substring(0, str.length - 1) + newChar;
    };

    // Suporte para o formato com "signature" raiz
    if (tamperedSigDoc.signature && tamperedSigDoc.signature.value) {
      tamperedSigDoc.signature.value = tamperBase64(tamperedSigDoc.signature.value);
      sigFound = true;
    } else if (tamperedSigDoc.proof) { // Suporte W3C genérico
      if (tamperedSigDoc.proof.proofValue) {
        tamperedSigDoc.proof.proofValue = tamperBase64(tamperedSigDoc.proof.proofValue);
        sigFound = true;
      } else if (tamperedSigDoc.proof.signatureValue) {
        tamperedSigDoc.proof.signatureValue = tamperBase64(tamperedSigDoc.proof.signatureValue);
        sigFound = true;
      }
    }

    if (sigFound) {
      try {
        if (!verifyDidDocument(tamperedSigDoc)) {
          console.log("✅ Pacote Rejeitado: O DID Document com ASSINATURA adulterada foi INVÁLIDO (comportamento esperado).");
        } else {
          console.log("❌ Erro Crítico: O sistema aceitou um DID Document com ASSINATURA adulterada.");
        }
      } catch (err: any) {
        // Em alguns casos o parser de base64/criptografia pode estourar erro antes de retornar false, o que também é uma rejeição válida.
        console.log("✅ Pacote Rejeitado: O documento adulterado causou falha na decodificação estrutural da assinatura (comportamento esperado). Erro capturado silenciosamente.");
      }
    } else {
      console.log("⚠️ Nenhuma assinatura embutida (signature ou proof) encontrada no documento para adulterar.");
    }

  } finally {
    // Cleanup
    console.log("\n[8] Limpando usuário temporário do banco...");
    await prisma.user.delete({ where: { id: requesterUser.id } });
    await prisma.$disconnect();
  }
}

runTest().catch((e) => {
  console.error("\nErro durante o teste:", e);
  process.exit(1);
});
