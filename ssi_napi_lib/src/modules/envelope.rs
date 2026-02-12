// src/modules/envelope.rs
use crate::IndyAgent;
use napi::{Env, Error, JsObject, Result};
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

// =========================
// Envelope v1 (MVP)
// =========================

// PartyV1 representa uma parte (remetente/destinatário) em um envelope SSI.
// Campos:
// - did: Option<String> (opcional). Se None, não é serializado no JSON (serde).
// - verkey: String (obrigatório). Chave pública (verkey) usada para cifrar/verificar.
// Uso típico: identificar o ator e fornecer a verkey para criptografia/assinatura.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartyV1 {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub did: Option<String>,
    pub verkey: String,
}

// CryptoV1 descreve o "envelope" de criptografia aplicado a um pacote.
// Campos:
// - mode: String (ex.: "authcrypt", "anoncrypt" ou "none") define o modo.
// - alg: String identifica o algoritmo/formato usado (ex.: libsodium/indy, etc).
// - sender_verkey: Option<String> verkey do remetente (opcional; usado em authcrypt).
//   Se None, não é serializado no JSON (serde).
// - recipient_verkey: String verkey do destinatário (obrigatório; chave de cifragem).
// - nonce: Option<String> nonce/IV opcional para suportar replay-protection e derivação.
//   Se None, não é serializado no JSON (serde).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CryptoV1 {
    // "authcrypt" | "anoncrypt" | "none"
    pub mode: String,
    pub alg: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_verkey: Option<String>,

    pub recipient_verkey: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub nonce: Option<String>,
}

// PayloadV1 representa o corpo transportado no envelope, já empacotado/cifrado.
// Campos:
// - content_type: String indica o tipo de conteúdo (ex.: "application/json").
// - encoding: String indica a codificação do payload (ex.: "utf8").
// - ciphertext: String contém o texto cifrado (geralmente um JSON em string),
//   no formato esperado por rotinas como decrypt_message para recuperar o conteúdo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayloadV1 {
    pub content_type: String, // ex: "application/json"
    pub encoding: String,     // ex: "utf8"
    pub ciphertext: String,   // string JSON do pacote cifrado (compatível com decrypt_message)
}

// EnvelopeV1 é o "container" principal de mensagens/pacotes trocados no sistema.
// Ele padroniza metadados (versão, ids, thread) e descreve endereçamento, cripto e
// payload, permitindo transporte offline (arquivos) ou online (mensagens).
// Campos:
// - v: u32 versão do formato do envelope.
// - id: String identificador único da mensagem/pacote.
// - kind: String tipo lógico do conteúdo (ex.: offer, request, credential, proof).
// - thread_id: String correlaciona mensagens do mesmo fluxo (conversa/transação).
// - created_at_ms: u64 timestamp em ms desde epoch (evita deps chrono/time).
// - expires_at_ms: Option<u64> expiração em ms (opcional; omitido no JSON se None).
// - from: Option<PartyV1> remetente (opcional; omitido no JSON se None).
// - to: PartyV1 destinatário (obrigatório).
// - crypto: CryptoV1 parâmetros do modo/algoritmo e chaves envolvidas.
// - payload: PayloadV1 corpo cifrado + metadados de tipo/codificação.
// - meta: Option<serde_json::Value> metadados livres (debug, tags, contexto, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvelopeV1 {
    pub v: u32,
    pub id: String,
    pub kind: String,
    pub thread_id: String,

    // Para evitar dependências (chrono/time), usamos ms desde epoch em string.
    // No JS/Electron você pode formatar para ISO se quiser.
    pub created_at_ms: u64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at_ms: Option<u64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<PartyV1>,

    pub to: PartyV1,
    pub crypto: CryptoV1,
    pub payload: PayloadV1,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Value>,
}

// now_ms() retorna o timestamp atual em milissegundos desde o UNIX_EPOCH.
// Fluxo:
// - SystemTime::now(): pega o instante atual do sistema.
// - duration_since(UNIX_EPOCH): calcula a duração desde 1970-01-01.
// - unwrap_or_default(): se falhar (clock antes do epoch), usa duração 0.
// - as_millis() as u64: converte a duração para ms e retorna como u64.
// Parâmetros: nenhum.
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// new_id(prefix) gera um identificador simples/estável sem deps extras (ex.: UUID).
// Formato: "{prefix}_{t}_{r}" onde:
// - prefix: &str define a "categoria" do ID (ex.: "env", "msg", "offer").
// - t: u64 é now_ms() (ms desde epoch) para dar ordenação temporal.
// - r: u32 é rand::random() para reduzir colisões em IDs gerados no mesmo ms.
// Retorno: String com o ID final (ex.: env_1700000000000_123456).
fn new_id(prefix: &str) -> String {
    // ID simples e estável, sem adicionar dependências.
    // Ex.: env_1700000000000_123456
    let t = now_ms();
    let r: u32 = rand::random();
    format!("{prefix}_{t}_{r}")
}

// validate_envelope_basic(env) faz validações mínimas de integridade do EnvelopeV1.
// Ele impede envelopes malformados/incompatíveis antes de processar cripto/payload.
// Parâmetros:
// - env: &EnvelopeV1 referência ao envelope a validar (não consome/clona).
// Regras checadas:
// - v deve ser 1.
// - kind e thread_id não podem ser vazios (após trim).
// - to.verkey não pode ser vazio.
// - crypto.mode deve ser "authcrypt", "anoncrypt" ou "none".
// - se mode=="authcrypt", exige crypto.sender_verkey presente e não vazio.
// - se mode!="none", exige crypto.recipient_verkey não vazio.
// - se expires_at_ms existe: deve ser > created_at_ms e não pode estar expirado.
// Retorno:
// - Ok(()) se válido; Err(Error) com mensagem específica se falhar.
fn validate_envelope_basic(env: &EnvelopeV1) -> Result<()> {
    if env.v != 1 {
        return Err(Error::from_reason(
            "Envelope: versão inválida (esperado v=1)",
        ));
    }
    if env.kind.trim().is_empty() {
        return Err(Error::from_reason("Envelope: kind vazio"));
    }
    if env.thread_id.trim().is_empty() {
        return Err(Error::from_reason("Envelope: thread_id vazio"));
    }
    if env.to.verkey.trim().is_empty() {
        return Err(Error::from_reason("Envelope: to.verkey vazio"));
    }
    if env.crypto.mode != "authcrypt" && env.crypto.mode != "anoncrypt" && env.crypto.mode != "none"
    {
        return Err(Error::from_reason("Envelope: crypto.mode inválido"));
    }
    if env.crypto.mode == "authcrypt"
        && env.crypto.sender_verkey.as_deref().unwrap_or("").is_empty()
    {
        return Err(Error::from_reason(
            "Envelope: authcrypt exige crypto.sender_verkey",
        ));
    }
    if env.crypto.mode != "none" && env.crypto.recipient_verkey.trim().is_empty() {
        return Err(Error::from_reason(
            "Envelope: crypto.recipient_verkey vazio",
        ));
    }
    if let Some(exp) = env.expires_at_ms {
        if exp <= env.created_at_ms {
            return Err(Error::from_reason(
                "Envelope: expires_at_ms deve ser > created_at_ms",
            ));
        }
        if now_ms() > exp {
            return Err(Error::from_reason("Envelope: expirado (expires_at_ms)"));
        }
    }
    Ok(())
}

// ============================================================================
// NAPI: novos métodos (aditivos)
// ============================================================================

#[napi]
impl IndyAgent {
    // envelope_pack_authcrypt(...) empacota um plaintext em um EnvelopeV1 com "authcrypt"
    // e retorna um objeto JS (string JSON do envelope) via N-API usando tokio_future.
    // Parâmetros:
    // - &self: instância da wallet/store (precisa estar aberta).
    // - env: Env (handle N-API para executar future e criar retorno JS).
    // - sender_did: String DID do remetente (usado para achar verkey + chave privada).
    // - recipient_verkey: String verkey do destinatário (Base58; usada para cifrar).
    // - kind: String tipo lógico do pacote (offer/request/cred/proof/etc).
    // - thread_id: Option<String> id do fluxo; se None gera new_id("th").
    // - plaintext: String conteúdo em claro a ser cifrado.
    // - expires_at_ms: Option<i64> expiração; <=0 vira None, senão é u64 em ms.
    // - meta_json: Option<String> JSON opcional para metadados livres (vira env.meta).
    // Fluxo interno:
    // - Abre sessão no store; busca DID do sender e extrai sender_verkey.
    // - Busca chave privada do sender (ed25519) e converte para X25519.
    // - Decodifica recipient_verkey (Base58), cria LocalKey pública e converte p/ X25519.
    // - Gera nonce (24 bytes), cifra com aries_askar::kms::crypto_box (authcrypt).
    // - Monta "encrypted_pkg" compatível com decrypt_message legado (base64 ciphertext/nonce).
    // - Cria EnvelopeV1 preenchendo from/to/crypto/payload e valida com validate_envelope_basic.
    // - Serializa EnvelopeV1 para JSON e retorna como string JS.
    // Erros típicos:
    // - Wallet fechada, DID/chave não encontrados, verkey inválida, falha de conversão/cifra,
    //   meta_json inválido, envelope inválido/expirado, falha de serialização.
    #[napi]
    pub fn envelope_pack_authcrypt(
        &self,
        env: Env,
        sender_did: String,
        recipient_verkey: String,
        kind: String,
        thread_id: Option<String>,
        plaintext: String,
        expires_at_ms: Option<i64>,
        meta_json: Option<String>,
    ) -> Result<JsObject> {
        use aries_askar::crypto::alg::KeyAlg;
        use aries_askar::kms::crypto_box;
        use aries_askar::kms::LocalKey;
        use base64::{engine::general_purpose, Engine as _};
        use rand::RngCore;

        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        env.execute_tokio_future(
            async move {
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro sessão: {e}")))?;

                // DID -> verkey (sender)
                let did_entry = session
                    .fetch("did", &sender_did, false)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro DB DID: {e}")))?
                    .ok_or_else(|| {
                        Error::from_reason(format!("DID {sender_did} não encontrado"))
                    })?;

                let did_json: serde_json::Value = serde_json::from_slice(&did_entry.value)
                    .map_err(|_| Error::from_reason("Erro parse DID JSON"))?;

                let sender_verkey_str = did_json["verkey"]
                    .as_str()
                    .ok_or_else(|| Error::from_reason("DID sem verkey"))?
                    .to_string();

                // Chave privada do sender (ed25519) -> x25519
                let sender_key_entry = session
                    .fetch_key(&sender_verkey_str, false)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro fetch key: {e}")))?
                    .ok_or_else(|| Error::from_reason("Chave privada Sender não encontrada"))?;

                let sender_key_ed25519 = sender_key_entry
                    .load_local_key()
                    .map_err(|e| Error::from_reason(format!("Erro load local key: {e}")))?;

                // Chave pública do recipient (ed25519) -> x25519
                let target_bytes = bs58::decode(&recipient_verkey)
                    .into_vec()
                    .map_err(|_| Error::from_reason("Recipient verkey inválida (Base58)"))?;

                let target_key_ed25519 =
                    LocalKey::from_public_bytes(KeyAlg::Ed25519, &target_bytes)
                        .map_err(|e| Error::from_reason(format!("Erro load recipient key: {e}")))?;

                let sender_exchange = sender_key_ed25519
                    .convert_key(KeyAlg::X25519)
                    .map_err(|e| Error::from_reason(format!("Falha convert sender Ed->X: {e}")))?;

                let target_exchange =
                    target_key_ed25519
                        .convert_key(KeyAlg::X25519)
                        .map_err(|e| {
                            Error::from_reason(format!("Falha convert recipient Ed->X: {e}"))
                        })?;

                // Crypto box
                let mut nonce = [0u8; 24];
                rand::thread_rng().fill_bytes(&mut nonce);

                let ciphertext = crypto_box(
                    &target_exchange,
                    &sender_exchange,
                    plaintext.as_bytes(),
                    &nonce,
                )
                .map_err(|e| Error::from_reason(format!("Erro crypto_box: {e}")))?;

                // Pacote compatível com decrypt_message legado
                let encrypted_pkg = serde_json::json!({
                    "ciphertext": general_purpose::STANDARD.encode(ciphertext),
                    "nonce": general_purpose::STANDARD.encode(nonce),
                    "sender_verkey": sender_verkey_str,
                    "target_verkey": recipient_verkey
                });
                let encrypted_json = serde_json::to_string(&encrypted_pkg).map_err(|e| {
                    Error::from_reason(format!("Erro serializando encrypted pkg: {e}"))
                })?;

                // Envelope v1
                let tid = thread_id.unwrap_or_else(|| new_id("th"));

                let expires_u64 = match expires_at_ms {
                    None => None,
                    Some(v) if v <= 0 => None,
                    Some(v) => Some(v as u64),
                };

                let env_obj = EnvelopeV1 {
                    v: 1,
                    id: new_id("env"),
                    kind,
                    thread_id: tid.clone(),
                    created_at_ms: now_ms(),
                    expires_at_ms: expires_u64,
                    from: Some(PartyV1 {
                        did: Some(sender_did),
                        verkey: encrypted_pkg["sender_verkey"].as_str().unwrap().to_string(),
                    }),
                    to: PartyV1 {
                        did: None,
                        verkey: recipient_verkey.clone(),
                    },
                    crypto: CryptoV1 {
                        mode: "authcrypt".to_string(),
                        alg: "aries_askar.crypto_box".to_string(),
                        sender_verkey: Some(
                            encrypted_pkg["sender_verkey"].as_str().unwrap().to_string(),
                        ),
                        recipient_verkey,
                        nonce: encrypted_pkg["nonce"].as_str().map(|s| s.to_string()),
                    },
                    payload: PayloadV1 {
                        content_type: "application/json".to_string(),
                        encoding: "utf8".to_string(),
                        ciphertext: encrypted_json,
                    },
                    meta: match meta_json {
                        None => None,
                        Some(s) => Some(serde_json::from_str(&s).map_err(|_| {
                            Error::from_reason("meta_json inválido (esperado JSON)")
                        })?),
                    },
                };

                validate_envelope_basic(&env_obj)?;
                let out = serde_json::to_string(&env_obj)
                    .map_err(|e| Error::from_reason(format!("Erro serializando envelope: {e}")))?;
                Ok(out)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // envelope_unpack_authcrypt(...) desempacota um EnvelopeV1 "authcrypt" e devolve o
    // plaintext (string) após validar o envelope e decifrar o payload compatível com
    // decrypt_message legado.
    // Parâmetros:
    // - &self: instância da wallet/store (precisa estar aberta).
    // - env: Env (handle N-API para executar future e criar retorno JS).
    // - receiver_did: String DID do destinatário (usado para achar verkey + chave privada).
    // - envelope_json: String JSON do EnvelopeV1 recebido (serializado).
    // Fluxo interno:
    // - Clona store fora do async (evita capturar &self) e abre sessão no DB.
    // - Parseia envelope_json -> EnvelopeV1 e roda validate_envelope_basic.
    // - Garante crypto.mode=="authcrypt" e obtém sender_verkey do envelope.
    // - Lê payload.ciphertext (JSON string do encrypted_pkg) e extrai ciphertext/nonce.
    // - Decodifica Base64 de ciphertext e nonce.
    // - Busca receiver_did no DB, extrai receiver verkey e carrega chave privada (Ed25519).
    // - Decodifica sender_verkey (Base58) e cria chave pública Ed25519.
    // - Converte Ed25519->X25519 (receiver e sender) e abre crypto_box_open.
    // - Converte bytes decifrados para UTF-8 e retorna plaintext como string JS.
    // Erros típicos:
    // - Wallet fechada, JSON inválido, envelope inválido/expirado, mode incorreto,
    //   sender_verkey ausente, pkg inválido, Base64/Base58 inválidos, chaves ausentes,
    //   falha de conversão Ed->X, falha de decifra, plaintext não UTF-8.
    #[napi]
    pub fn envelope_unpack_authcrypt(
        &self,
        env: Env,
        receiver_did: String,
        envelope_json: String,
    ) -> Result<JsObject> {
        // ✅ clone do store fora do async (não captura &self)
        let store = self
            .store
            .clone()
            .ok_or_else(|| Error::from_reason("Wallet fechada!"))?;

        env.execute_tokio_future(
            async move {
                let env_obj: EnvelopeV1 = serde_json::from_str(&envelope_json)
                    .map_err(|_| Error::from_reason("Envelope JSON inválido"))?;

                // ✅ valida antes de mover/clonar campos
                validate_envelope_basic(&env_obj)?;

                if env_obj.crypto.mode != "authcrypt" {
                    return Err(Error::from_reason("Envelope: mode não é authcrypt"));
                }

                let sender_vk =
                    env_obj.crypto.sender_verkey.clone().ok_or_else(|| {
                        Error::from_reason("Envelope authcrypt sem sender_verkey")
                    })?;

                // ✅ clone para não mover (evita partial move)
                let encrypted_json = env_obj.payload.ciphertext.clone();

                // -------- decrypt compatível com seu legado --------
                use aries_askar::crypto::alg::KeyAlg;
                use aries_askar::kms::{crypto_box_open, LocalKey};
                use base64::{engine::general_purpose, Engine as _};

                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro sessão: {e}")))?;

                let pkg: serde_json::Value = serde_json::from_str(&encrypted_json)
                    .map_err(|_| Error::from_reason("Encrypted pkg inválido"))?;

                let ciphertext_str = pkg["ciphertext"]
                    .as_str()
                    .ok_or_else(|| Error::from_reason("ciphertext ausente"))?;
                let nonce_str = pkg["nonce"]
                    .as_str()
                    .ok_or_else(|| Error::from_reason("nonce ausente"))?;

                let ciphertext = general_purpose::STANDARD
                    .decode(ciphertext_str)
                    .map_err(|_| Error::from_reason("Bad Base64 Ciphertext"))?;

                let nonce_bytes = general_purpose::STANDARD
                    .decode(nonce_str)
                    .map_err(|_| Error::from_reason("Bad Base64 Nonce"))?;

                let did_entry = session
                    .fetch("did", &receiver_did, false)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro DB: {e}")))?
                    .ok_or_else(|| Error::from_reason("Receiver DID não achado"))?;

                let did_json: serde_json::Value = serde_json::from_slice(&did_entry.value)
                    .map_err(|_| Error::from_reason("Erro parse DID JSON"))?;

                let receiver_verkey_ref = did_json["verkey"]
                    .as_str()
                    .ok_or_else(|| Error::from_reason("DID sem verkey"))?;

                let receiver_key_entry = session
                    .fetch_key(receiver_verkey_ref, false)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro fetch key: {e}")))?
                    .ok_or_else(|| Error::from_reason("Chave Privada Receiver não encontrada"))?;

                let receiver_key_ed25519 = receiver_key_entry
                    .load_local_key()
                    .map_err(|e| Error::from_reason(format!("Erro load local key: {e}")))?;

                let sender_bytes = bs58::decode(&sender_vk)
                    .into_vec()
                    .map_err(|_| Error::from_reason("Sender verkey inválida (Base58)"))?;

                let sender_key_ed25519 =
                    LocalKey::from_public_bytes(KeyAlg::Ed25519, &sender_bytes)
                        .map_err(|e| Error::from_reason(format!("Erro load sender key: {e}")))?;

                let receiver_exchange = receiver_key_ed25519
                    .convert_key(KeyAlg::X25519)
                    .map_err(|e| Error::from_reason(format!("Falha conv receiver Ed->X: {e}")))?;

                let sender_exchange = sender_key_ed25519
                    .convert_key(KeyAlg::X25519)
                    .map_err(|e| Error::from_reason(format!("Falha conv sender Ed->X: {e}")))?;

                let secret_bytes = crypto_box_open(
                    &receiver_exchange,
                    &sender_exchange,
                    &ciphertext,
                    &nonce_bytes,
                )
                .map_err(|e| Error::from_reason(format!("Falha Decifra: {e}")))?;

                let plaintext = String::from_utf8(secret_bytes.to_vec())
                    .map_err(|_| Error::from_reason("Mensagem decifrada não é UTF-8 válida"))?;

                Ok(plaintext)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // envelope_unpack_auto(receiver_did, envelope_json) faz o parse, valida e decifra um
    // EnvelopeV1 automaticamente conforme crypto.mode, retornando o plaintext (String).
    // Parâmetros:
    // - &self: instância da lib; exige wallet aberta apenas para modos com cripto.
    // - receiver_did: String DID do destinatário (para achar verkey + chave privada).
    // - envelope_json: String JSON do EnvelopeV1 recebido.
    // Fluxo geral:
    // - Parseia envelope_json -> EnvelopeV1 e roda validate_envelope_basic (inclui expiração).
    // - Decide o caminho por env_obj.crypto.mode:
    //   * "none": retorna env_obj.payload.ciphertext (não usa wallet).
    //   * "anoncrypt": usa wallet para chave privada do receiver e abre crypto_box_open
    //     com chave efêmera (epk) do pkg interno.
    //   * "authcrypt": usa wallet para chave privada do receiver e chave pública do sender
    //     (sender_verkey) e abre crypto_box_open (compatível com pacote legado).
    // Caminho "anoncrypt" (resumo):
    // - Abre store/session, busca receiver_did e extrai receiver_verkey.
    // - Sanity-check: receiver_verkey deve bater com env_obj.crypto.recipient_verkey.
    // - Carrega chave privada do receiver (Ed25519) e converte para X25519.
    // - Parseia pkg interno (payload.ciphertext) e lê ciphertext/nonce/epk (Base64).
    // - epk é a public key X25519 efêmera do sender; chama crypto_box_open.
    // - Converte bytes para UTF-8 e retorna plaintext.
    // Caminho "authcrypt" (resumo):
    // - Exige sender_verkey no envelope; parseia pkg interno (ciphertext/nonce Base64).
    // - Busca receiver_did, carrega chave privada Ed25519 e converte para X25519.
    // - Decodifica sender_verkey (Base58), cria pubkey Ed25519 e converte para X25519.
    // - Abre crypto_box_open e retorna plaintext UTF-8.
    // Erros típicos:
    // - JSON inválido, envelope inválido/expirado, mode desconhecido, wallet fechada,
    //   DID/chaves ausentes, Base64/Base58 inválidos, epk/nonce ausentes, falha de decifra.
    #[napi]
    pub async fn envelope_unpack_auto(
        &self,
        receiver_did: String,
        envelope_json: String,
    ) -> Result<String> {
        let env_obj: EnvelopeV1 = serde_json::from_str(&envelope_json)
            .map_err(|_| Error::from_reason("Envelope JSON inválido"))?;

        // valida estrutura + expiração
        validate_envelope_basic(&env_obj)?;

        match env_obj.crypto.mode.as_str() {
            "none" => {
                // ✅ mode=none não depende de wallet
                Ok(env_obj.payload.ciphertext)
            }

            "anoncrypt" => {
                use aries_askar::crypto::alg::KeyAlg;
                use aries_askar::kms::{crypto_box_open, LocalKey};
                use base64::{engine::general_purpose, Engine as _};

                // 1) wallet/store precisa estar aberto
                let store = self
                    .store
                    .clone()
                    .ok_or_else(|| Error::from_reason("Wallet fechada!"))?;

                // 2) abre sessão
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro sessão: {e}")))?;

                // 3) buscar DID do receiver e verkey
                let did_entry = session
                    .fetch("did", &receiver_did, false)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro DB: {e}")))?
                    .ok_or_else(|| Error::from_reason("Receiver DID não achado"))?;

                let did_json: serde_json::Value = serde_json::from_slice(&did_entry.value)
                    .map_err(|_| Error::from_reason("Erro parse DID JSON"))?;

                let receiver_verkey = did_json["verkey"]
                    .as_str()
                    .ok_or_else(|| Error::from_reason("DID sem verkey"))?
                    .to_string();

                // 4) 🔒 sanity-check: envelope realmente destinado a esse receiver?
                if receiver_verkey != env_obj.crypto.recipient_verkey {
                    return Err(Error::from_reason(
                        "Envelope: recipient_verkey não corresponde ao receiver DID",
                    ));
                }

                // 5) pegar chave privada do receiver na wallet
                let receiver_key_entry = session
                    .fetch_key(&receiver_verkey, false)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro fetch key: {e}")))?
                    .ok_or_else(|| Error::from_reason("Chave Privada Receiver não encontrada"))?;

                let receiver_key_ed = receiver_key_entry
                    .load_local_key()
                    .map_err(|e| Error::from_reason(format!("Erro load local key: {e}")))?;

                // 6) converter Ed25519 -> X25519 (crypto_box usa X25519)
                let receiver_key_x = receiver_key_ed
                    .convert_key(KeyAlg::X25519)
                    .map_err(|e| Error::from_reason(format!("Falha conv receiver Ed->X: {e}")))?;

                // 7) parse do pacote interno (JSON em payload.ciphertext)
                let pkg_json = env_obj.payload.ciphertext.clone();
                let pkg: serde_json::Value = serde_json::from_str(&pkg_json)
                    .map_err(|_| Error::from_reason("Encrypted pkg inválido (JSON)"))?;

                let ciphertext_b64 = pkg["ciphertext"]
                    .as_str()
                    .ok_or_else(|| Error::from_reason("anoncrypt pkg: ciphertext ausente"))?;

                // nonce pode vir do pkg (recomendado)
                let nonce_b64 = pkg["nonce"]
                    .as_str()
                    .or_else(|| env_obj.crypto.nonce.as_deref())
                    .ok_or_else(|| Error::from_reason("anoncrypt pkg: nonce ausente"))?;

                let epk_b64 = pkg["epk"]
                    .as_str()
                    .ok_or_else(|| Error::from_reason("anoncrypt pkg: epk ausente"))?;

                let ciphertext = general_purpose::STANDARD
                    .decode(ciphertext_b64)
                    .map_err(|_| Error::from_reason("Bad Base64 ciphertext"))?;

                let nonce = general_purpose::STANDARD
                    .decode(nonce_b64)
                    .map_err(|_| Error::from_reason("Bad Base64 nonce"))?;

                let epk = general_purpose::STANDARD
                    .decode(epk_b64)
                    .map_err(|_| Error::from_reason("Bad Base64 epk"))?;

                // 8) epk é public key X25519 efêmera do sender
                let eph_pub = LocalKey::from_public_bytes(KeyAlg::X25519, &epk)
                    .map_err(|e| Error::from_reason(format!("Erro load epk: {e}")))?;

                // 9) abrir crypto_box
                let pt = crypto_box_open(&receiver_key_x, &eph_pub, &ciphertext, &nonce)
                    .map_err(|e| Error::from_reason(format!("Falha anoncrypt open: {e}")))?;

                let plaintext = String::from_utf8(pt.to_vec())
                    .map_err(|_| Error::from_reason("Mensagem decifrada não é UTF-8 válida"))?;

                Ok(plaintext)
            }

            "authcrypt" => {
                // ✅ só aqui exige wallet aberta
                let store = self
                    .store
                    .clone()
                    .ok_or_else(|| Error::from_reason("Wallet fechada!"))?;

                // clone para evitar partial move e manter o env_obj íntegro
                let sender_vk =
                    env_obj.crypto.sender_verkey.clone().ok_or_else(|| {
                        Error::from_reason("Envelope authcrypt sem sender_verkey")
                    })?;

                let encrypted_json = env_obj.payload.ciphertext.clone();

                use aries_askar::crypto::alg::KeyAlg;
                use aries_askar::kms::{crypto_box_open, LocalKey};
                use base64::{engine::general_purpose, Engine as _};

                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro sessão: {e}")))?;

                let pkg: serde_json::Value = serde_json::from_str(&encrypted_json)
                    .map_err(|_| Error::from_reason("Encrypted pkg inválido"))?;

                let ciphertext_str = pkg["ciphertext"]
                    .as_str()
                    .ok_or_else(|| Error::from_reason("ciphertext ausente"))?;
                let nonce_str = pkg["nonce"]
                    .as_str()
                    .ok_or_else(|| Error::from_reason("nonce ausente"))?;

                let ciphertext = general_purpose::STANDARD
                    .decode(ciphertext_str)
                    .map_err(|_| Error::from_reason("Bad Base64 Ciphertext"))?;

                let nonce_bytes = general_purpose::STANDARD
                    .decode(nonce_str)
                    .map_err(|_| Error::from_reason("Bad Base64 Nonce"))?;

                let did_entry = session
                    .fetch("did", &receiver_did, false)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro DB: {e}")))?
                    .ok_or_else(|| Error::from_reason("Receiver DID não achado"))?;

                let did_json: serde_json::Value = serde_json::from_slice(&did_entry.value)
                    .map_err(|_| Error::from_reason("Erro parse DID JSON"))?;

                let receiver_verkey_ref = did_json["verkey"]
                    .as_str()
                    .ok_or_else(|| Error::from_reason("DID sem verkey"))?;

                // 4) 🔒 sanity-check: envelope realmente destinado a esse receiver?
                if receiver_verkey_ref != env_obj.crypto.recipient_verkey {
                    return Err(Error::from_reason(
                        "Envelope: recipient_verkey não corresponde ao receiver DID",
                    ));
                }

                let receiver_key_entry = session
                    .fetch_key(receiver_verkey_ref, false)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro fetch key: {e}")))?
                    .ok_or_else(|| Error::from_reason("Chave Privada Receiver não encontrada"))?;

                let receiver_key_ed25519 = receiver_key_entry
                    .load_local_key()
                    .map_err(|e| Error::from_reason(format!("Erro load local key: {e}")))?;

                let sender_bytes = bs58::decode(&sender_vk)
                    .into_vec()
                    .map_err(|_| Error::from_reason("Sender verkey inválida (Base58)"))?;

                let sender_key_ed25519 =
                    LocalKey::from_public_bytes(KeyAlg::Ed25519, &sender_bytes)
                        .map_err(|e| Error::from_reason(format!("Erro load sender key: {e}")))?;

                let receiver_exchange = receiver_key_ed25519
                    .convert_key(KeyAlg::X25519)
                    .map_err(|e| Error::from_reason(format!("Falha conv receiver Ed->X: {e}")))?;

                let sender_exchange = sender_key_ed25519
                    .convert_key(KeyAlg::X25519)
                    .map_err(|e| Error::from_reason(format!("Falha conv sender Ed->X: {e}")))?;

                let secret_bytes = crypto_box_open(
                    &receiver_exchange,
                    &sender_exchange,
                    &ciphertext,
                    &nonce_bytes,
                )
                .map_err(|e| Error::from_reason(format!("Falha Decifra: {e}")))?;

                let plaintext = String::from_utf8(secret_bytes.to_vec())
                    .map_err(|_| Error::from_reason("Mensagem decifrada não é UTF-8 válida"))?;

                Ok(plaintext)
            }

            _ => Err(Error::from_reason(
                "Envelope: mode não suportado neste MVP (use authcrypt/none)",
            )),
        }
    }

    // envelope_pack_none(...) cria um EnvelopeV1 sem criptografia (crypto.mode="none").
    // Ele encapsula o plaintext diretamente em payload.ciphertext e retorna o JSON do
    // envelope como String (sem async/N-API future).
    // Parâmetros:
    // - &self: instância da lib (não usa store; funciona offline).
    // - kind: String tipo lógico do pacote (offer/request/cred/proof/etc).
    // - thread_id: Option<String> id do fluxo; se None gera new_id("th").
    // - plaintext: String conteúdo em claro (vai direto para payload.ciphertext).
    // - expires_at_ms: Option<i64> expiração; <=0 vira None, senão é u64 em ms.
    // - meta_json: Option<String> JSON opcional com metadados (vira env.meta).
    // Fluxo interno:
    // - Converte expires_at_ms para Option<u64> (filtrando valores <=0).
    // - Parseia meta_json para serde_json::Value quando presente.
    // - Define thread_id (ou gera) e monta EnvelopeV1 padrão v1.
    // - Usa to.verkey="public" e recipient_verkey="public" para manter validação básica.
    // - Define crypto com mode/alg "none" e nonce/sender_verkey ausentes.
    // - Valida com validate_envelope_basic e serializa para JSON String.
    #[napi]
    pub fn envelope_pack_none(
        &self,
        kind: String,
        thread_id: Option<String>,
        plaintext: String,
        expires_at_ms: Option<i64>,
        meta_json: Option<String>,
    ) -> Result<String> {
        let expires_u64 = match expires_at_ms {
            None => None,
            Some(v) if v <= 0 => None,
            Some(v) => Some(v as u64),
        };

        let meta = match meta_json {
            None => None,
            Some(s) => {
                let v: serde_json::Value = serde_json::from_str(&s)
                    .map_err(|_| Error::from_reason("meta_json inválido (esperado JSON)"))?;
                Some(v)
            }
        };

        let tid = thread_id.unwrap_or_else(|| new_id("th"));

        let env_obj = EnvelopeV1 {
            v: 1,
            id: new_id("env"),
            kind,
            thread_id: tid,
            created_at_ms: now_ms(),
            expires_at_ms: expires_u64,
            from: None,
            to: PartyV1 {
                did: None,
                verkey: "public".to_string(),
            },
            crypto: CryptoV1 {
                mode: "none".to_string(),
                alg: "none".to_string(),
                sender_verkey: None,
                recipient_verkey: "public".to_string(),
                nonce: None,
            },
            payload: PayloadV1 {
                content_type: "application/json".to_string(),
                encoding: "utf8".to_string(),
                ciphertext: plaintext,
            },
            meta,
        };

        // Mantém as mesmas regras (mode=none passa porque to.verkey="public")
        validate_envelope_basic(&env_obj)?;

        serde_json::to_string(&env_obj)
            .map_err(|e| Error::from_reason(format!("Erro serializando envelope: {e}")))
    }

    // envelope_parse(envelope_json) faz o parse de um EnvelopeV1 e retorna um "summary"
    // (JSON pretty) com os principais metadados para inspeção/debug, sem decifrar.
    // Parâmetros:
    // - &self: instância da lib (não usa store; leitura/inspeção local).
    // - envelope_json: String contendo o JSON completo do EnvelopeV1.
    // Comportamento:
    // - Converte envelope_json -> EnvelopeV1; falha se o JSON for inválido.
    // - Não valida automaticamente (permite inspecionar envelopes "quebrados").
    //   Opcional: habilitar validate_envelope_basic(&env_obj) para impor regras.
    // - Calcula ciphertext_len (tamanho do payload.ciphertext) para evitar logar conteúdo.
    // - Monta um objeto summary com v/id/kind/thread/timestamps, from/to, crypto,
    //   payload (tipo/encoding/tamanho) e flags de presença (nonce/meta).
    // Retorno:
    // - String com JSON formatado (to_string_pretty) contendo o resumo.
    #[napi]
    pub fn envelope_parse(&self, envelope_json: String) -> Result<String> {
        let env_obj: EnvelopeV1 = serde_json::from_str(&envelope_json)
            .map_err(|_| Error::from_reason("Envelope JSON inválido"))?;

        // Não força validação aqui se você quiser inspecionar envelopes “quebrados”.
        // Se preferir validação, descomente:
        // validate_envelope_basic(&env_obj)?;

        let payload_len = env_obj.payload.ciphertext.len();

        let summary = serde_json::json!({
            "v": env_obj.v,
            "id": env_obj.id,
            "kind": env_obj.kind,
            "thread_id": env_obj.thread_id,
            "created_at_ms": env_obj.created_at_ms,
            "expires_at_ms": env_obj.expires_at_ms,
            "from": env_obj.from.as_ref().map(|p| serde_json::json!({
                "did": p.did,
                "verkey": p.verkey
            })),
            "to": {
                "did": env_obj.to.did,
                "verkey": env_obj.to.verkey
            },
            "crypto": {
                "mode": env_obj.crypto.mode,
                "alg": env_obj.crypto.alg,
                "sender_verkey": env_obj.crypto.sender_verkey,
                "recipient_verkey": env_obj.crypto.recipient_verkey,
                "nonce_present": env_obj.crypto.nonce.is_some()
            },
            "payload": {
                "content_type": env_obj.payload.content_type,
                "encoding": env_obj.payload.encoding,
                "ciphertext_len": payload_len
            },
            "meta_present": env_obj.meta.is_some()
        });

        serde_json::to_string_pretty(&summary)
            .map_err(|e| Error::from_reason(format!("Erro serializando summary: {e}")))
    }

    // envelope_pack_anoncrypt(...) empacota um plaintext em um EnvelopeV1 usando
    // criptografia anônima (crypto.mode="anoncrypt"), sem depender de wallet/store.
    // Parâmetros:
    // - &self: instância da lib (offline; não acessa chaves privadas do remetente).
    // - recipient_verkey: String verkey do destinatário (Ed25519 em Base58).
    // - kind: String tipo lógico do pacote (offer/request/cred/proof/etc).
    // - thread_id: String id do fluxo (obrigatório; não gera automaticamente).
    // - plaintext: String conteúdo em claro a ser cifrado.
    // - expires_at_ms: Option<i64> expiração; se Some(v) exige v>0 e converte p/ u64.
    // - meta_json: Option<String> JSON opcional para metadados (vira env.meta).
    // Fluxo interno:
    // - Valida expires_at_ms: se <=0 retorna erro (diferente do pack_none, que zera).
    // - Converte recipient_verkey: Base58 (Ed25519) -> LocalKey pub -> X25519.
    // - Gera chave efêmera X25519 (priv) e obtém a pubkey (epk) para o pacote interno.
    // - Gera nonce de 24 bytes e cifra com aries_askar::kms::crypto_box (anoncrypt).
    // - Monta pkg interno (payload.ciphertext) com Base64 de ciphertext/nonce/epk.
    // - Parseia meta_json (quando presente) e cria EnvelopeV1 com:
    //   * from=None (anoncrypt não autentica remetente).
    //   * to.verkey=recipient_verkey.
    //   * crypto: mode="anoncrypt", alg definido, recipient_verkey e nonce (Base64).
    // - Valida com validate_envelope_basic e serializa EnvelopeV1 para JSON String.
    // Erros típicos:
    // - expires_at_ms inválido, verkey Base58 inválida, falha conversão Ed->X,
    //   falha gerar chave efêmera, falha crypto_box, meta_json inválido, falha serialize.
    #[napi]
    pub fn envelope_pack_anoncrypt(
        &self,
        recipient_verkey: String,
        kind: String,
        thread_id: String,
        plaintext: String,
        expires_at_ms: Option<i64>,
        meta_json: Option<String>,
    ) -> Result<String> {
        use aries_askar::crypto::alg::KeyAlg;
        use aries_askar::kms::{crypto_box, LocalKey};
        use base64::{engine::general_purpose, Engine as _};
        use rand::RngCore;

        let expires_at_ms_u64: Option<u64> = match expires_at_ms {
            None => None,
            Some(v) => {
                if v <= 0 {
                    return Err(Error::from_reason("expires_at_ms inválido (<=0)"));
                }
                Some(v as u64)
            }
        };

        // recipient_verkey: Ed25519 base58 -> LocalKey pub Ed25519 -> X25519
        let recip_ed_bytes = bs58::decode(&recipient_verkey)
            .into_vec()
            .map_err(|_| Error::from_reason("Recipient verkey inválida (Base58)"))?;

        let recip_ed = LocalKey::from_public_bytes(KeyAlg::Ed25519, &recip_ed_bytes)
            .map_err(|e| Error::from_reason(format!("Erro load recipient key: {e}")))?;

        let recip_x = recip_ed
            .convert_key(KeyAlg::X25519)
            .map_err(|e| Error::from_reason(format!("Falha convert recipient Ed->X: {e}")))?;

        // chave efêmera X25519
        let eph_priv = LocalKey::generate_with_rng(KeyAlg::X25519, true)
            .map_err(|e| Error::from_reason(format!("Erro gerar chave efêmera: {e}")))?;

        let eph_pub_bytes = eph_priv
            .to_public_bytes()
            .map_err(|e| Error::from_reason(format!("Erro obter pubkey efêmera: {e}")))?;

        // nonce 24 bytes (crypto_box)
        let mut nonce = [0u8; 24];
        rand::thread_rng().fill_bytes(&mut nonce);

        let ct = crypto_box(&recip_x, &eph_priv, plaintext.as_bytes(), &nonce)
            .map_err(|e| Error::from_reason(format!("Erro crypto_box: {e}")))?;

        // pacote interno (vai em payload.ciphertext)
        let pkg = serde_json::json!({
            "ciphertext": general_purpose::STANDARD.encode(ct),
            "nonce": general_purpose::STANDARD.encode(nonce),
            "epk": general_purpose::STANDARD.encode(eph_pub_bytes),
        });
        let pkg_json = serde_json::to_string(&pkg)
            .map_err(|_| Error::from_reason("Falha serializar pacote anoncrypt"))?;

        // meta
        let meta: Option<serde_json::Value> = match meta_json {
            Some(s) => Some(
                serde_json::from_str(&s)
                    .map_err(|_| Error::from_reason("meta_json inválido (JSON)"))?,
            ),
            None => None,
        };

        let created_at_ms = now_ms();

        // Monta envelope no SEU formato
        let env = EnvelopeV1 {
            v: 1,
            id: new_id("env"),
            kind,
            thread_id,
            created_at_ms,
            expires_at_ms: expires_at_ms_u64,
            from: None,
            to: PartyV1 {
                did: None,
                verkey: recipient_verkey.clone(),
            },
            crypto: CryptoV1 {
                mode: "anoncrypt".to_string(),
                alg: "crypto_box_x25519xsalsa20poly1305".to_string(),
                sender_verkey: None,
                recipient_verkey,
                nonce: Some(general_purpose::STANDARD.encode(nonce)),
            },
            payload: PayloadV1 {
                content_type: "application/json".to_string(),
                encoding: "utf8".to_string(),
                ciphertext: pkg_json,
            },
            meta,
        };

        // valida já na criação (pega expiração inválida cedo)
        validate_envelope_basic(&env)?;

        serde_json::to_string(&env).map_err(|_| Error::from_reason("Falha serializar EnvelopeV1"))
    }
}
