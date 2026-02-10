// cargo build --release
// cp target/release/libssi_native_lib.so index.node
// node ./teste_indicio.js

// Como incluir os módulos dentro de src/modules/
mod modules {
    // Dentro da pasta modules, declare que o arquivo 'common.rs' existe
    pub mod common;
    pub mod creddefs;
    pub mod credentials; // <--- NOVO MÓDULO DE CREDENTIALS
    pub mod dids; // <--- NOVO MÓDULO DE DIDs
    pub mod messaging;
    pub mod presentations;
    pub mod schemas;
    pub mod wallets; // <--- NOVO MÓDULO DE MESSAGING
}
use crate::modules::common::*;
// use crate::modules::wallets::*;
// use crate::modules::dids::*;
// use crate::modules::schemas::*;

// use once_cell::sync::Lazy;
// use std::sync::{Arc, Mutex}; // <--- Adicione Arc aqui
use std::sync::Arc; // <--- Adicione Arc aqui

// MUDANÇA: Agora o cache guarda um Arc<LinkSecret>, não o LinkSecret direto.
// static LINK_SECRET_CACHE: Lazy<Mutex<Option<Arc<LinkSecret>>>> = Lazy::new(|| Mutex::new(None));

// =============================================================================
// IMPORTS CORRIGIDOS (ANONCREDS & INDY-DATA-TYPES)
// =============================================================================
// Usamos 'types' em vez de 'data_types' para a versão 0.4.0
// Imports do Anoncreds
// use anoncreds::data_types::issuer_id::IssuerId;
// use anoncreds::data_types::schema::{AttributeNames, Schema};
// use anoncreds::data_types::schema::Schema;
// Renomeamos para evitar conflito com o SchemaId do VDR
// use anoncreds::data_types::schema::SchemaId as AnonSchemaId;
// use anoncreds::issuer::create_credential_definition;
// use anoncreds::types::{CredentialDefinitionConfig, CredentialKeyCorrectnessProof, SignatureType};

// use anoncreds::types::CredentialKeyCorrectnessProof;

// use anoncreds::data_types::schema::SchemaId as AnonSchemaId; // Correção aqui!

// use indy_data_types::SchemaId as LedgerSchemaId;
use std::time::{SystemTime, UNIX_EPOCH};

use aries_askar::Store;
// use aries_askar::{
//     entry::{EntryTag, TagFilter},
//     kms::{KeyAlg, LocalKey},
//     PassKey, Store, StoreKeyMethod,
// };

// use bs58;
// use napi::bindgen_prelude::*;
use napi_derive::napi;
// use serde::{Deserialize, Serialize};
// use serde_json::json;
// use sha2::{Digest, Sha256};
// use std::time::{SystemTime, UNIX_EPOCH};

// IMPORTS DE REDE
use indy_vdr::pool::PoolRunner; // Precisamos disso para o tipo do campo 'pool'
mod ledger; // <--- AQUI DECLARAMOS O NOVO MÓDULO
            // use napi::bindgen_prelude::*; // Importante para o execute_tokio_future
use napi::{Env, JsObject, Result}; // Adicione estes imports no topo

// =============================================================================
// 1. IMPORTS DO INDY VDR (CORRIGIDO)
// =============================================================================
// use indy_vdr::config::PoolConfig;
// use indy_vdr::ledger::constants::UpdateRole;
use indy_vdr::ledger::RequestBuilder;
// use indy_vdr::pool::{PoolBuilder, PoolTransactions, ProtocolVersion};
use indy_vdr::pool::ProtocolVersion;
use indy_vdr::utils::did::DidValue;

// use indy_data_types::CredentialDefinitionId;

// Adicionar aos imports do anoncreds::types para oferecer credencial
// Adicionar aos imports do anoncreds::data_types::cred_def
// use anoncreds::data_types::cred_def::CredentialDefinitionId as AnonCredDefId; // <--- NOVO
// use anoncreds::types::LinkSecret;

// use anoncreds::prover::create_credential_request;

// Adicione process_credential aqui
// use anoncreds::prover::process_credential;

// Certifique-se que Credential está na lista de types
// use anoncreds::types::{
//     Credential, // <--- VERIFIQUE SE ESTÁ AQUI
// };

// use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

// =============================================================================
// IMPORTS CORRIGIDOS (Evita conflito com indy-data-types)
// =============================================================================
// use anoncreds::issuer::create_credential;

// IMPORTANTE: Importamos explicitamente destes caminhos para garantir que
// são os tipos que a função create_credential_request aceita.
// use anoncreds::data_types::cred_def::CredentialDefinition;
// use anoncreds::data_types::cred_offer::CredentialOffer;

// use anoncreds::types::{
//     AttributeValues, CredentialDefinitionPrivate, CredentialRequest, CredentialRequestMetadata,
//     CredentialValues,
// };

// use std::collections::HashMap; // <--- ADICIONAR

// use anoncreds::prover::create_presentation;
// use anoncreds::types::{Presentation, PresentationRequest};
// use anoncreds::verifier::verify_presentation;

// use anoncreds::types::{
//     PresentCredentials, // <--- SUBSTIUIR RequestedCredentials por ISSO
// };

// Imports Corrigidos
// use aries_askar::kms::{crypto_box, crypto_box_open}; // KMS tem as funções!
// use rand::RngCore; // Para gerar o nonce via rand

// KdfMethod is used via aries_askar::kms::KdfMethod below
use napi::Error;
// use sha3::Sha3_256;

// Wallet/KDF + backup
// use aes_gcm::{aead::Aead, aead::KeyInit, Aes256Gcm};
// use argon2::{Algorithm, Argon2, Params, Version};
// // use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
// use base64::engine::general_purpose::STANDARD as B64;
// use rand::rngs::OsRng;
// use rand::RngCore;
// use std::fs;
// use std::path::Path;

// Imports do Askar & Criptografia
// use aries_askar::crypto::encrypt; // <--- NECESSÁRIO para encrypt::crypto_box
// use indy_vdr::pool::PreparedRequest;
// use indy_vdr::pool::RequestResult;

// use base64::engine::general_purpose;
// use base64::Engine;
// use std::time::Instant;
// use tokio::time::{sleep, Duration};

//========================================================================================
#[napi]
pub struct IndyAgent {
    // Mantemos o Store (o "banco de dados" em si), pois ele é thread-safe.
    store: Option<Store>,

    // REMOVIDO: session: Option<Session>
    // MOTIVO: Sessões devem ser efêmeras (abrir, usar, commitar, fechar)
    // para garantir atomicidade e evitar travamento do SQLite (Database Locked).

    // ALTERADO: de Box<PoolRunner> para Arc<PoolRunner>
    // MOTIVO: Arc permite clonar a referência do pool para dentro das futures
    // do Tokio de forma barata e thread-safe.
    pool: Option<Arc<PoolRunner>>,

    connection_uri: String,
}

fn classify_genesis_error_code(msg: &str) -> &'static str {
    let m = msg.to_lowercase();

    // 1) Formato inválido / parse inválido (tem prioridade sobre "path")
    if m.contains("error parsing genesis transactions")
        || m.contains("parse")
        || m.contains("expected value")
        || m.contains("invalid")
        || m.contains("expected")
    {
        return "InvalidGenesisFormat";
    }

    // 2) Arquivo ausente / não abre
    if m.contains("can't open genesis transactions file")
        || m.contains("no such file or directory")
        || m.contains("os error 2")
        || m.contains("erro lendo genesis")
        || m.contains("can't open")
    {
        return "InvalidGenesisPath";
    }

    // 3) Falha genérica de pool / conexão
    "PoolConnectFailed"
}

// =============================================================================
// 2. IMPLEMENTAÇÃO DO INDY AGENT
#[napi]
impl IndyAgent {
    #[napi(constructor)]
    pub fn new() -> Self {
        // Inicializa o logger para ver output no terminal (útil para debug)
        let _ = env_logger::try_init();

        IndyAgent {
            store: None,
            // session: None, // <--- CAMPO REMOVIDO
            pool: None,
            connection_uri: String::new(),
        }
    }

    // =========================================================================
    //  MÉTODOS DE REDE (Delegados para ledger.rs)
    // =========================================================================

    #[napi]
    pub async unsafe fn connect_network(&mut self, genesis_path: String) -> Result<String> {
        if genesis_path.trim().is_empty() {
            return Err(napi_err("GenesisPathInvalid", "genesis_path vazio"));
        }

        // Política do projeto: conexão com ledger ocorre com wallet aberta,
        // pois operações posteriores (AnonCreds) dependem do store.
        if self.store.is_none() {
            return Err(napi_err(
                "WalletNotOpen",
                "Wallet não está aberta. Execute walletOpen antes de connectNetwork.",
            ));
        }

        // ledger::connect_pool retorna Box<PoolRunner>
        let runner_box = ledger::connect_pool(&genesis_path).map_err(|e| {
            let emsg = e.to_string();
            let code = classify_genesis_error_code(&emsg);
            napi_err(code, emsg)
        })?;

        // Converter Box (único dono) para Arc (compartilhado)
        let runner_arc = std::sync::Arc::from(runner_box);

        self.pool = Some(runner_arc);
        Ok("Conectado à rede Indy com sucesso!".to_string())
    }

    /// Healthcheck leve do pool/ledger (read-only).
    /// Retorna true se conseguimos executar uma consulta pública simples.
    #[napi]
    pub async unsafe fn network_healthcheck(&self) -> Result<bool> {
        let pool = match &self.pool {
            Some(p) => p.clone(),
            None => {
                return Err(napi_err(
                    "PoolNotConnected",
                    "Pool não conectado. Execute connectNetwork antes.",
                ))
            }
        };

        let rb = indy_vdr::ledger::RequestBuilder::new(indy_vdr::pool::ProtocolVersion::Node1_4);

        let req = rb
            .build_get_txn_author_agreement_request(None, None)
            .map_err(|e| napi_err("HealthcheckBuildFailed", e.to_string()))?;

        // Se o ledger responder, consideramos ok.
        match send_request_async(&pool, req).await {
            Ok(_) => Ok(true),
            Err(e) => Err(napi_err("HealthcheckFailed", e.to_string())),
        }
    }

    // =========================================================================
    //  ESCRITA DE ATRIBUTO (ATTRIB) - OTIMIZADO
    // =========================================================================
    #[napi]
    pub fn write_attrib_on_ledger(
        &self,
        env: Env,
        _genesis_path: String, // Mantido para compatibilidade, mas ignorado
        did: String,
        key: String,
        value: String,
    ) -> Result<JsObject> {
        // 1. Validar Store
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        // 2. Validar Pool (Conexão persistente)
        let pool = match &self.pool {
            Some(p) => p.clone(),
            None => {
                return Err(Error::from_reason(
                    "Não conectado à rede. Execute connect_network antes.",
                ))
            }
        };

        env.execute_tokio_future(
            async move {
                let rb = RequestBuilder::new(ProtocolVersion::Node1_4);

                // =================================================================
                // A. TAA (Transaction Author Agreement)
                // =================================================================
                let taa_req = rb
                    .build_get_txn_author_agreement_request(None, None)
                    .map_err(|e| napi::Error::from_reason(format!("Erro TAA req: {}", e)))?;

                let taa_resp = send_request_async(&pool, taa_req).await?;
                let taa_val: serde_json::Value = serde_json::from_str(&taa_resp)
                    .map_err(|e| napi::Error::from_reason(format!("Erro JSON TAA: {}", e)))?;

                let taa_acceptance = if !taa_val["result"]["data"].is_null() {
                    let text = taa_val["result"]["data"]["text"].as_str();
                    let version = taa_val["result"]["data"]["version"].as_str();
                    let digest = taa_val["result"]["data"]["digest"].as_str();

                    // Timestamp seguro
                    let ts = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();

                    Some(
                        rb.prepare_txn_author_agreement_acceptance_data(
                            text,
                            version,
                            digest,
                            "wallet_agreement",
                            ts,
                        )
                        .map_err(|e| napi::Error::from_reason(format!("Erro TAA data: {}", e)))?,
                    )
                } else {
                    None
                };

                // =================================================================
                // B. CONSTRUÇÃO DO REQUEST
                // =================================================================
                let did_obj = DidValue(did.clone());

                // Simplificação: Usando macro json! em vez de Map manual
                // Isso cria { "chave": "valor" }
                let raw_obj = serde_json::json!({
                    key: value
                });

                let mut req = rb
                    .build_attrib_request(&did_obj, &did_obj, None, Some(&raw_obj), None)
                    .map_err(|e| napi::Error::from_reason(format!("Erro build ATTRIB: {}", e)))?;

                if let Some(taa) = taa_acceptance {
                    req.set_txn_author_agreement_acceptance(&taa)
                        .map_err(|e| napi::Error::from_reason(format!("Erro set TAA: {}", e)))?;
                }

                // =================================================================
                // C. ASSINATURA (Sessão Efêmera de Leitura)
                // =================================================================
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // 1. Busca Metadados do DID
                let did_entry = session
                    .fetch("did", &did, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch DID: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("DID não encontrado na wallet"))?;

                let did_json: serde_json::Value = serde_json::from_slice(&did_entry.value)
                    .map_err(|e| napi::Error::from_reason(format!("DID JSON corrompido: {}", e)))?;

                // .unwrap() removido -> substituição segura
                let verkey_ref = did_json["verkey"]
                    .as_str()
                    .ok_or_else(|| napi::Error::from_reason("DID sem verkey"))?;

                // 2. Carrega Chave
                let key_entry = session
                    .fetch_key(verkey_ref, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch key: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("Chave privada não encontrada"))?;

                let local_key = key_entry
                    .load_local_key()
                    .map_err(|e| napi::Error::from_reason(format!("Erro load key: {}", e)))?;

                // 3. Assina
                let signature_input = req
                    .get_signature_input()
                    .map_err(|e| napi::Error::from_reason(format!("Erro sig input: {}", e)))?;

                let signature = local_key
                    .sign_message(signature_input.as_bytes(), None)
                    .map_err(|e| napi::Error::from_reason(format!("Erro assinar: {}", e)))?;

                req.set_signature(&signature)
                    .map_err(|e| napi::Error::from_reason(format!("Erro set sig: {}", e)))?;

                // =================================================================
                // D. ENVIO
                // =================================================================
                let response = send_request_async(&pool, req).await?;

                Ok(response)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    #[napi]
    pub fn read_attrib_from_ledger(
        &self,
        env: Env,
        _genesis_path: String, // Ignorado (usamos pool conectado)
        target_did: String,
        key: String,
    ) -> Result<JsObject> {
        // 1. Validar Conexão (Pool Compartilhado)
        let pool = match &self.pool {
            Some(p) => p.clone(),
            None => {
                return Err(Error::from_reason(
                    "Não conectado à rede. Execute connect_network antes.",
                ))
            }
        };

        env.execute_tokio_future(
            async move {
                // NÃO recriamos o pool. Usamos a conexão persistente.
                let rb = RequestBuilder::new(ProtocolVersion::Node1_4);
                let target = DidValue(target_did.clone());

                let req = rb
                    .build_get_attrib_request(
                        None,
                        &target,
                        Some(key.clone()),
                        None,
                        None,
                        None,
                        None,
                    )
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro build GET_ATTRIB: {}", e))
                    })?;

                // Envio rápido
                let response_str = send_request_async(&pool, req).await?;

                let json: serde_json::Value = serde_json::from_str(&response_str).map_err(|e| {
                    napi::Error::from_reason(format!("Erro parse JSON resposta: {}", e))
                })?;

                let data_field = &json["result"]["data"];

                // === LÓGICA DE PARSING ROBUSTA (MANTIDA) ===
                let inner_json: serde_json::Value = if data_field.is_string() {
                    serde_json::from_str(data_field.as_str().unwrap_or("{}")).map_err(|e| {
                        napi::Error::from_reason(format!("Erro parse dados internos string: {}", e))
                    })?
                } else if data_field.is_object() {
                    data_field.clone()
                } else {
                    return Err(napi::Error::from_reason(format!(
                        "Atributo '{}' não encontrado (data null/invalido) para DID {}",
                        key, target_did
                    )));
                };

                if let Some(val) = inner_json.get(&key) {
                    // Se for string, retorna direto. Se for obj, converte pra string.
                    if let Some(s) = val.as_str() {
                        return Ok(s.to_string());
                    } else {
                        return Ok(val.to_string());
                    }
                }

                Err(napi::Error::from_reason(format!(
                    "Chave '{}' não encontrada no payload do atributo",
                    key
                )))
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  VERIFICAR EXISTÊNCIA DE ATRIBUTO (CHECK) - OTIMIZADO
    // =========================================================================
    #[napi]
    pub fn check_attrib_exists(
        &self,
        env: Env,
        _genesis_path: String, // Ignorado
        target_did: String,
        key: String,
    ) -> Result<JsObject> {
        // 1. Validar Conexão
        let pool = match &self.pool {
            Some(p) => p.clone(),
            None => return Err(Error::from_reason("Não conectado à rede.")),
        };

        env.execute_tokio_future(
            async move {
                let rb = RequestBuilder::new(ProtocolVersion::Node1_4);
                let target = DidValue(target_did.clone());

                let req = rb
                    .build_get_attrib_request(
                        None,
                        &target,
                        Some(key.clone()),
                        None,
                        None,
                        None,
                        None,
                    )
                    .map_err(|e| napi::Error::from_reason(format!("Erro build req: {}", e)))?;

                let response_str = send_request_async(&pool, req).await?;

                let json: serde_json::Value = serde_json::from_str(&response_str)
                    .map_err(|e| napi::Error::from_reason(format!("Erro parse JSON: {}", e)))?;

                let data_field = &json["result"]["data"];

                if data_field.is_null() {
                    return Ok(false);
                }

                // Parsing simplificado para checagem
                let inner_json: serde_json::Value = if data_field.is_string() {
                    match serde_json::from_str(data_field.as_str().unwrap_or("{}")) {
                        Ok(v) => v,
                        Err(_) => return Ok(false), // Se não é JSON válido, não tem o atributo
                    }
                } else if data_field.is_object() {
                    data_field.clone()
                } else {
                    return Ok(false);
                };

                // Verifica se a chave existe no JSON
                if inner_json.get(&key).is_some() {
                    Ok(true)
                } else {
                    Ok(false)
                }
            },
            // Converte bool do Rust -> Boolean do JS
            |&mut env, data| env.get_boolean(data),
        )
    }

}
