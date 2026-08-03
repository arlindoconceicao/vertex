# Benchmarking Arquitetural de Plataformas SSIaaS: Indicio Proven vs. Trinsic

**Data:** Abril de 2026

**Objetivo:** Apresentar uma análise comparativa das decisões de engenharia e topologias de rede das plataformas líderes de mercado de Identidade Autossoberana como Serviço (SSIaaS - Self-Sovereign Identity as a Service). Este documento visa fundamentar as escolhas arquiteturais para o desenvolvimento de soluções de identidade descentralizada.

**Justificativa para a Seleção das Plataformas:** Indicio Proven e Trinsic foram selecionadas para este benchmarking porque representam os dois paradigmas arquiteturais dominantes, porém diametralmente opostos, no atual cenário de SSI. A Indicio é o padrão ouro para ecossistemas corporativos de alta garantia, centrados em blockchain (ledger-centric) e fisicamente soberanos. Por outro lado, a Trinsic representa a abordagem moderna, focada no desenvolvedor e sem dependência rígida de blockchain (ledgerless), atuando como um gateway de identidade para rápida integração com a Web2.5. A comparação entre ambas fornece um espectro claro dos trade-offs (concessões) entre descentralização estrita e Experiência do Desenvolvedor (DX).

**Autoria e Agradecimentos:**
Este benchmarking arquitetural foi desenvolvido por Breno Cerqueira Reis Nakamura, pesquisador de iniciação científica em Engenharia de Computação, sob a orientação do Prof. Dr. Arlindo F. da Conceição.

As atividades de pesquisa do autor são financiadas por uma bolsa da Fundação de Amparo à Pesquisa do Estado de São Paulo (FAPESP), processo #2025/06172-5.

---

## 1. Filosofias Principais

As soluções analisadas adotam topologias fundamentalmente opostas para resolver a complexidade da adoção de SSI.

- **Indicio Proven:** Focada em corporações e governos. A arquitetura atua como um orquestrador pesado, projetado para ambientes Zero-Trust (Confiança Zero) e ecossistemas de alta conformidade (como eIDAS 2.0, EUDI ARF e ICAO para viagens). Sua topologia força o processamento de dados e a custódia para a "borda" (o dispositivo do usuário), tornando-a ideal para validação offline crítica e soberania física.
- **Trinsic:** Focada no Desenvolvedor (Developer-First). Opera como um gateway universal (PaaS), frequentemente referida como a "Stripe do SSI". Seu objetivo principal é acelerar o Time-to-Market abstraindo as complexidades de blockchain por trás de APIs RESTful e SDKs padrões. Ela centraliza o processamento criptográfico na nuvem, trocando a descentralização extrema por uma integração web fluida.

## 2. Abstração de Ledger e Motores Criptográficos

- **Indicio (Acoplamento DLT & AnonCreds):** O motor é fortemente enraizado no Hyperledger Aries e Indy, utilizando o Aries Cloud Agent Python (ACA-Py) para roteamento e Aries Askar para gerenciamento de chaves. A plataforma depende da blockchain para armazenar Schemas e Credential Definitions, empregando o formato criptográfico AnonCreds para permitir Provas de Conhecimento Zero (ZKPs) robustas. Também oferece opções sem ledger através do método `did:web`.
- **Trinsic (Arquitetura Ledgerless & BBS+):** A arquitetura V2 afastou-se deliberadamente de pesadas dependências de ledger. Utiliza Assinaturas BBS+ para permitir Divulgação Seletiva (Selective Disclosure) sem a necessidade de ancorar Schemas em uma blockchain. Os modelos de dados são hospedados como URLs JSON na infraestrutura do Azure, utilizando o ledger quase exclusivamente para ancoragem de DIDs.

## 3. Custódia de Carteira e Gerenciamento de Chaves

A decisão sobre onde reside a chave privada define, em última instância, a responsabilidade sobre os dados.

- **Indicio (Carteiras de Borda & Biometria Descentralizada):** Oferece a carteira Holdr+ (construída sobre Hyperledger Aries) e o Holdr Mobile SDK, permitindo aos clientes embutir carteiras SSI em aplicativos móveis nativos. A arquitetura impõe uma abordagem "Traga sua Própria Biometria" (Bring Your Own Biometrics): templates faciais nunca são enviados para a nuvem. Em vez disso, a vivacidade e a correspondência biométrica são validadas localmente comparando a imagem da câmera do dispositivo diretamente com os dados assinados criptograficamente dentro da credencial.
- **Trinsic (Carteiras em Nuvem & Criptografia de Acesso Zero):** Para permitir uma experiência "No-App" (sem necessidade de instalar aplicativo) sem atritos, a plataforma aposta em Carteiras Web White Label (marca branca) customizáveis. Em vez de forçar os usuários a baixar um aplicativo SSI genérico, organizações podem implantar uma carteira com sua própria identidade visual sem escrever código. Para mitigar as vulnerabilidades de centralizar dados sensíveis, a Trinsic emprega Criptografia de Acesso Zero (Zero-Access Encryption), garantindo que os dados em repouso sejam totalmente inacessíveis até mesmo para o provedor da infraestrutura. O sistema também impõe Redação Automática de Dados, expurgando permanentemente Informações de Identificação Pessoal (PII) imediatamente após a conclusão da verificação.

## 4. Integração, DX e Controle de Acesso

Como a complexidade criptográfica é exposta para a aplicação cliente e como os usuários são autenticados.

- **Modelo OIDC / Provedor de Identidade (Indicio):** A abstração é manipulada via o módulo Proven Auth, permitindo que a plataforma atue como um provedor OpenID Connect (OIDC) padrão. A aplicação cliente delega o fluxo de login; o Proven Auth solicita a Credencial Verificável, valida a ZKP e retorna um JWT ID Token padrão. Isso permite o Single Sign-On (SSO) baseado em credenciais, integrando-se facilmente com gateways como o Keycloak.
- **Modelo Sessões / OIDC4VP (Trinsic):** A abstração é alcançada encapsulando fluxos criptográficos em objetos temporários (Sessions) via o protocolo OIDC4VP. O backend cria uma sessão, gera uma URL de lançamento e recebe uma `resultsAccessKey`. Após o usuário interagir com a Web Wallet e se autenticar sem senha, o frontend recebe apenas um sinal de sucesso. O backend deve então usar a `resultsAccessKey` para buscar a carga (payload) de forma segura via API, prevenindo ataques de injeção de dados no lado do cliente.

## 5. Emissão, Templates e Credenciais Derivadas

- **Indicio (Editor de Governança):** A emissão é rigidamente governada por Schemas definidos globalmente no DLT (Distributed Ledger Technology), gerenciados através de um Editor de Governança (DEGov). Fornece interfaces visuais para impor regras do ecossistema e suporta múltiplos formatos de alta conformidade (W3C VC, ISO mdoc para carteiras de motorista digitais, IATA One ID).
- **Trinsic (Templates de Credenciais & IDs Derivados):** O design visual de credenciais e estruturas JSON (Schemas) é abstraído em um portal No-Code (Trinsic Studio) que gera URLs. A plataforma proíbe explicitamente a clonagem direta de dados da rede. Em vez disso, atua como um Motor de Decisão, cruzando várias entradas para gerar uma credencial abstrata inteiramente nova, conhecida como Derivative ID. O controle de risco é imposto definindo "Níveis de Garantia" (Levels of Assurance), permitindo que a API filtre e rejeite automaticamente credenciais que não atinjam os limiares de segurança configurados.

## 6. Vetores de Interação e Redes Nativas

- **Ecossistemas Físicos & Desconectados (Indicio):** Excelente na camada de transporte físico, oferecendo suporte nativo para protocolos de proximidade essenciais para catracas e hardware: Bluetooth Low Energy (BLE), NFC e WiFi Aware. Potencializa componentes Mediadores (buffers assíncronos de mensagens contra falhas de conexão) e governança DEGov. Isso faz cache local das regras de negócio, permitindo validações de alta garantia de forma totalmente offline no ponto de acesso.
- **Ecossistema Web2.5 (Trinsic):** Construída para ingerir identidades legadas via nuvem e enriquecer dados. Possui redes pré-integradas (Acceptance Assurance Framework) para consultar bancos de dados do governo via API. No Brasil, permite extração direta do sistema Serpro para validar números de CPF e checar a autenticidade da CNH Digital (incluindo FaceMatch de selfie) para fluxos ágeis de integração (KYC onboarding).

## 7. Conclusão e Diretrizes Arquiteturais

Este benchmarking revela que a escolha de uma arquitetura SSIaaS ideal depende fundamentalmente do vetor principal de interação do sistema:

**I. Adequação para Cenários Físicos e Soberania Local:** Para ecossistemas que exigem validação no mundo físico (ex: bilhetagem offline em catracas ou veículos autônomos), a arquitetura Indicio Proven demonstra clara superioridade técnica. Seu suporte nativo para protocolos de proximidade (NFC/Bluetooth) e biometria de borda garante estrita governança, alta conformidade e operação ininterrupta sem dependência da nuvem.

**II. Adequação para Cenários Web e Redução de Atrito:** Para o desenvolvimento de Portais Web focados na integração ágil de usuários e onboarding digital, a topologia da Trinsic oferece a melhor Experiência do Desenvolvedor (DX). A utilização de Carteiras em Nuvem no navegador elimina completamente a barreira de download de aplicativos. Preocupações com custódia centralizada são elegantemente mitigadas pela Criptografia de Acesso Zero e políticas estritas de expurgo de dados, enquanto a plataforma extrai valor imediato conectando-se a bancos de dados legados (como CPF e CNH).
