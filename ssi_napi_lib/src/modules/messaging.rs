// src/modules/messaging.rs
use crate::IndyAgent;
use napi::{Env, Error, JsObject, Result};
use napi_derive::napi;

// Imports de Criptografia (Askar)
// use aries_askar::crypto::alg::KeyAlg;
// use aries_askar::kms::{crypto_box, crypto_box_open, LocalKey};

// // Utilitários
// use base64::{engine::general_purpose, Engine as _};
// use rand::RngCore;

const SSIFILE2_MAGIC: &[u8; 8] = b"SSIFILE2";

fn u32_le(x: u32) -> [u8; 4] {
    x.to_le_bytes()
}

fn derive_nonce_12(base: &[u8; 12], idx: u32) -> [u8; 12] {
    // Derivação simples e determinística: XOR nos 4 bytes finais com idx LE.
    // Mantém nonce único por chunk.
    let mut n = *base;
    let b = idx.to_le_bytes();
    n[8] ^= b[0];
    n[9] ^= b[1];
    n[10] ^= b[2];
    n[11] ^= b[3];
    n
}

// Payload canônico para assinatura do header (v2)
fn build_large_header_signing_payload(
    sender_verkey: &str,
    target_verkey: &str,
    kek_nonce_b64: &str,
    kek_ct_b64: &str,
    aead_alg: &str,
    chunk_size: u32,
    file_id_b64: &str,
    base_nonce_b64: &str,
    filename: &str,
    bytes_len: u64,
) -> Vec<u8> {
    let v: u32 = 2;
    let typ = "ssi:filebox.large";
    format!(
        "v={}\n\
     type={}\n\
     sender_verkey={}\n\
     target_verkey={}\n\
     kek.alg=crypto_box_x25519\n\
     kek.nonce={}\n\
     kek.ciphertext={}\n\
     aead.alg={}\n\
     aead.chunk_size={}\n\
     aead.file_id={}\n\
     aead.base_nonce={}\n\
     meta.filename={}\n\
     meta.bytes={}\n",
        v,
        typ,
        sender_verkey,
        target_verkey,
        kek_nonce_b64,
        kek_ct_b64,
        aead_alg,
        chunk_size,
        file_id_b64,
        base_nonce_b64,
        filename,
        bytes_len
    )
    .into_bytes()
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigV2 {
    pub alg: String,           // "ed25519"
    pub signer_verkey: String, // base58
    pub value: String,         // base64(signature)
}

// Pacote base (v1/v2) — para MESSAGE
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgBox {
    pub ciphertext: String,    // base64
    pub nonce: String,         // base64
    pub sender_verkey: String, // base58
    pub target_verkey: String, // base58

    #[serde(default)]
    pub v: Option<u32>, // v2 => Some(2), v1 => None ou Some(1)
    #[serde(default)]
    pub r#type: Option<String>, // "ssi:msgbox"

    #[serde(default)]
    pub sig: Option<SigV2>,
}

// Pacote base (v1/v2) — para FILE
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMeta {
    pub filename: String,
    pub bytes: u64,
}

fn build_signing_payload_msg(
    v: u32,
    typ: &str,
    sender_vk: &str,
    target_vk: &str,
    nonce_b64: &str,
    ciphertext_b64: &str,
) -> Vec<u8> {
    format!(
        "v={}\n\
     type={}\n\
     sender_verkey={}\n\
     target_verkey={}\n\
     nonce={}\n\
     ciphertext={}\n",
        v, typ, sender_vk, target_vk, nonce_b64, ciphertext_b64
    )
    .into_bytes()
}

fn build_signing_payload_file(
    v: u32,
    typ: &str,
    sender_vk: &str,
    target_vk: &str,
    nonce_b64: &str,
    ciphertext_b64: &str,
    filename: &str,
    bytes: u64,
) -> Vec<u8> {
    format!(
        "v={}\n\
     type={}\n\
     sender_verkey={}\n\
     target_verkey={}\n\
     nonce={}\n\
     ciphertext={}\n\
     meta.filename={}\n\
     meta.bytes={}\n",
        v, typ, sender_vk, target_vk, nonce_b64, ciphertext_b64, filename, bytes
    )
    .into_bytes()
}

fn verify_sig_ed25519(signer_verkey_b58: &str, payload: &[u8], sig_b64: &str) -> napi::Result<()> {
    use base64::{engine::general_purpose, Engine as _};
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    // signer verkey (base58) -> [u8; 32]
    let pk_vec = match bs58::decode(signer_verkey_b58).into_vec() {
        Ok(v) => v,
        Err(_) => {
            return Err(napi::Error::from_reason(
                "Signature: signer_verkey base58 inválida",
            ))
        }
    };

    let pk_bytes: [u8; 32] = match pk_vec.as_slice().try_into() {
        Ok(a) => a,
        Err(_) => {
            return Err(napi::Error::from_reason(
                "Signature: signer_verkey tamanho inválido",
            ))
        }
    };

    let vk = match VerifyingKey::from_bytes(&pk_bytes) {
        Ok(vk) => vk,
        Err(_) => {
            return Err(napi::Error::from_reason(
                "Signature: chave pública inválida",
            ))
        }
    };

    let sig_vec = match general_purpose::STANDARD.decode(sig_b64) {
        Ok(v) => v,
        Err(_) => return Err(napi::Error::from_reason("Signature: base64 inválida")),
    };

    let sig = match Signature::from_slice(&sig_vec) {
        Ok(s) => s,
        Err(_) => return Err(napi::Error::from_reason("Signature: assinatura inválida")),
    };

    if vk.verify(payload, &sig).is_err() {
        return Err(napi::Error::from_reason("Signature verification failed"));
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileBox {
    pub ciphertext: String,
    pub nonce: String,
    pub sender_verkey: String,
    pub target_verkey: String,

    #[serde(default)]
    pub v: Option<u32>,
    #[serde(default)]
    pub r#type: Option<String>, // "ssi:filebox"

    #[serde(default)]
    pub meta: Option<FileMeta>,

    #[serde(default)]
    pub sig: Option<SigV2>,
}

#[napi]
impl IndyAgent {
    // =========================================================================
    //  8. COMUNICAÇÃO SEGURA
    // =========================================================================

    // CIFRAGEM DE MENSAGEM (v2 assinado + compat v1)
    #[napi]
    pub fn encrypt_message(
        &self,
        env: Env,
        sender_did: String,
        target_verkey: String,
        message: String,
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
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // 1) RESOLVER DID SENDER -> VERKEY
                let did_entry = session
                    .fetch("did", &sender_did, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro DB DID: {}", e)))?
                    .ok_or_else(|| {
                        napi::Error::from_reason(format!("DID {} não encontrado", sender_did))
                    })?;

                let did_json: serde_json::Value = serde_json::from_slice(&did_entry.value)
                    .map_err(|_| napi::Error::from_reason("Erro parse DID JSON"))?;

                let sender_verkey_str = did_json["verkey"]
                    .as_str()
                    .ok_or_else(|| napi::Error::from_reason("DID sem verkey"))?;

                // IMPORTANTE: copiar para String para não carregar &str no async (safety + ownership)
                let sender_verkey = sender_verkey_str.to_string();

                // 2) CARREGAR CHAVE PRIVADA (SENDER) - ED25519
                let sender_key_entry = session
                    .fetch_key(&sender_verkey, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch key: {}", e)))?
                    .ok_or_else(|| {
                        napi::Error::from_reason("Chave privada Sender não encontrada")
                    })?;

                let sender_key_ed25519 = sender_key_entry
                    .load_local_key()
                    .map_err(|e| napi::Error::from_reason(format!("Erro load local key: {}", e)))?;

                // 3) CARREGAR CHAVE PÚBLICA (TARGET) - ED25519 public
                let target_bytes = bs58::decode(&target_verkey)
                    .into_vec()
                    .map_err(|_| napi::Error::from_reason("Target Verkey inválida (Base58)"))?;

                let target_key_ed25519 =
                    LocalKey::from_public_bytes(KeyAlg::Ed25519, &target_bytes).map_err(|e| {
                        napi::Error::from_reason(format!("Erro load target key: {}", e))
                    })?;

                // 4) CONVERTER CHAVES (Ed25519 -> X25519) para AuthCrypt
                let sender_exchange =
                    sender_key_ed25519
                        .convert_key(KeyAlg::X25519)
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Falha convert Sender Ed->X: {}", e))
                        })?;

                let target_exchange =
                    target_key_ed25519
                        .convert_key(KeyAlg::X25519)
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Falha convert Target Ed->X: {}", e))
                        })?;

                // 5) CIFRAR (Crypto Box)
                let mut nonce = [0u8; 24];
                rand::thread_rng().fill_bytes(&mut nonce);

                let ciphertext = crypto_box(
                    &target_exchange,
                    &sender_exchange,
                    message.as_bytes(),
                    &nonce,
                )
                .map_err(|e| napi::Error::from_reason(format!("Erro crypto_box: {}", e)))?;

                let nonce_b64 = general_purpose::STANDARD.encode(nonce);
                let ct_b64 = general_purpose::STANDARD.encode(ciphertext);

                // 6) ASSINAR ENVELOPE (v2)
                // Canonical payload simples (ordem fixa) - evita problemas de canonicalização JSON.
                let v: u32 = 2;
                let typ = "ssi:msgbox";

                let signing_payload = format!(
                    "v={}\n\
                 type={}\n\
                 sender_verkey={}\n\
                 target_verkey={}\n\
                 nonce={}\n\
                 ciphertext={}\n",
                    v, typ, sender_verkey, target_verkey, nonce_b64, ct_b64
                )
                .into_bytes();

                let sig_bytes = sender_key_ed25519
                    .sign_message(&signing_payload, None)
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro assinar envelope: {}", e))
                    })?;

                let sig_b64 = general_purpose::STANDARD.encode(sig_bytes);

                // 7) ENVELOPE JSON (compatível + v2 assinado)
                let response = serde_json::json!({
                    "v": v,
                    "type": typ,

                    // campos "v1" preservados:
                    "ciphertext": ct_b64,
                    "nonce": nonce_b64,
                    "sender_verkey": sender_verkey,
                    "target_verkey": target_verkey,

                    // assinatura do envelope:
                    "sig": {
                        "alg": "ed25519",
                        "signer_verkey": sender_verkey, // deve bater com sender_verkey
                        "value": sig_b64
                    }
                });

                Ok(serde_json::to_string(&response).unwrap())
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // DECIFRAGEM DE MENSAGEM (compat v1 + validação de assinatura v2)
    #[napi]
    pub fn decrypt_message(
        &self,
        env: Env,
        receiver_did: String,
        sender_verkey: String,
        encrypted_json: String,
    ) -> Result<JsObject> {
        use aries_askar::crypto::alg::KeyAlg;
        use aries_askar::kms::{crypto_box_open, LocalKey};
        use base64::{engine::general_purpose, Engine as _};

        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        env.execute_tokio_future(
            async move {
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // 1) PARSE JSON
                let pkg: serde_json::Value = serde_json::from_str(&encrypted_json)
                    .map_err(|_| napi::Error::from_reason("JSON invalido"))?;

                // campos básicos (v1/v2)
                let ciphertext_b64 = pkg["ciphertext"]
                    .as_str()
                    .ok_or_else(|| napi::Error::from_reason("ciphertext ausente"))?
                    .to_string();

                let nonce_b64 = pkg["nonce"]
                    .as_str()
                    .ok_or_else(|| napi::Error::from_reason("nonce ausente"))?
                    .to_string();

                // se o envelope tiver sender_verkey, garantir coerência com argumento
                if let Some(pkg_sender_vk) = pkg.get("sender_verkey").and_then(|v| v.as_str()) {
                    if pkg_sender_vk != sender_verkey {
                        return Err(napi::Error::from_reason(
                            "Envelope sender_verkey diferente do sender_verkey informado",
                        ));
                    }
                }

                // target_verkey é usado para assinatura v2 (não para o crypto_box_open diretamente)
                let target_verkey = pkg
                    .get("target_verkey")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                // 2) MODO COMPATÍVEL: validar assinatura se for v2 (v>=2 ou sig presente)
                let v_num = pkg.get("v").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
                let has_sig = pkg.get("sig").is_some();
                let is_v2 = v_num >= 2 || has_sig;

                if is_v2 {
                    let typ = pkg
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("ssi:msgbox");

                    let sig_obj = pkg
                        .get("sig")
                        .ok_or_else(|| napi::Error::from_reason("Envelope v2 exige sig"))?;

                    let alg = sig_obj
                        .get("alg")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| napi::Error::from_reason("sig.alg ausente"))?;

                    if alg != "ed25519" {
                        return Err(napi::Error::from_reason(
                            "sig.alg inválido (esperado ed25519)",
                        ));
                    }

                    let signer_verkey = sig_obj
                        .get("signer_verkey")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| napi::Error::from_reason("sig.signer_verkey ausente"))?;

                    let sig_b64 = sig_obj
                        .get("value")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| napi::Error::from_reason("sig.value ausente"))?;

                    // coerência: signer_verkey deve ser igual ao sender_verkey
                    if signer_verkey != sender_verkey {
                        return Err(napi::Error::from_reason(
                            "sig.signer_verkey != sender_verkey",
                        ));
                    }

                    // v2 assinado deve ter target_verkey (para fechar o envelope)
                    if target_verkey.is_empty() {
                        return Err(napi::Error::from_reason(
                            "Envelope v2: target_verkey ausente",
                        ));
                    }

                    // canonical payload (mesma regra do encrypt)
                    let signing_payload = format!(
                        "v={}\n\
                     type={}\n\
                     sender_verkey={}\n\
                     target_verkey={}\n\
                     nonce={}\n\
                     ciphertext={}\n",
                        2u32, typ, sender_verkey, target_verkey, nonce_b64, ciphertext_b64
                    )
                    .into_bytes();

                    // valida assinatura (helper)
                    verify_sig_ed25519(signer_verkey, &signing_payload, sig_b64)?;
                }

                // 3) BASE64 DECODE (após assinatura ok)
                let ciphertext = general_purpose::STANDARD
                    .decode(&ciphertext_b64)
                    .map_err(|_| napi::Error::from_reason("Bad Base64 Ciphertext"))?;

                let nonce_bytes = general_purpose::STANDARD
                    .decode(&nonce_b64)
                    .map_err(|_| napi::Error::from_reason("Bad Base64 Nonce"))?;

                // 4) RESOLVER RECEIVER DID -> VERKEY
                let did_entry = session
                    .fetch("did", &receiver_did, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro DB: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("Receiver DID não achado"))?;

                let did_json: serde_json::Value = serde_json::from_slice(&did_entry.value)
                    .map_err(|_| napi::Error::from_reason("Erro parse DID JSON"))?;

                let receiver_verkey_ref = did_json["verkey"]
                    .as_str()
                    .ok_or_else(|| napi::Error::from_reason("DID sem verkey"))?;

                // 5) CARREGAR CHAVE PRIVADA (RECEIVER) ED25519
                let receiver_key_entry = session
                    .fetch_key(receiver_verkey_ref, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch key: {}", e)))?
                    .ok_or_else(|| {
                        napi::Error::from_reason("Chave Privada Receiver não encontrada")
                    })?;

                let receiver_key_ed25519 = receiver_key_entry
                    .load_local_key()
                    .map_err(|e| napi::Error::from_reason(format!("Erro load local key: {}", e)))?;

                // 6) CARREGAR CHAVE PÚBLICA (SENDER) ED25519
                let sender_bytes = bs58::decode(&sender_verkey)
                    .into_vec()
                    .map_err(|_| napi::Error::from_reason("Sender Verkey inválida (Base58)"))?;

                let sender_key_ed25519 =
                    LocalKey::from_public_bytes(KeyAlg::Ed25519, &sender_bytes).map_err(|e| {
                        napi::Error::from_reason(format!("Erro load sender key: {}", e))
                    })?;

                // 7) CONVERTER CHAVES (Ed25519 -> X25519)
                let receiver_exchange =
                    receiver_key_ed25519
                        .convert_key(KeyAlg::X25519)
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Falha conv receiver Ed->X: {}", e))
                        })?;

                let sender_exchange =
                    sender_key_ed25519
                        .convert_key(KeyAlg::X25519)
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Falha conv sender Ed->X: {}", e))
                        })?;

                // 8) DECIFRAR (crypto_box_open)
                let secret_bytes = crypto_box_open(
                    &receiver_exchange,
                    &sender_exchange,
                    &ciphertext,
                    &nonce_bytes,
                )
                .map_err(|e| napi::Error::from_reason(format!("Falha Decifra: {}", e)))?;

                // 9) SecretBytes -> String
                let plaintext = String::from_utf8(secret_bytes.to_vec()).map_err(|_| {
                    napi::Error::from_reason("Mensagem decifrada não é UTF-8 válido")
                })?;

                Ok(plaintext)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // MÉTODOS PARA A CIFRAGEM DE ARQUIVOS
    #[napi]
    pub fn encrypt_file(
        &self,
        env: Env,
        sender_did: String,
        target_verkey: String,
        in_path: String,
        out_path: String,
    ) -> Result<JsObject> {
        use aries_askar::crypto::alg::KeyAlg;
        use aries_askar::kms::{crypto_box, LocalKey};
        use base64::{engine::general_purpose, Engine as _};
        use rand::RngCore;
        use std::path::Path;
        use tokio::fs;

        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        env.execute_tokio_future(
            async move {
                // 1) Ler arquivo
                let file_bytes = fs::read(&in_path)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro lendo arquivo: {}", e)))?;

                let filename = Path::new(&in_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown")
                    .to_string();

                let bytes_len_u64: u64 = file_bytes.len() as u64;

                // 2) Abrir sessão
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // 3) Resolver DID sender -> verkey
                let did_entry = session
                    .fetch("did", &sender_did, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro DB DID: {}", e)))?
                    .ok_or_else(|| {
                        napi::Error::from_reason(format!("DID {} não encontrado", sender_did))
                    })?;

                let did_json: serde_json::Value = serde_json::from_slice(&did_entry.value)
                    .map_err(|_| napi::Error::from_reason("Erro parse DID JSON"))?;

                let sender_verkey_str = did_json["verkey"]
                    .as_str()
                    .ok_or_else(|| napi::Error::from_reason("DID sem verkey"))?;

                // copiar para String (evita &str atravessando awaits)
                let sender_verkey = sender_verkey_str.to_string();

                // 4) Carregar chave privada do sender (ed25519) e converter para x25519 (para crypto_box)
                let sender_key_entry = session
                    .fetch_key(&sender_verkey, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch key: {}", e)))?
                    .ok_or_else(|| {
                        napi::Error::from_reason("Chave privada Sender não encontrada")
                    })?;

                let sender_key_ed25519 = sender_key_entry
                    .load_local_key()
                    .map_err(|e| napi::Error::from_reason(format!("Erro load local key: {}", e)))?;

                let sender_exchange =
                    sender_key_ed25519
                        .convert_key(KeyAlg::X25519)
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Falha convert Sender Ed->X: {}", e))
                        })?;

                // 5) Carregar chave pública do target (ed25519) e converter para x25519
                let target_bytes = bs58::decode(&target_verkey)
                    .into_vec()
                    .map_err(|_| napi::Error::from_reason("Target Verkey inválida (Base58)"))?;

                let target_key_ed25519 =
                    LocalKey::from_public_bytes(KeyAlg::Ed25519, &target_bytes).map_err(|e| {
                        napi::Error::from_reason(format!("Erro load target key: {}", e))
                    })?;

                let target_exchange =
                    target_key_ed25519
                        .convert_key(KeyAlg::X25519)
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Falha convert Target Ed->X: {}", e))
                        })?;

                // 6) Cifrar
                let mut nonce = [0u8; 24];
                rand::thread_rng().fill_bytes(&mut nonce);

                let ciphertext =
                    crypto_box(&target_exchange, &sender_exchange, &file_bytes, &nonce)
                        .map_err(|e| napi::Error::from_reason(format!("Erro crypto_box: {}", e)))?;

                let nonce_b64 = general_purpose::STANDARD.encode(nonce);
                let ct_b64 = general_purpose::STANDARD.encode(ciphertext);

                // 7) Assinar envelope (v2)
                let v: u32 = 2;
                let typ = "ssi:filebox";

                let signing_payload = format!(
                    "v={}\n\
                 type={}\n\
                 sender_verkey={}\n\
                 target_verkey={}\n\
                 nonce={}\n\
                 ciphertext={}\n\
                 meta.filename={}\n\
                 meta.bytes={}\n",
                    v,
                    typ,
                    sender_verkey,
                    target_verkey,
                    nonce_b64,
                    ct_b64,
                    filename,
                    bytes_len_u64
                )
                .into_bytes();

                let sig_bytes = sender_key_ed25519
                    .sign_message(&signing_payload, None)
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro assinar envelope: {}", e))
                    })?;

                let sig_b64 = general_purpose::STANDARD.encode(sig_bytes);

                // 8) Envelope JSON (v2 assinado + campos compat)
                let pkg = serde_json::json!({
                    "v": v,
                    "type": typ,

                    "sender_verkey": sender_verkey,
                    "target_verkey": target_verkey,
                    "nonce": nonce_b64,
                    "ciphertext": ct_b64,

                    "meta": {
                        "filename": filename,
                        "bytes": bytes_len_u64
                    },

                    "sig": {
                        "alg": "ed25519",
                        "signer_verkey": sender_verkey,
                        "value": sig_b64
                    }
                });

                // 9) Escrever pacote cifrado em arquivo
                let pkg_str = serde_json::to_string_pretty(&pkg).map_err(|e| {
                    napi::Error::from_reason(format!("Erro serializando JSON: {}", e))
                })?;

                fs::write(&out_path, pkg_str.as_bytes())
                    .await
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro escrevendo pacote: {}", e))
                    })?;

                // Retorna metadados (útil p/ logs/testes)
                let resp = serde_json::json!({
                    "ok": true,
                    "out_path": out_path,
                    "meta": pkg["meta"]
                });

                Ok(resp.to_string())
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    #[napi]
    pub fn decrypt_file(
        &self,
        env: Env,
        receiver_did: String,
        sender_verkey: String,
        in_path: String,
        out_path: String,
    ) -> Result<JsObject> {
        use aries_askar::crypto::alg::KeyAlg;
        use aries_askar::kms::{crypto_box_open, LocalKey};
        use base64::{engine::general_purpose, Engine as _};
        use tokio::fs;

        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        env.execute_tokio_future(
            async move {
                // 1) Ler pacote cifrado
                let pkg_bytes = fs::read(&in_path)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro lendo pacote: {}", e)))?;

                let pkg_str = String::from_utf8(pkg_bytes).map_err(|_| {
                    napi::Error::from_reason("Pacote não é UTF-8 válido (JSON esperado)")
                })?;

                let pkg: serde_json::Value = serde_json::from_str(&pkg_str)
                    .map_err(|_| napi::Error::from_reason("JSON inválido no pacote"))?;

                // 1.1) Campos básicos
                let ciphertext_b64 = pkg["ciphertext"]
                    .as_str()
                    .ok_or_else(|| napi::Error::from_reason("ciphertext ausente"))?
                    .to_string();

                let nonce_b64 = pkg["nonce"]
                    .as_str()
                    .ok_or_else(|| napi::Error::from_reason("nonce ausente"))?
                    .to_string();

                // coerência: se envelope tiver sender_verkey, deve bater com argumento
                if let Some(pkg_sender_vk) = pkg.get("sender_verkey").and_then(|v| v.as_str()) {
                    if pkg_sender_vk != sender_verkey {
                        return Err(napi::Error::from_reason(
                            "Envelope sender_verkey diferente do sender_verkey informado",
                        ));
                    }
                }

                let target_verkey = pkg
                    .get("target_verkey")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                // 1.2) Detectar v2 (compat)
                let v_num = pkg.get("v").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
                let has_sig = pkg.get("sig").is_some();
                let is_v2 = v_num >= 2 || has_sig;

                // 2) Se v2, validar assinatura (ANTES de abrir o ciphertext)
                if is_v2 {
                    let typ = pkg
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("ssi:filebox");

                    let sig_obj = pkg
                        .get("sig")
                        .ok_or_else(|| napi::Error::from_reason("Envelope v2 exige sig"))?;

                    let alg = sig_obj
                        .get("alg")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| napi::Error::from_reason("sig.alg ausente"))?;

                    if alg != "ed25519" {
                        return Err(napi::Error::from_reason(
                            "sig.alg inválido (esperado ed25519)",
                        ));
                    }

                    let signer_verkey = sig_obj
                        .get("signer_verkey")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| napi::Error::from_reason("sig.signer_verkey ausente"))?;

                    let sig_b64 = sig_obj
                        .get("value")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| napi::Error::from_reason("sig.value ausente"))?;

                    if signer_verkey != sender_verkey {
                        return Err(napi::Error::from_reason(
                            "sig.signer_verkey != sender_verkey",
                        ));
                    }

                    if target_verkey.is_empty() {
                        return Err(napi::Error::from_reason(
                            "Envelope v2: target_verkey ausente",
                        ));
                    }

                    // meta obrigatório em filebox v2
                    let meta = pkg
                        .get("meta")
                        .ok_or_else(|| napi::Error::from_reason("Envelope v2: meta ausente"))?;
                    let meta_filename =
                        meta.get("filename")
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| {
                                napi::Error::from_reason("Envelope v2: meta.filename ausente")
                            })?;

                    let meta_bytes =
                        meta.get("bytes").and_then(|v| v.as_u64()).ok_or_else(|| {
                            napi::Error::from_reason("Envelope v2: meta.bytes ausente")
                        })?;

                    let signing_payload = format!(
                        "v={}\n\
                     type={}\n\
                     sender_verkey={}\n\
                     target_verkey={}\n\
                     nonce={}\n\
                     ciphertext={}\n\
                     meta.filename={}\n\
                     meta.bytes={}\n",
                        2u32,
                        typ,
                        sender_verkey,
                        target_verkey,
                        nonce_b64,
                        ciphertext_b64,
                        meta_filename,
                        meta_bytes
                    )
                    .into_bytes();

                    verify_sig_ed25519(signer_verkey, &signing_payload, sig_b64)?;
                }

                // 3) Base64 decode (após assinatura OK)
                let ciphertext = general_purpose::STANDARD
                    .decode(&ciphertext_b64)
                    .map_err(|_| napi::Error::from_reason("Bad Base64 ciphertext"))?;

                let nonce_bytes = general_purpose::STANDARD
                    .decode(&nonce_b64)
                    .map_err(|_| napi::Error::from_reason("Bad Base64 nonce"))?;

                // 4) Abrir sessão
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // 5) Resolver receiver_did -> receiver verkey
                let did_entry = session
                    .fetch("did", &receiver_did, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro DB: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("Receiver DID não achado"))?;

                let did_json: serde_json::Value = serde_json::from_slice(&did_entry.value)
                    .map_err(|_| napi::Error::from_reason("Erro parse DID JSON"))?;

                let receiver_verkey_ref = did_json["verkey"]
                    .as_str()
                    .ok_or_else(|| napi::Error::from_reason("DID sem verkey"))?;

                // 6) Carregar chave privada do receiver (ed25519) e converter para x25519
                let receiver_key_entry = session
                    .fetch_key(receiver_verkey_ref, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch key: {}", e)))?
                    .ok_or_else(|| {
                        napi::Error::from_reason("Chave Privada Receiver não encontrada")
                    })?;

                let receiver_key_ed25519 = receiver_key_entry
                    .load_local_key()
                    .map_err(|e| napi::Error::from_reason(format!("Erro load local key: {}", e)))?;

                let receiver_exchange =
                    receiver_key_ed25519
                        .convert_key(KeyAlg::X25519)
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Falha conv receiver Ed->X: {}", e))
                        })?;

                // 7) Carregar chave pública do sender (ed25519) e converter para x25519
                let sender_bytes = bs58::decode(&sender_verkey)
                    .into_vec()
                    .map_err(|_| napi::Error::from_reason("Sender Verkey inválida (Base58)"))?;

                let sender_key_ed25519 =
                    LocalKey::from_public_bytes(KeyAlg::Ed25519, &sender_bytes).map_err(|e| {
                        napi::Error::from_reason(format!("Erro load sender key: {}", e))
                    })?;

                let sender_exchange =
                    sender_key_ed25519
                        .convert_key(KeyAlg::X25519)
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Falha conv sender Ed->X: {}", e))
                        })?;

                // 8) Decifrar
                let secret_bytes = crypto_box_open(
                    &receiver_exchange,
                    &sender_exchange,
                    &ciphertext,
                    &nonce_bytes,
                )
                .map_err(|e| napi::Error::from_reason(format!("Falha Decifra: {}", e)))?;

                let plain = secret_bytes.to_vec();

                // 9) Escrever arquivo restaurado
                fs::write(&out_path, &plain).await.map_err(|e| {
                    napi::Error::from_reason(format!("Erro escrevendo arquivo: {}", e))
                })?;

                // 10) Resposta
                let resp = serde_json::json!({
                    "ok": true,
                    "out_path": out_path,
                    "meta": pkg["meta"] // atenção: confiável SOMENTE se v2 + sig ok (que foi validado acima)
                });

                Ok(resp.to_string())
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    #[napi]
    pub fn encrypt_file_large(
        &self,
        env: Env,
        sender_did: String,
        target_verkey: String,
        in_path: String,
        out_path: String,
        chunk_size: Option<u32>, // ex.: 1_048_576 (1MB)
    ) -> Result<JsObject> {
        use aries_askar::crypto::alg::KeyAlg;
        use aries_askar::kms::{crypto_box, LocalKey};
        use base64::{engine::general_purpose, Engine as _};
        use rand::RngCore;
        use std::path::Path;
        use tokio::fs;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        use chacha20poly1305::aead::{AeadInPlace, KeyInit};
        use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};

        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        env.execute_tokio_future(
            async move {
                let chunk_sz = chunk_size.unwrap_or(1_048_576).max(64 * 1024); // mínimo 64KB

                // 1) Stat e meta
                let meta_fs = fs::metadata(&in_path).await.map_err(|e| {
                    napi::Error::from_reason(format!("Erro metadata arquivo: {}", e))
                })?;
                let bytes_len = meta_fs.len();

                let filename = Path::new(&in_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown")
                    .to_string();

                // 2) Abrir sessão
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // 3) DID sender -> verkey
                let did_entry = session
                    .fetch("did", &sender_did, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro DB DID: {}", e)))?
                    .ok_or_else(|| {
                        napi::Error::from_reason(format!("DID {} não encontrado", sender_did))
                    })?;

                let did_json: serde_json::Value = serde_json::from_slice(&did_entry.value)
                    .map_err(|_| napi::Error::from_reason("Erro parse DID JSON"))?;

                let sender_verkey_str = did_json["verkey"]
                    .as_str()
                    .ok_or_else(|| napi::Error::from_reason("DID sem verkey"))?;

                let sender_verkey = sender_verkey_str.to_string();

                // 4) Chave privada sender ed25519 (para assinar) e x25519 (para crypto_box)
                let sender_key_entry = session
                    .fetch_key(&sender_verkey, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch key: {}", e)))?
                    .ok_or_else(|| {
                        napi::Error::from_reason("Chave privada Sender não encontrada")
                    })?;

                let sender_key_ed25519 = sender_key_entry
                    .load_local_key()
                    .map_err(|e| napi::Error::from_reason(format!("Erro load local key: {}", e)))?;

                let sender_exchange =
                    sender_key_ed25519
                        .convert_key(KeyAlg::X25519)
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Falha convert Sender Ed->X: {}", e))
                        })?;

                // 5) Target verkey (pub ed25519) -> x25519
                let target_bytes = bs58::decode(&target_verkey)
                    .into_vec()
                    .map_err(|_| napi::Error::from_reason("Target Verkey inválida (Base58)"))?;

                let target_key_ed25519 =
                    LocalKey::from_public_bytes(KeyAlg::Ed25519, &target_bytes).map_err(|e| {
                        napi::Error::from_reason(format!("Erro load target key: {}", e))
                    })?;

                let target_exchange =
                    target_key_ed25519
                        .convert_key(KeyAlg::X25519)
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Falha convert Target Ed->X: {}", e))
                        })?;

                // 6) Gerar K (32 bytes) + file_id (16) + base_nonce (12)
                let mut k_bytes = [0u8; 32];
                let mut file_id = [0u8; 16];
                let mut base_nonce = [0u8; 12];
                rand::thread_rng().fill_bytes(&mut k_bytes);
                rand::thread_rng().fill_bytes(&mut file_id);
                rand::thread_rng().fill_bytes(&mut base_nonce);

                // 7) Encapsular K via crypto_box (kek)
                let mut kek_nonce = [0u8; 24];
                rand::thread_rng().fill_bytes(&mut kek_nonce);

                let kek_ct = crypto_box(&target_exchange, &sender_exchange, &k_bytes, &kek_nonce)
                    .map_err(|e| {
                    napi::Error::from_reason(format!("Erro crypto_box (kek): {}", e))
                })?;

                let kek_nonce_b64 = general_purpose::STANDARD.encode(kek_nonce);
                let kek_ct_b64 = general_purpose::STANDARD.encode(kek_ct);

                let file_id_b64 = general_purpose::STANDARD.encode(file_id);
                let base_nonce_b64 = general_purpose::STANDARD.encode(base_nonce);

                // 8) Assinar header
                let signing_payload = build_large_header_signing_payload(
                    &sender_verkey,
                    &target_verkey,
                    &kek_nonce_b64,
                    &kek_ct_b64,
                    "chacha20poly1305",
                    chunk_sz,
                    &file_id_b64,
                    &base_nonce_b64,
                    &filename,
                    bytes_len,
                );

                let sig_bytes = sender_key_ed25519
                    .sign_message(&signing_payload, None)
                    .map_err(|e| napi::Error::from_reason(format!("Erro assinar header: {}", e)))?;
                let sig_b64 = general_purpose::STANDARD.encode(sig_bytes);

                // 9) Montar header JSON
                let header = serde_json::json!({
                  "v": 2,
                  "type": "ssi:filebox.large",
                  "sender_verkey": sender_verkey,
                  "target_verkey": target_verkey,
                  "kek": {
                    "alg": "crypto_box_x25519",
                    "nonce_b64": kek_nonce_b64,
                    "ciphertext_b64": kek_ct_b64
                  },
                  "aead": {
                    "alg": "chacha20poly1305",
                    "chunk_size": chunk_sz,
                    "file_id_b64": file_id_b64,
                    "base_nonce_b64": base_nonce_b64
                  },
                  "meta": {
                    "filename": filename,
                    "bytes": bytes_len
                  },
                  "sig": {
                    "alg": "ed25519",
                    "signer_verkey": sender_verkey_str,
                    "value": sig_b64
                  }
                });

                let header_str = serde_json::to_string(&header).map_err(|e| {
                    napi::Error::from_reason(format!("Erro serializando header: {}", e))
                })?;
                let header_bytes = header_str.as_bytes();
                let header_len_u32: u32 = header_bytes
                    .len()
                    .try_into()
                    .map_err(|_| napi::Error::from_reason("Header grande demais"))?;

                // 10) Abrir arquivos (streaming)
                let mut fin = fs::File::open(&in_path)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro abrindo input: {}", e)))?;

                // escrever em tmp e renomear no fim (atomicidade)
                let tmp_out = format!("{}.tmp.{}", out_path, std::process::id());
                let mut fout = fs::File::create(&tmp_out)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro criando output: {}", e)))?;

                // 11) Escrever container header
                fout.write_all(SSIFILE2_MAGIC)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro write magic: {}", e)))?;
                fout.write_all(&u32_le(header_len_u32)).await.map_err(|e| {
                    napi::Error::from_reason(format!("Erro write header_len: {}", e))
                })?;
                fout.write_all(header_bytes)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro write header: {}", e)))?;

                // 12) AEAD streaming
                let aead = ChaCha20Poly1305::new(Key::from_slice(&k_bytes));

                let mut buf = vec![0u8; chunk_sz as usize];
                let mut idx: u32 = 0;

                loop {
                    let nread = fin.read(&mut buf).await.map_err(|e| {
                        napi::Error::from_reason(format!("Erro lendo input: {}", e))
                    })?;
                    if nread == 0 {
                        break;
                    }

                    let mut chunk = buf[..nread].to_vec();
                    let nonce12 = derive_nonce_12(&base_nonce, idx);
                    let nonce = Nonce::from_slice(&nonce12);

                    // cifra in-place e obtém tag
                    let tag = aead
                        .encrypt_in_place_detached(nonce, b"", &mut chunk)
                        .map_err(|_| napi::Error::from_reason("AEAD encrypt failed"))?;

                    // escrever chunk: idx, plain_len, ciphertext, tag
                    fout.write_all(&u32_le(idx))
                        .await
                        .map_err(|e| napi::Error::from_reason(format!("Erro write idx: {}", e)))?;
                    fout.write_all(&u32_le(nread as u32))
                        .await
                        .map_err(|e| napi::Error::from_reason(format!("Erro write len: {}", e)))?;
                    fout.write_all(&chunk)
                        .await
                        .map_err(|e| napi::Error::from_reason(format!("Erro write ct: {}", e)))?;
                    fout.write_all(tag.as_slice())
                        .await
                        .map_err(|e| napi::Error::from_reason(format!("Erro write tag: {}", e)))?;

                    idx = idx.wrapping_add(1);
                }

                fout.flush()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro flush: {}", e)))?;
                drop(fout);

                fs::rename(&tmp_out, &out_path)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro rename output: {}", e)))?;

                let resp = serde_json::json!({
                  "ok": true,
                  "out_path": out_path,
                  "meta": header["meta"],
                  "chunks": idx,
                  "chunk_size": chunk_sz,
                  "format": "SSIFILE2"
                });

                Ok(resp.to_string())
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    #[napi]
    pub fn decrypt_file_large(
        &self,
        env: Env,
        receiver_did: String,
        sender_verkey: String,
        in_path: String,
        out_path: String,
    ) -> Result<JsObject> {
        use aries_askar::crypto::alg::KeyAlg;
        use aries_askar::kms::{crypto_box_open, LocalKey};
        use base64::{engine::general_purpose, Engine as _};
        use tokio::fs;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        use chacha20poly1305::aead::{AeadInPlace, KeyInit};
        use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};

        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        env.execute_tokio_future(
            async move {
                // 1) Abrir input (container)
                let mut fin = fs::File::open(&in_path)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro abrindo pacote: {}", e)))?;

                // 2) Ler magic + header_len + header
                let mut magic = [0u8; 8];
                fin.read_exact(&mut magic)
                    .await
                    .map_err(|_| napi::Error::from_reason("Pacote inválido (magic)"))?;
                if &magic != SSIFILE2_MAGIC {
                    return Err(napi::Error::from_reason(
                        "Pacote inválido (MAGIC diferente)",
                    ));
                }

                let mut hl = [0u8; 4];
                fin.read_exact(&mut hl)
                    .await
                    .map_err(|_| napi::Error::from_reason("Pacote inválido (header_len)"))?;
                let header_len = u32::from_le_bytes(hl) as usize;

                let mut header_bytes = vec![0u8; header_len];
                fin.read_exact(&mut header_bytes)
                    .await
                    .map_err(|_| napi::Error::from_reason("Pacote inválido (header)"))?;

                let header_str = String::from_utf8(header_bytes)
                    .map_err(|_| napi::Error::from_reason("Header não é UTF-8 válido"))?;
                let header: serde_json::Value = serde_json::from_str(&header_str)
                    .map_err(|_| napi::Error::from_reason("Header JSON inválido"))?;

                // 3) Validar campos básicos + coerência
                let v = header.get("v").and_then(|x| x.as_u64()).unwrap_or(1);
                if v < 2 {
                    return Err(napi::Error::from_reason("decrypt_file_large espera v2"));
                }

                let typ = header.get("type").and_then(|x| x.as_str()).unwrap_or("");
                if typ != "ssi:filebox.large" {
                    return Err(napi::Error::from_reason("Header type inválido"));
                }

                let hdr_sender_vk = header
                    .get("sender_verkey")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| napi::Error::from_reason("Header sender_verkey ausente"))?;
                if hdr_sender_vk != sender_verkey {
                    return Err(napi::Error::from_reason(
                        "Header sender_verkey != sender_verkey informado",
                    ));
                }

                let target_vk = header
                    .get("target_verkey")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| napi::Error::from_reason("Header target_verkey ausente"))?;

                // 4) Extrair kek + aead + meta
                let kek = header
                    .get("kek")
                    .ok_or_else(|| napi::Error::from_reason("Header kek ausente"))?;
                let kek_nonce_b64 = kek
                    .get("nonce_b64")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| napi::Error::from_reason("kek.nonce_b64 ausente"))?;
                let kek_ct_b64 = kek
                    .get("ciphertext_b64")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| napi::Error::from_reason("kek.ciphertext_b64 ausente"))?;

                let aeadj = header
                    .get("aead")
                    .ok_or_else(|| napi::Error::from_reason("Header aead ausente"))?;
                let aead_alg = aeadj
                    .get("alg")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| napi::Error::from_reason("aead.alg ausente"))?;
                if aead_alg != "chacha20poly1305" {
                    return Err(napi::Error::from_reason("aead.alg não suportado"));
                }
                let chunk_size = aeadj
                    .get("chunk_size")
                    .and_then(|x| x.as_u64())
                    .ok_or_else(|| napi::Error::from_reason("aead.chunk_size ausente"))?
                    as u32;

                let file_id_b64 = aeadj
                    .get("file_id_b64")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| napi::Error::from_reason("aead.file_id_b64 ausente"))?;
                let base_nonce_b64 = aeadj
                    .get("base_nonce_b64")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| napi::Error::from_reason("aead.base_nonce_b64 ausente"))?;

                let meta = header
                    .get("meta")
                    .ok_or_else(|| napi::Error::from_reason("Header meta ausente"))?;
                let meta_filename = meta
                    .get("filename")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| napi::Error::from_reason("meta.filename ausente"))?;
                let meta_bytes = meta
                    .get("bytes")
                    .and_then(|x| x.as_u64())
                    .ok_or_else(|| napi::Error::from_reason("meta.bytes ausente"))?;

                // 5) Validar assinatura do header
                let sig = header
                    .get("sig")
                    .ok_or_else(|| napi::Error::from_reason("Header sig ausente"))?;
                let sig_alg = sig.get("alg").and_then(|x| x.as_str()).unwrap_or("");
                if sig_alg != "ed25519" {
                    return Err(napi::Error::from_reason("sig.alg inválido"));
                }
                let signer_vk = sig
                    .get("signer_verkey")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| napi::Error::from_reason("sig.signer_verkey ausente"))?;
                if signer_vk != sender_verkey {
                    return Err(napi::Error::from_reason(
                        "sig.signer_verkey != sender_verkey",
                    ));
                }
                let sig_b64 = sig
                    .get("value")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| napi::Error::from_reason("sig.value ausente"))?;

                let signing_payload = build_large_header_signing_payload(
                    sender_verkey.as_str(),
                    target_vk,
                    kek_nonce_b64,
                    kek_ct_b64,
                    aead_alg,
                    chunk_size,
                    file_id_b64,
                    base_nonce_b64,
                    meta_filename,
                    meta_bytes,
                );
                verify_sig_ed25519(signer_vk, &signing_payload, sig_b64)?;

                // 6) Abrir sessão e resolver receiver DID -> verkey -> chave privada ed25519
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                let did_entry = session
                    .fetch("did", &receiver_did, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro DB: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("Receiver DID não achado"))?;

                let did_json: serde_json::Value = serde_json::from_slice(&did_entry.value)
                    .map_err(|_| napi::Error::from_reason("Erro parse DID JSON"))?;

                let receiver_vk = did_json["verkey"]
                    .as_str()
                    .ok_or_else(|| napi::Error::from_reason("DID sem verkey"))?;

                let receiver_key_entry = session
                    .fetch_key(receiver_vk, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch key: {}", e)))?
                    .ok_or_else(|| {
                        napi::Error::from_reason("Chave Privada Receiver não encontrada")
                    })?;

                let receiver_key_ed25519 = receiver_key_entry
                    .load_local_key()
                    .map_err(|e| napi::Error::from_reason(format!("Erro load local key: {}", e)))?;

                let receiver_exchange =
                    receiver_key_ed25519
                        .convert_key(KeyAlg::X25519)
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Falha conv receiver Ed->X: {}", e))
                        })?;

                // sender pub ed25519 -> x25519
                let sender_bytes = bs58::decode(&sender_verkey)
                    .into_vec()
                    .map_err(|_| napi::Error::from_reason("Sender Verkey inválida (Base58)"))?;
                let sender_key_ed25519 =
                    LocalKey::from_public_bytes(KeyAlg::Ed25519, &sender_bytes).map_err(|e| {
                        napi::Error::from_reason(format!("Erro load sender key: {}", e))
                    })?;
                let sender_exchange =
                    sender_key_ed25519
                        .convert_key(KeyAlg::X25519)
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Falha conv sender Ed->X: {}", e))
                        })?;

                // 7) Abrir KEK e recuperar K
                let kek_nonce = general_purpose::STANDARD
                    .decode(kek_nonce_b64)
                    .map_err(|_| napi::Error::from_reason("Bad Base64 kek.nonce"))?;
                let kek_ct = general_purpose::STANDARD
                    .decode(kek_ct_b64)
                    .map_err(|_| napi::Error::from_reason("Bad Base64 kek.ciphertext"))?;

                let kek_nonce_arr: [u8; 24] = kek_nonce
                    .as_slice()
                    .try_into()
                    .map_err(|_| napi::Error::from_reason("kek.nonce tamanho inválido"))?;

                let secret_k = crypto_box_open(
                    &receiver_exchange,
                    &sender_exchange,
                    &kek_ct,
                    &kek_nonce_arr,
                )
                .map_err(|e| napi::Error::from_reason(format!("Falha abrir KEK: {}", e)))?;

                let k_vec = secret_k.to_vec();
                let k_bytes: [u8; 32] = k_vec
                    .as_slice()
                    .try_into()
                    .map_err(|_| napi::Error::from_reason("K tamanho inválido"))?;

                let base_nonce_vec = general_purpose::STANDARD
                    .decode(base_nonce_b64)
                    .map_err(|_| napi::Error::from_reason("Bad Base64 base_nonce"))?;
                let base_nonce: [u8; 12] = base_nonce_vec
                    .as_slice()
                    .try_into()
                    .map_err(|_| napi::Error::from_reason("base_nonce tamanho inválido"))?;

                // 8) Preparar output (.tmp) e streaming de chunks
                let tmp_out = format!("{}.tmp.{}", out_path, std::process::id());
                let mut fout = fs::File::create(&tmp_out)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro criando output: {}", e)))?;

                let aead = ChaCha20Poly1305::new(Key::from_slice(&k_bytes));

                let mut total_written: u64 = 0;
                loop {
                    // ler idx (4). Se EOF, terminou.
                    let mut idxb = [0u8; 4];
                    match fin.read_exact(&mut idxb).await {
                        Ok(_) => {}
                        Err(_) => break, // EOF normal
                    }
                    let idx = u32::from_le_bytes(idxb);

                    let mut lb = [0u8; 4];
                    fin.read_exact(&mut lb)
                        .await
                        .map_err(|_| napi::Error::from_reason("Pacote truncado (len)"))?;
                    let plain_len = u32::from_le_bytes(lb) as usize;

                    // ciphertext = plain_len
                    let mut ct = vec![0u8; plain_len];
                    fin.read_exact(&mut ct)
                        .await
                        .map_err(|_| napi::Error::from_reason("Pacote truncado (ciphertext)"))?;

                    // tag 16
                    let mut tag = [0u8; 16];
                    fin.read_exact(&mut tag)
                        .await
                        .map_err(|_| napi::Error::from_reason("Pacote truncado (tag)"))?;

                    let nonce12 = derive_nonce_12(&base_nonce, idx);
                    let nonce = Nonce::from_slice(&nonce12);

                    // decrypt in-place
                    use chacha20poly1305::Tag;
                    let tag = Tag::from_slice(&tag);

                    aead.decrypt_in_place_detached(nonce, b"", &mut ct, tag)
                        .map_err(|_| napi::Error::from_reason("AEAD decrypt failed (chunk)"))?;

                    fout.write_all(&ct).await.map_err(|e| {
                        napi::Error::from_reason(format!("Erro write output: {}", e))
                    })?;

                    total_written += ct.len() as u64;
                }

                fout.flush()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro flush output: {}", e)))?;
                drop(fout);

                // valida tamanho final (opcional, mas bom)
                if total_written != meta_bytes {
                    let _ = fs::remove_file(&tmp_out).await;
                    return Err(napi::Error::from_reason(format!(
                        "Tamanho final divergente (written={} esperado={})",
                        total_written, meta_bytes
                    )));
                }

                fs::rename(&tmp_out, &out_path)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro rename output: {}", e)))?;

                let resp = serde_json::json!({
                  "ok": true,
                  "out_path": out_path,
                  "meta": header["meta"],
                  "chunk_size": chunk_size,
                  "format": "SSIFILE2"
                });

                Ok(resp.to_string())
            },
            |&mut env, data| env.create_string(&data),
        )
    }
}
