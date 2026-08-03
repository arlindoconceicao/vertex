# Architectural Benchmarking of SSIaaS Platforms: Indicio Proven vs. Trinsic

**Date:** April 2026

**Objective:** To present a comparative analysis of the engineering decisions and network topologies of the market-leading Self-Sovereign Identity as a Service (SSIaaS) platforms. This document aims to ground the architectural choices for the development of decentralized identity solutions.

**Justification for Platform Selection:** Indicio Proven and Trinsic were selected for this benchmarking because they represent the two dominant, yet diametrically opposed, architectural paradigms in the current SSI landscape. Indicio is the premier standard for high-assurance, ledger-centric, and physically sovereign enterprise ecosystems. Conversely, Trinsic represents the modern, developer-centric, ledgerless approach, acting as an identity gateway for rapid Web2.5 integration. Comparing these two provides a spectrum of the trade-offs between strict decentralization and Developer Experience (DX).

**Authorship & Acknowledgments:**
This architectural benchmarking was developed by Breno Cerqueira Reis Nakamura, undergraduate researcher in Computer Engineering, under the supervision of Prof. Dr. Arlindo F. da Conceição.

The author's research activities are funded by a scholarship from the São Paulo Research Foundation (FAPESP), grant #2025/06172-5.

---

## 1. Core Philosophies

The analyzed solutions adopt fundamentally opposing topologies to solve the complexity of SSI adoption.

- **Indicio Proven:** Enterprise and Government-focused. The architecture acts as a heavy orchestrator designed for Zero-Trust environments and high-compliance ecosystems (such as eIDAS 2.0, EUDI ARF, and ICAO for travel). Its topology forces data processing and custody to the "edge" (the user's device), making it ideal for critical offline validation and physical sovereignty.
- **Trinsic:** Developer-First focused. It operates as a universal gateway (PaaS), frequently referred to as the "Stripe of SSI". Its primary goal is to accelerate Time-to-Market by abstracting blockchain complexities behind standard RESTful APIs and SDKs. It centralizes cryptographic processing in the cloud, trading extreme decentralization for seamless web integration.

## 2. Ledger Abstraction & Cryptographic Engines

- **Indicio (DLT Coupling & AnonCreds):** The engine is heavily rooted in Hyperledger Aries and Indy, utilizing the Aries Cloud Agent Python (ACA-Py) for routing and Aries Askar for key management. The platform relies on the blockchain to store Schemas and Credential Definitions, employing the AnonCreds cryptographic format to enable robust Zero-Knowledge Proofs (ZKPs). It also offers ledgerless options via the `did:web` method.
- **Trinsic (Ledgerless Architecture & BBS+):** The V2 architecture deliberately pivoted away from heavy ledger dependencies. It utilizes BBS+ Signatures to enable Selective Disclosure without the need to anchor Schemas on a blockchain. Data models are hosted as JSON URLs on Azure infrastructure, utilizing the ledger almost exclusively for anchoring DIDs.

## 3. Wallet Custody & Key Management

The decision regarding where the private key resides ultimately defines data responsibility.

- **Indicio (Edge Wallets & Decentralized Biometrics):** Offers the Holdr+ wallet (built on Hyperledger Aries) and the Holdr Mobile SDK, allowing clients to embed SSI wallets into native mobile applications. The architecture enforces a "Bring Your Own Biometrics" approach: facial templates are never uploaded to the cloud. Instead, liveness and matching are validated locally by comparing the device's camera feed directly against the cryptographically signed data within the credential.
- **Trinsic (Cloud Wallets & Zero-Access Encryption):** To enable a frictionless "No-App" experience, the platform champions customizable White Label Web Wallets. Rather than forcing users to download a generic SSI app, organizations can deploy a wallet with their own visual identity without writing code. To mitigate the vulnerabilities of centralizing sensitive data, Trinsic employs Zero-Access Encryption, ensuring that data at rest is utterly inaccessible even to the infrastructure provider. The system also enforces automatic Data Redaction, permanently purging Personally Identifiable Information (PII) immediately after verification concludes.

## 4. Integration, DX, and Access Control

How cryptographic complexity is exposed to the client application and how users are authenticated.

- **OIDC / Identity Provider Model (Indicio):** Abstraction is handled via the Proven Auth module, allowing the platform to act as a standard OpenID Connect (OIDC) provider. The client application delegates the login flow; Proven Auth requests the Verifiable Credential, validates the ZKP, and returns a standard JWT ID Token. This enables credential-based Single Sign-On (SSO), integrating effortlessly with gateways like Keycloak.
- **Sessions / OIDC4VP Model (Trinsic):** Abstraction is achieved by encapsulating cryptographic flows into temporary objects (Sessions) via the OIDC4VP protocol. The backend creates a session, generates a launch URL, and receives a `resultsAccessKey`. After the user interacts with the Web Wallet and authenticates passwordlessly, the frontend only receives a success signal. The backend must then use the `resultsAccessKey` to securely fetch the payload via API, thereby preventing client-side data injection attacks.

## 5. Issuance, Templates, and Derivative Credentials

- **Indicio (Governance Editor):** Issuance is rigidly governed by Schemas defined globally on the DLT, managed through a Governance Editor (DEGov). It provides visual interfaces to enforce ecosystem rules and supports multiple high-compliance formats (W3C VC, ISO mdoc for mobile driver's licenses, IATA One ID).
- **Trinsic (Credential Templates & Derivative IDs):** The visual design of credentials and JSON structures (Schemas) is abstracted into a No-Code portal (Trinsic Studio) that generates URLs. The platform explicitly prohibits direct data cloning from the network. Instead, it acts as a Decisioning Engine, cross-referencing various inputs to generate an entirely new abstract credential known as a Derivative ID. Risk control is enforced by defining "Levels of Assurance," allowing the API to automatically filter and reject credentials that do not meet configured security thresholds.

## 6. Interaction Vectors & Native Networks

- **Physical & Disconnected Ecosystems (Indicio):** Excels in the physical transport layer, offering out-of-the-box support for proximity protocols essential for turnstiles and hardware: Bluetooth Low Energy (BLE), NFC, and WiFi Aware. It leverages Mediator components (asynchronous message buffers against connection failures) and DEGov governance. This caches business rules locally, enabling high-assurance validations entirely offline at the point of access.
- **Web2.5 Ecosystem (Trinsic):** Built to ingest legacy identities via the cloud and enrich data. It features pre-integrated networks (Acceptance Assurance Framework) to query government databases via API. In Brazil, it allows direct extraction from the Serpro system to validate CPF numbers and check the authenticity of the Digital CNH (including selfie FaceMatch) for rapid KYC onboarding flows.

## 7. Conclusion & Architectural Guidelines

This benchmarking reveals that the choice of an ideal SSIaaS architecture depends fundamentally on the system's primary interaction vector:

**I. Suitability for Physical Scenarios & Local Sovereignty:** For ecosystems requiring validation in the physical world (e.g., offline turnstile ticketing or autonomous vehicles), the Indicio Proven architecture demonstrates clear technical superiority. Its native support for proximity protocols (NFC/Bluetooth) and edge biometrics guarantees strict governance, high compliance, and uninterrupted operation without cloud dependency.

**II. Suitability for Web Scenarios & Friction Reduction:** For the development of Web Portals focused on agile user integration and digital onboarding, the Trinsic topology delivers the best Developer Experience (DX). The utilization of in-browser Cloud Wallets completely eliminates the app download barrier. Concerns regarding centralized custody are elegantly mitigated by Zero-Access Encryption and strict data redaction policies, while the platform extracts immediate value by connecting to legacy databases (like CPF and CNH).
