# Teste de Verificação Criptográfica de DID Documents

Este documento detalha o funcionamento e a execução do script de teste focado em validar a segurança e integridade criptográfica dos DID Documents (W3C) na plataforma, utilizando criptografia pós-quântica (PQC).

**Caminho do arquivo:** `lib/test-did-verify.ts`

## Objetivo

O objetivo deste teste é colocar à prova a função `verifyDidDocument` (e, por extensão, o módulo nativo `ssi_pq_core.node`) para garantir que qualquer documento adulterado seja sumariamente rejeitado pelas rotinas de validação criptográfica (ML-DSA).

O teste certifica que:
1. Um documento gerado genuinamente pelo usuário passe na validação de assinatura e estrutura.
2. Qualquer violação nas propriedades vitais quebre os vínculos do hash (impressão digital) ou invalide a prova matemática da assinatura, resultando na rejeição imediata do payload.

## Como Executar

Abra o seu terminal na raiz do projeto (`web-ssiaas`) e execute o script usando o `tsx`, fornecendo um endereço de e-mail registrado na base de dados de um usuário que já possua um DID válido.

```bash
npx tsx lib/test-did-verify.ts usuario@exemplo.com
```

> **Atenção:** Certifique-se de que o arquivo `.env` está configurado corretamente na raiz do projeto (com as variáveis de banco de dados e segredos M2M), pois o teste simula uma requisição do Mobile App e interage com o banco de dados temporariamente.

## Cenários Cobertos no Teste

O script simula o fluxo completo autenticando-se via endpoint M2M (`/api/dids/search`), baixando o documento e efetuando 5 checagens sequenciais.

### 1. Caminho Feliz (Documento Íntegro)
O DID Document buscado da base de dados é diretamente repassado ao `verifyDidDocument`.
- **Resultado Esperado:** O pacote é validado com SUCESSO.

### 2. Teste A: Mutação no Identificador (ID)
O identificador raiz do documento (`did:ssipq:...`) sofre a adição de um caractere.
- **Resultado Esperado:** Rejeição. O identificador adulterado não corresponde à chave pública (Fingerprint/Hash quebrado).

### 3. Teste B: Mutação na Chave de Assinatura (ML-DSA)
O conteúdo em base58BTC/base64 da chave de assinatura (ML-DSA-65) é modificado.
- **Resultado Esperado:** Rejeição. Como o identificador do DID deriva dessa chave, ao alterar a chave a correspondência matemática (Fingerprint) falha.

### 4. Teste C: Mutação na Chave de Cifragem (ML-KEM)
O conteúdo da chave de acordo de chaves (ML-KEM-768) é levemente adulterado.
- **Resultado Esperado:** Rejeição. Se aplicável através da prova de integridade ou do hash do documento inteiro, a adulteração será detectada.

### 5. Teste D: Mutação na Assinatura do Documento (Proof/Signature)
A assinatura digital base64url acoplada ao documento (`signature.value` ou `proof.proofValue`) é adulterada, mantendo seu tamanho original para forçar o motor matemático ML-DSA a rejeitar a assinatura.
- **Resultado Esperado:** Rejeição (ou erro estourado na decodificação nativa). A prova matemática comprova que o payload não foi assinado com a chave do dono.

## Limpeza (Cleanup)

Para não poluir o banco de dados, o script cria e deleta de forma assíncrona um usuário fictício de "requisitante" que serve apenas para gerar os tokens de autenticação máquina-para-máquina (M2M) e recuperar os dados pela API protegida.
