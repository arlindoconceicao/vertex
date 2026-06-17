# Credencial JSON, PDF e envio cifrado

Este documento descreve o fluxo atual do core SSI-PQ para:

- criar uma credencial JSON assinada a partir de um Schema;
- revelar apenas parte dos atributos usando compromissos Merkle;
- renderizar a credencial em PDF;
- embutir a credencial no PDF com um manifesto antifraude;
- verificar o PDF e a credencial JSON extraída;
- opcionalmente enviar o PDF final cifrado para um destinatário usando
  ML-KEM e AES-256-GCM.

A documentação foi alinhada com o código em `src/credential.rs`, `src/pdf.rs`,
`src/schema.rs`, `src/did.rs`, `src/wallet.rs`, `src/node.rs` e com os testes
Node em `test-node/core`.

## Visão geral

O sistema separa três camadas:

1. A credencial JSON precisa ser verificável sozinha.
2. O PDF precisa provar que o visual apresentado e a credencial embutida são o
   mesmo documento lógico.
3. O transporte cifrado, quando usado, protege a entrega do PDF ao destinatário,
   mas não substitui a verificação criptográfica do PDF e do JSON.

Por isso existem duas assinaturas ML-DSA no fluxo PDF-credencial:

1. `credential_signature`: assinatura da credencial canônica.
2. `document_binding_signature`: assinatura do vínculo entre o PDF-base e a
   credencial assinada embutida.

A primeira assinatura impede adulteração do conteúdo da credencial. A segunda
impede que uma credencial válida seja colocada em outro PDF, ou que o PDF visual
seja alterado depois que o manifesto foi anexado.

## DID, chaves e wallet

Um DID SSI-PQ contém, no formato atual:

- `type`: `ssi_pq_did_document_v1`;
- `id` e `controller` no formato `did:ssipq:z...`;
- `created_at`;
- chave pública `#mldsa-1`, usada para assinatura e verificação;
- chave pública `#mlkem-1`, usada para acordo/encapsulamento de segredo;
- `status`;
- assinatura do DID Document.

A função `create_did` gera as chaves ML-DSA e ML-KEM em memória. No fluxo de
plataforma, a wallet guarda as chaves privadas cifradas e expõe apenas o DID
Document público por `walletGetDidDocument`.

A wallet:

- é um banco SQLite cifrado por SQLCipher;
- deriva material de chave da senha com Argon2id;
- cifra chaves privadas por linha com AES-256-GCM;
- usa `#mldsa-1` para emitir credenciais e assinar o vínculo PDF-credencial;
- usa `#mlkem-1` para decapsular segredos recebidos via ML-KEM.

O core também calcula um identificador curto de emissor. O hash usa campos com
prefixo de tamanho para evitar ambiguidade de concatenação:

```text
issuer_identifier = Base64(SHA3-256(
  SSI_PQ_ISSUER_IDENTIFIER_SHA3_256_V1,
  len("did"), DID,
  len("key_id"), key_id,
  len("key_type"), key_type,
  len("public_key"), public_key
))
```

Esse valor fica em `credential.issuer_identifier` e é exibido no PDF como
`Identificador do Emissor`. O DID completo continua existindo em
`credential.issuer_did`.

## Schema

Schemas são criados por `create_schema_from_attributes`.

A entrada deve ser um objeto JSON. Objetos aninhados são achatados para caminhos
canônicos dentro de `subject`.

Exemplo de entrada:

```json
{
  "titular": {
    "documento": {
      "tipo": "CPF",
      "numero": "123.456.789-00"
    }
  }
}
```

gera caminhos como:

```text
subject.titular.documento.tipo
subject.titular.documento.numero
```

O `SchemaDocument` contém:

- `type`: `ssi_schema_v1`;
- `schema_id`;
- `version`;
- `created_at`;
- `attributes`.

O `schema_id` é derivado do conteúdo lógico do Schema: `type`, `version` e
`attributes`. O campo `created_at` não participa do `schema_id`.

Além disso, o core calcula `schema_hash` com SHA3-256/Base64 sobre a definição
lógica do Schema. Esse hash também ignora `created_at`, considera `version` e
`attributes`, e fica gravado na credencial como `credential.schema_hash`. O PDF
exibe esse valor como `Hash do Schema`.

## Criação da credencial JSON

O fluxo de emissão começa em `issue_credential_from_schema` ou, no fluxo com
wallet, em `walletIssueCredentialFromSchema`.

O emissor fornece:

- um `SchemaDocument`;
- os atributos JSON preenchidos;
- o DID Document público do emissor;
- a chave privada ML-DSA do emissor, ou uma wallet que contenha essa chave;
- opções como `credential_id`, `issued_at`, `expires_at`, `status_ref`,
  `visible_paths` e `credential_version`.

Antes de assinar, o core valida:

- se `issued_at` e `expires_at` são timestamps RFC 3339 válidos;
- se `expires_at`, quando existe, não é anterior a `issued_at`;
- se o DID Document do emissor é válido;
- se o `schema_id` corresponde à definição do Schema;
- se todos os atributos obrigatórios existem;
- se os tipos primitivos batem com o Schema;
- se não existem atributos extras fora do Schema.

Quando `credential_id` não é informado, o core gera um identificador determinístico
em Base64 a partir de:

- chave pública ML-DSA do emissor;
- Schema canônico;
- atributos canônicos;
- `issued_at`.

Assim, a mesma emissão com os mesmos dados e timestamp gera o mesmo ID, mas uma
emissão posterior, com outro `issued_at`, gera outro ID.

## JSON canônico

Sempre que o sistema precisa calcular hash ou assinatura sobre JSON, ele usa
JSON canônico:

- objetos têm chaves ordenadas lexicograficamente;
- arrays preservam a ordem original;
- strings e números são serializados por regras estáveis.

Isso evita que a mesma informação gere hashes diferentes apenas porque alguém
mudou a ordem das chaves do objeto JSON.

Exemplo:

```json
{"b":2,"a":1}
```

e:

```json
{"a":1,"b":2}
```

produzem a mesma forma canônica.

## Salts e folhas Merkle

Cada atributo da credencial recebe um salt aleatório de 32 bytes.

O hash de folha Merkle usa SHA3-256 sobre:

- domínio lógico `SSI_ATTR_V1`;
- `schema_id`;
- `credential_id`;
- caminho canônico do atributo;
- tipo primitivo do atributo;
- valor JSON canônico;
- salt de 32 bytes.

Os campos de tamanho variável entram no hash com prefixo de comprimento,
evitando ambiguidade de concatenação entre limites de campos.

O objetivo é impedir que o hash de um valor simples, como `"CPF"` ou `"Sim"`,
possa ser comparado diretamente contra tabelas ou credenciais diferentes.

## Árvore de Merkle dos atributos

Depois de preparar os atributos, o core constrói uma árvore de Merkle:

- as folhas são ordenadas pelo caminho canônico;
- cada folha é o hash SHA3-256 do atributo com salt;
- nós internos usam o domínio `SSI_MERKLE_NODE_V1`;
- se um nível tem quantidade ímpar de nós, o último hash é duplicado;
- a root é gravada em `credential.attributes_commitment.root`.

A credencial não precisa expor todos os valores. Ela grava todos os hashes de
folha em `credential.subject.attribute_hashes` e a Merkle root em
`credential.attributes_commitment`.

## Documento assinável

O `CredentialDocument` assinado contém:

- `type`: `ssi_credential_v1`;
- `credential_id`;
- `schema_id`;
- `schema_hash`;
- `issuer_did`;
- `issuer_identifier`;
- `subject.attribute_hashes`;
- `attributes_commitment`;
- `issued_at`;
- `expires_at`;
- `status_ref`.

Esse documento é convertido para JSON canônico e assinado com ML-DSA usando o
separador de domínio:

```text
SSI_CREDENTIAL_SIGNATURE_V1
```

O resultado fica em:

```text
signed_credential.credential_signature
```

A assinatura contém:

- `alg`, como `ML-DSA-65`;
- `key_id`, normalmente `#mldsa-1`;
- `public_key_multibase`, quando serializada pelo fluxo atual;
- `signature`, em base64url sem padding.

Na verificação, se `public_key_multibase` estiver presente, ela precisa bater
com a chave pública declarada no DID Document do emissor.

## Versões da credencial assinada

O formato padrão atual é:

```text
ssi_signed_credential_v2
```

O core ainda aceita `ssi_signed_credential_v1` como formato legado.

### Formato v2

No formato `ssi_signed_credential_v2`, usado por padrão:

- cada item em `attribute_disclosures` traz `path`, `type`, `value` e `salt`;
- `leaf_hash` e `proof` não são serializados para cada atributo;
- a prova compartilhada fica em `attribute_multiproof`;
- `attribute_multiproof.alg` é `Merkle-SHA3-256-Multiproof-V1`;
- `attribute_multiproof.leaf_count` precisa ser igual ao total de folhas
  comprometidas em `credential.subject.attribute_hashes`;
- `attribute_multiproof.proof_nodes` contém os nós irmãos deduplicados
  necessários para reconstruir a root.

Na verificação do v2, o core:

- exige que exista `attribute_multiproof`;
- rejeita caminhos revelados duplicados;
- recalcula cada folha revelada usando `schema_id`, `credential_id`, caminho,
  tipo, valor e salt;
- confere se o hash recalculado bate com `subject.attribute_hashes`;
- reconstrói a Merkle root com a multiprova;
- verifica a assinatura ML-DSA da credencial.

### Formato v1 legado

No formato `ssi_signed_credential_v1`:

- não existe `attribute_multiproof`;
- cada disclosure traz `leaf_hash`;
- cada disclosure traz sua própria prova Merkle em `proof`.

Esse formato continua verificável, mas o caminho principal do projeto é o v2.

## Atributos revelados seletivamente

O campo `visible_paths` decide quais atributos aparecem junto da credencial.

O chamador pode informar caminhos com ou sem o prefixo `subject.`. Por exemplo,
estas duas entradas são equivalentes:

```text
titular.nome
subject.titular.nome
```

O core normaliza esses caminhos, ordena, remove duplicatas e valida que todos
existem no Schema. Quando `visible_paths` não é informado, todos os atributos
são revelados.

Em um Schema aninhado, uma lista como:

```json
[
  "titular.nome",
  "titular.documento.tipo",
  "formacao.curso",
  "formacao.instituicao.nome",
  "endereco.cidade",
  "nivel"
]
```

é serializada no manifesto como:

```text
subject.endereco.cidade
subject.formacao.curso
subject.formacao.instituicao.nome
subject.nivel
subject.titular.documento.tipo
subject.titular.nome
```

Os atributos não revelados continuam protegidos pela Merkle root assinada, mas
seus valores e salts não aparecem em `attribute_disclosures`.

## Geração do PDF-base

O PDF visual é criado por `signed_credential_to_pdf` ou
`signedCredentialToPdf`.

Ele renderiza:

- resumo da credencial;
- atributos visíveis;
- dados da assinatura;
- dados de integridade.

No resumo, o PDF exibe:

- `ID da credencial`;
- `Hash do Schema`, usando `credential.schema_hash` quando disponível;
- `Identificador do Emissor`, usando `credential.issuer_identifier` quando
  disponível;
- `Emitida em`;
- `Expira em`.

Na seção de assinatura, o PDF exibe:

- algoritmo ML-DSA;
- chave de assinatura;
- `Chave Pública do Assinante`, usando `credential_signature.public_key_multibase`
  quando disponível.

Labels visuais podem ser fornecidas nas opções de renderização. Elas mudam
apenas a apresentação do PDF, não alteram Schema, credencial assinada,
assinaturas, Merkle root ou manifesto criptográfico.

Durante a criação do PDF-base, o core calcula:

```text
SHA3-256(JSON canônico da SignedCredential)
```

e grava esse valor em um marcador interno do PDF:

```text
%SSI-PQ-RENDER-CREDENTIAL-SHA3-256 ...
```

Esse marcador ajuda a verificar se o PDF-base renderizado corresponde à mesma
credencial que depois será embutida no manifesto. Se alguém renderizar um PDF
com uma credencial e depois tentar embutir outra, a verificação acusa:

```text
PDF_CREDENTIAL_RENDER_MISMATCH
```

## Manifesto embutido no PDF

A função central é `embed_signed_credential_in_pdf`. No fluxo com wallet, a API
Node correspondente é `walletEmbedSignedCredentialInPdf`.

Antes de embutir, o core verifica se a `SignedCredential` é válida para o DID
Document do emissor. Depois cria um `document_binding`.

### PDF-base

O PDF-base é o PDF antes do manifesto SSI-PQ ser anexado. Ele precisa:

- começar com `%PDF-`;
- terminar com `%%EOF`;
- possuir trailer `/Size`;
- possuir `startxref`.

O manifesto final é anexado depois desses bytes originais por atualização
incremental.

### Document binding

O `document_binding` amarra o PDF-base à credencial assinada. Ele contém:

- `type`: `ssi_pdf_binding_v1`;
- `pdf_hash_alg`: `SHA3-256`;
- `pdf_base_hash`: SHA3-256 dos bytes exatos do PDF-base;
- `pdf_base_length`: tamanho exato do PDF-base em bytes;
- `credential_hash_alg`: `SHA3-256`;
- `credential_hash`: SHA3-256 do JSON canônico da `SignedCredential`;
- `credential_hash_scope`: `signed_credential_canonical_json`;
- `binding_scope`: `pdf_base_bytes_plus_signed_credential_hash`;
- `embedding_policy`: `manifest_must_be_final_incremental_update`;
- `issuer_did`;
- `did_doc_cid`, quando informado;
- `signing_key_id`;
- `signing_public_key_multibase`, quando serializada pelo fluxo atual;
- `signing_key_fingerprint`;
- `created_at`.

Esse objeto é serializado como JSON canônico e assinado com ML-DSA usando o
separador de domínio:

```text
SSI_PDF_DOCUMENT_BINDING_V1
```

A assinatura resultante fica em:

```text
document_binding_signature
```

### Estrutura do manifesto

O manifesto final tem tipo:

```text
ssi_pdf_signature_v1
```

e contém:

- `signed_credential`;
- `document_binding`;
- `document_binding_signature`.

O manifesto é transformado em JSON canônico e inserido no PDF como arquivo
embutido:

```text
ssi-pq-credential-manifest.json
```

A inserção ocorre por atualização incremental do PDF. O core adiciona novos
objetos PDF para:

- atualizar o catálogo;
- criar o objeto de arquivo embutido;
- criar o `Filespec`;
- registrar o nome em `/EmbeddedFiles`;
- escrever nova tabela `xref`;
- escrever novo trailer apontando `/Prev` para a revisão anterior.

## Verificação do PDF

A verificação completa acontece em `verify_signed_credential_pdf` ou
`verifySignedCredentialPdf`.

Ela não confia apenas no fato de existir um JSON dentro do PDF. Ela valida o
conjunto inteiro:

1. Extrai o manifesto embutido.
2. Valida tipos, escopos e política.
3. Confere se o DID Document pertence ao emissor e à chave esperada.
4. Verifica a assinatura ML-DSA da credencial.
5. Recalcula o hash canônico da credencial embutida.
6. Compara esse hash com `document_binding.credential_hash`.
7. Usa `pdf_base_length` para separar os bytes originais do PDF-base.
8. Recalcula SHA3-256 desses bytes e compara com `pdf_base_hash`.
9. Compara o hash da credencial renderizada no PDF-base com o hash da
   credencial embutida.
10. Verifica a assinatura ML-DSA do `document_binding`.
11. Reconstrói como o manifesto deveria ter sido embutido e compara byte a byte
    com o PDF recebido.

O resultado final só é `valid: true` se todas as verificações obrigatórias
passarem.

O resultado estruturado inclui:

- `valid`;
- `status`;
- `issuer_did`;
- `credential_id`;
- `pdf_base_hash_valid`;
- `credential_signature_valid`;
- `document_binding_signature_valid`;
- `manifest_is_final_revision`;
- `did_key_match`;
- `errors`;
- `manifest`;
- `signed_credential`.

## Extração e verificação da credencial JSON

A função Rust `extract_pdf_manifest`, exposta no Node como
`extractCredentialManifestFromPdf` apenas extrai o manifesto. Ela não substitui
`verifySignedCredentialPdf`.

Depois de extrair:

```text
manifest.signed_credential
```

é possível verificar a assinatura JSON isoladamente com:

```text
verifySignedCredential(extractedCredential, issuerDidDocument)
```

Isso valida a credencial e suas divulgações Merkle. Porém, a verificação isolada
da credencial não prova que ela pertence ao PDF visual. Para isso, é necessário
validar o PDF completo com `verifySignedCredentialPdf`.

## Fluxo de plataforma com ML-KEM e AES-256-GCM

Os testes de plataforma exercitam um fluxo completo de entrega cifrada:

1. O remetente cria uma wallet e um DID com `#mldsa-1` e `#mlkem-1`.
2. O destinatário cria outra wallet e outro DID.
3. O remetente obtém a chave pública ML-KEM do destinatário a partir do DID
   Document público.
4. A aplicação pode serializar essa chave em um JSON de transporte, por exemplo:

```json
{
  "type": "ssi_pq_recipient_mlkem_public_key_v1",
  "did": "did:ssipq:z...",
  "key_id": "#mlkem-1",
  "alg": "ML-KEM-768",
  "public_key_multibase": "z..."
}
```

5. O remetente emite a credencial com `walletIssueCredentialFromSchema`.
6. O remetente gera o PDF-base com `signedCredentialToPdf`.
7. O remetente embute o manifesto com `walletEmbedSignedCredentialInPdf`.
8. O remetente converte a chave pública ML-KEM multibase/base58btc para bytes e
   depois para base64url para chamar `mlkemEncapsulate`.
9. `mlkemEncapsulate` retorna:
   - `ciphertext`, que deve ser enviado ao destinatário;
   - `sharedSecret`, usado pelo remetente como chave simétrica.
10. O remetente cifra o PDF final com `aes256GcmEncrypt`.
11. O destinatário chama `walletMlkemDecapsulate` com o ciphertext ML-KEM.
12. O destinatário decifra o PDF com `aes256GcmDecrypt`.
13. O destinatário verifica o PDF com `verifySignedCredentialPdf`.
14. O destinatário pode extrair o manifesto e verificar a credencial JSON
    extraída com `verifySignedCredential`.

O ciphertext ML-KEM não é o PDF cifrado. Ele encapsula apenas o segredo
compartilhado. O PDF final é cifrado separadamente com AES-256-GCM usando esse
segredo como chave de 32 bytes.

No AES-256-GCM:

- `ciphertext` contém os bytes cifrados sem a tag;
- `nonce` tem 12 bytes;
- `authTag` tem 16 bytes;
- `aad` é opcional e precisa ser o mesmo na cifragem e decifragem.

Qualquer alteração no ciphertext AES, nonce, tag ou AAD faz a decifragem falhar.
Qualquer alteração no PDF depois da decifragem deve ser detectada novamente por
`verifySignedCredentialPdf`.

## Fraudes detectadas

### Trocar o JSON dentro do PDF

Se alguém altera a credencial embutida mantendo o visual igual, a verificação
falha porque:

- a assinatura da credencial deixa de bater se qualquer parte assinada mudar;
- o hash canônico da `SignedCredential` alterada não bate com
  `document_binding.credential_hash`;
- a assinatura `document_binding_signature` foi feita sobre o binding antigo;
- se a alteração muda bytes depois do manifesto, a política de revisão final
  também pode falhar.

Erros esperados incluem:

```text
INVALID_CREDENTIAL_SIGNATURE
CREDENTIAL_HASH_MISMATCH
INVALID_DOCUMENT_BINDING_SIGNATURE
MANIFEST_NOT_FINAL_REVISION
```

### Colocar um JSON válido em outro PDF

Esse é o ataque de transplante. O atacante pega uma credencial JSON válida de
um PDF e tenta colocá-la em outro PDF visual.

Mesmo que a credencial em si seja válida, o PDF final não verifica porque o
`document_binding` assinado contém:

- hash do PDF-base original;
- tamanho exato do PDF-base original;
- hash da credencial assinada;
- assinatura ML-DSA do emissor sobre esse vínculo.

Erros esperados incluem:

```text
PDF_BASE_HASH_MISMATCH
PDF_BASE_LENGTH_INVALID
PDF_CREDENTIAL_RENDER_MISMATCH
MANIFEST_NOT_FINAL_REVISION
```

Uma credencial válida continua válida como JSON, mas não fica válida como parte
de qualquer PDF. Ela só verifica dentro do PDF-base cujo hash e tamanho foram
assinados no binding.

### Alterar o visual do PDF mantendo o JSON

Se alguém muda texto, desenho, página ou bytes do PDF-base, o hash dos bytes do
PDF-base muda. A verificação recalcula SHA3-256 do PDF-base recebido e compara
com `document_binding.pdf_base_hash`.

Qualquer alteração nos bytes originais gera:

```text
PDF_BASE_HASH_MISMATCH
```

Se a alteração for adicionada depois do manifesto, a comparação da revisão
final também falha com:

```text
MANIFEST_NOT_FINAL_REVISION
```

### Anexar algo depois do manifesto SSI-PQ

PDFs permitem atualizações incrementais. Um atacante poderia anexar uma nova
revisão depois do manifesto, sem alterar os bytes anteriores.

O core trata isso com a política:

```text
manifest_must_be_final_incremental_update
```

Durante a verificação, ele pega o PDF-base, reexecuta a função de embutir
manifesto usando o manifesto extraído e compara o resultado esperado com o PDF
recebido. Se houver qualquer byte extra, revisão posterior ou diferença na
estrutura final, a verificação falha com:

```text
MANIFEST_NOT_FINAL_REVISION
```

### Usar DID Document ou chave errada

O DID Document público do emissor é necessário para verificar:

- assinatura da credencial;
- assinatura do vínculo PDF-credencial;
- se `issuer_did` da credencial e do binding correspondem ao DID Document usado;
- se `signing_key_id` existe;
- se `signing_public_key_multibase`, quando presente, corresponde ao DID;
- se o fingerprint da chave pública bate com o manifesto;
- se `issuer_identifier`, quando presente, corresponde ao DID Document.

Erros esperados incluem:

```text
DID_KEY_MISMATCH
INVALID_CREDENTIAL_SIGNATURE
INVALID_DOCUMENT_BINDING_SIGNATURE
```

## O que fica protegido

O desenho atual protege contra:

- alteração de atributos revelados;
- troca de salts;
- troca de provas Merkle;
- alteração da Merkle root;
- alteração de `schema_hash`;
- alteração de `issuer_identifier`;
- alteração do emissor;
- alteração de datas, status ou Schema na credencial;
- troca da chave pública declarada na assinatura;
- troca do JSON embutido no PDF;
- transplante de JSON válido para outro PDF;
- troca do PDF visual mantendo o manifesto;
- anexos ou revisões incrementais posteriores ao manifesto SSI-PQ;
- uso de DID Document ou chave pública que não correspondem ao emissor;
- alteração do PDF cifrado durante transporte, quando AES-256-GCM é usado.

## O que não deve ser confundido

O JSON embutido não é considerado válido apenas por estar dentro do PDF. Ele
precisa passar pela verificação criptográfica completa.

O PDF visual também não é considerado válido apenas por mostrar dados
aparentemente corretos. Os bytes do PDF-base precisam bater com o hash assinado
no `document_binding`.

O transporte ML-KEM/AES protege confidencialidade e integridade durante a
entrega cifrada, mas não substitui as assinaturas. Depois de decifrar, o
destinatário ainda deve chamar `verifySignedCredentialPdf`.

Labels de apresentação do PDF não mudam a credencial. Elas servem apenas para
mostrar nomes amigáveis, como `Titular`, `Documento` ou `Número`, mas o que é
assinado são os caminhos canônicos e hashes da credencial.

## Resumo curto

A credencial JSON é assinada primeiro. Ela contém `schema_hash`,
`issuer_identifier`, hashes de atributos e uma Merkle root. No formato atual
`ssi_signed_credential_v2`, atributos revelados usam uma multiprova Merkle
compartilhada.

Depois o PDF-base é gerado com um marcador interno contendo o hash da credencial
assinada. Em seguida, o sistema cria um manifesto com a credencial e um binding
assinado que inclui hash do PDF-base, tamanho do PDF-base, hash da credencial,
chave pública de assinatura e política de revisão final.

Na verificação, tudo é recalculado e comparado. Por isso:

- trocar o JSON quebra o hash e/ou a assinatura da credencial;
- colocar um JSON válido em outro PDF quebra o hash do PDF-base ou o marcador
  de renderização;
- alterar o visual quebra o hash do PDF-base;
- anexar revisões depois do manifesto quebra a política de revisão final;
- usar o DID ou a chave errada quebra a validação de assinatura e identidade.

Quando o PDF é enviado cifrado, ML-KEM encapsula o segredo para o destinatário e
AES-256-GCM cifra os bytes do PDF final. Depois de decifrar, a mesma verificação
PDF-credencial continua obrigatória.
