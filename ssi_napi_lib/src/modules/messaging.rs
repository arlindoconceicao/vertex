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

#[napi]
impl IndyAgent {
    // =========================================================================
    //  8. COMUNICAÇÃO SEGURA
    // =========================================================================

    // CIFRAGEM DE MENSAGEM
    #[napi]
    pub fn encrypt_message(
        &self,
        env: Env,
        sender_did: String,
        target_verkey: String,
        message: String,
    ) -> Result<JsObject> {
        // 1. IMPORTS CORRIGIDOS
        use aries_askar::crypto::alg::KeyAlg; // Removemos KeyTypes
        use aries_askar::kms::LocalKey;

        // CORREÇÃO CRÍTICA: O compilador indicou que crypto_box existe aqui:
        use aries_askar::kms::crypto_box;

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

                // 2. RESOLVER DID SENDER -> VERKEY
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

                // 3. CARREGAR CHAVE PRIVADA (SENDER)
                // Usamos a verkey como ID da chave no banco
                let sender_key_entry = session
                    .fetch_key(sender_verkey_str, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch key: {}", e)))?
                    .ok_or_else(|| {
                        napi::Error::from_reason("Chave privada Sender não encontrada")
                    })?;

                let sender_key_ed25519 = sender_key_entry
                    .load_local_key()
                    .map_err(|e| napi::Error::from_reason(format!("Erro load local key: {}", e)))?;

                // 4. CARREGAR CHAVE PÚBLICA (TARGET)
                let target_bytes = bs58::decode(&target_verkey)
                    .into_vec()
                    .map_err(|_| napi::Error::from_reason("Target Verkey inválida (Base58)"))?;

                let target_key_ed25519 =
                    LocalKey::from_public_bytes(KeyAlg::Ed25519, &target_bytes).map_err(|e| {
                        napi::Error::from_reason(format!("Erro load target key: {}", e))
                    })?;

                // 5. CONVERTER CHAVES (Ed25519 -> X25519)
                // AuthCrypt (DIDComm) usa chaves de criptografia (X25519), não assinatura (Ed25519).
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

                // 6. CIFRAR (Crypto Box)
                let mut nonce = [0u8; 24]; // Nonce estendido padrão para libsoudium/askar
                rand::thread_rng().fill_bytes(&mut nonce);

                // crypto_box(recip, sender, msg, nonce)
                let ciphertext = crypto_box(
                    &target_exchange,
                    &sender_exchange,
                    message.as_bytes(),
                    &nonce,
                )
                .map_err(|e| napi::Error::from_reason(format!("Erro crypto_box: {}", e)))?;

                // 7. PACOTE JSON (Para transporte ou teste)
                let response = serde_json::json!({
                    "ciphertext": general_purpose::STANDARD.encode(ciphertext),
                    "nonce": general_purpose::STANDARD.encode(nonce),
                    "sender_verkey": sender_verkey_str,
                    "target_verkey": target_verkey
                });

                Ok(serde_json::to_string(&response).unwrap())
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // DECIFRAGEM DE MENSAGEM
    #[napi]
    pub fn decrypt_message(
        &self,
        env: Env,
        receiver_did: String,
        sender_verkey: String,
        encrypted_json: String,
    ) -> Result<JsObject> {
        // IMPORTS LOCAIS (Para garantir que funcione independente do resto do arquivo)
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

                // 1. PARSE JSON & BASE64 DECODE
                let pkg: serde_json::Value = serde_json::from_str(&encrypted_json)
                    .map_err(|_| napi::Error::from_reason("JSON invalido"))?;

                let ciphertext_str = pkg["ciphertext"]
                    .as_str()
                    .ok_or_else(|| napi::Error::from_reason("ciphertext ausente"))?;

                let nonce_str = pkg["nonce"]
                    .as_str()
                    .ok_or_else(|| napi::Error::from_reason("nonce ausente"))?;

                let ciphertext = general_purpose::STANDARD
                    .decode(ciphertext_str)
                    .map_err(|_| napi::Error::from_reason("Bad Base64 Ciphertext"))?;

                let nonce_bytes = general_purpose::STANDARD
                    .decode(nonce_str)
                    .map_err(|_| napi::Error::from_reason("Bad Base64 Nonce"))?;

                // 2. RESOLVER RECEIVER
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

                // 3. CARREGAR CHAVE PRIVADA (RECEIVER)
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

                // 4. CARREGAR CHAVE PÚBLICA (SENDER)
                let sender_bytes = bs58::decode(&sender_verkey)
                    .into_vec()
                    .map_err(|_| napi::Error::from_reason("Sender Verkey inválida (Base58)"))?;

                let sender_key_ed25519 =
                    LocalKey::from_public_bytes(KeyAlg::Ed25519, &sender_bytes).map_err(|e| {
                        napi::Error::from_reason(format!("Erro load sender key: {}", e))
                    })?;

                // 5. CONVERTER CHAVES (Ed25519 -> X25519)
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

                // 6. DECIFRAR
                // crypto_box_open retorna SecretBytes (memória protegida)
                let secret_bytes = crypto_box_open(
                    &receiver_exchange,
                    &sender_exchange,
                    &ciphertext,
                    &nonce_bytes,
                )
                .map_err(|e| napi::Error::from_reason(format!("Falha Decifra: {}", e)))?;

                // 7. CORREÇÃO DE TIPO (SecretBytes -> String)
                // Precisamos converter os bytes protegidos para um Vetor comum para virar String
                let plaintext = String::from_utf8(secret_bytes.to_vec()).map_err(|_| {
                    napi::Error::from_reason("Mensagem decifrada não é UTF-8 válido")
                })?;

                Ok(plaintext)
            },
            |&mut env, data| env.create_string(&data),
        )
    }
}
