# Plano de Melhorias e Evolução Arquitetural — Plataforma SSIaaS (VeriFile)

Este documento descreve propostas de melhorias e atualizações (upgrades) para a plataforma baseadas na arquitetura atual de Identidade Autossoberana (SSI) com criptografia pós-quântica. Estas melhorias visam aumentar a descentralização, segurança e experiência do usuário (UX/DX).

## 1. Suporte à Verificação Criptográfica de Credenciais W3C (JSON Bruto)
- **Cenário Atual:** A plataforma realiza com sucesso a verificação criptográfica matemática da assinatura ML-DSA-65 quando o Verificador faz o upload do arquivo PDF (via extração do manifesto embutido e do Documento DID). No entanto, o endpoint de verificação atual não suporta receber o JSON-LD bruto da credencial (padrão W3C) para validação matemática autônoma (apenas Proof of Existence pelo Hash do PDF).
- **Melhoria:** Expandir o endpoint `/api/verifier/verify` para aceitar também payloads JSON completos (W3C Verifiable Credentials) contendo o bloco `proof`. Isso aumentará a interoperabilidade, permitindo que a plataforma valide credenciais Pós-Quânticas apresentadas fora do formato PDF, checando a assinatura diretamente no payload JSON através da `ssi_pq_core`.

## 2. Divulgação Seletiva (Selective Disclosure / ZKPs)
- **Cenário Atual:** A credencial completa é empacotada em um PDF criptografado (ML-KEM-768 e AES). Se o titular precisar provar uma informação (ex: maioridade), ele precisa apresentar todo o PDF ou o hash completo, revelando todos os outros dados em claro.
- **Melhoria:** Implementar mecanismos de Prova de Conhecimento Zero (ZKP). Pode-se adotar esquemas como **BBS+ Signatures** ou **AnonCreds** acoplados à emissão, permitindo que o titular derive uma credencial secundária exibindo apenas atributos específicos (ex: `idade > 18`) sem revelar o nome ou data de nascimento, aproximando a plataforma de modelos como o da Trinsic (citado no benchmarking).

## 3. Lista de Revogação Descentralizada (Status List 2021)
- **Cenário Atual:** A revogação funciona de forma instantânea porque o estado da credencial (`REVOKED`) é alterado diretamente no banco de dados PostgreSQL da plataforma.
- **Melhoria:** Embora a revogação via banco de dados seja rápida e eficiente para sistemas centralizados, em um modelo 100% SSI, um Verificador externo deveria ser capaz de checar revogações offline. Implementar a especificação **W3C Bitstring Status List v1.0**, onde o emissor publica e atualiza periodicamente um arquivo no IPFS com os bits de status das credenciais, preservando a privacidade (uma vez que as credenciais são indexadas por posição no bit array, sem expor metadados).

## 4. Ancoragem de DIDs em DLTs (Distributed Ledgers)
- **Cenário Atual:** O DID (ex: `did:ssipq:...`) é resolvido localmente no banco da plataforma ou, alternativamente, através da publicação do DID Document no IPFS.
- **Melhoria:** Integrar a plataforma com redes focadas em identidade, como **Hyperledger Indy**, **EBSI (Europa)** ou até mesmo métodos baseados em Sidetree (como o ION na rede Bitcoin). Isso transforma o `did:ssipq` em um método publicamente passível de ser resolvido por qualquer resolvedor universal (Universal Resolver) fora do ecossistema VeriFile.

## 5. Substituição da Simulação pelo App Nativo (Mobile Signer)
- **Cenário Atual:** O fluxo de assinatura (PoP, ML-DSA, ML-KEM) é simulado pelos scripts Node.js na pasta `lib/` rodando o núcleo em C++ (`ssi_pq_core.node`).
- **Melhoria:** Concluir e integrar o desenvolvimento do **Mobile Signer App** real (ex: React Native ou Kotlin) embarcando a mesma biblioteca nativa C++. A plataforma passará a exibir QR Codes dinâmicos na tela ou deep-links para interagir de verdade via smartphone.

## 6. Versionamento Automático de Schemas
- **Cenário Atual:** Schemas "Draft" (privados) podem ser editados. Ao publicar no IPFS, tornam-se imutáveis e não podem ser alterados.
- **Melhoria:** Implementar um mecanismo de **Versionamento Semântico**. Se um emissor precisar adicionar um novo campo a um schema público, a plataforma permite gerar uma versão `v1.1` ou `v2.0` derivando da estrutura anterior e gerando um novo CID no IPFS, mantendo o histórico de linhagem do schema.

## 7. Opção de Custódia de Backup (Holders)
- **Cenário Atual:** Após o download, os PIIs são apagados do banco de dados e o PDF permanece em nuvem até atingir a data de retenção do emissor. Se o titular perder seu celular, ele pode perder o PDF criptografado para sempre se o período de retenção já houver expirado (410 Gone).
- **Melhoria:** Adicionar um fluxo de "Consentimento de Backup", onde o titular pode optar por arquivar uma cópia de seu PDF criptografado em redes de armazenamento descentralizado (como **Filecoin** ou **Arweave**) no ato do primeiro download, garantindo resiliência contra perda de dados sem inflar o banco de dados da plataforma VeriFile.
