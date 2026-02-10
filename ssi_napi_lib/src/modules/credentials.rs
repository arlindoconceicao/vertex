// src/modules/credentials.rs
// use crate::modules::common::napi_err;
use crate::IndyAgent;
use napi::{Env, Error, JsObject, Result};
use napi_derive::napi;
// use num_bigint::BigUint;
use once_cell::sync::Lazy;
// use rand::Rng;
// use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

// Imports do Anoncreds
// use anoncreds::data_types::cred_def::{
//     CredentialDefinition, CredentialDefinitionId as AnonCredDefId, CredentialDefinitionPrivate,
// };

use anoncreds::data_types::cred_def::CredentialDefinitionId as AnonCredDefId;
use askar_storage::backend::OrderBy;

// use anoncreds::data_types::credential::Credential;
// use anoncreds::data_types::rev_reg_def::RevocationRegistryDefinition;
use anoncreds::data_types::schema::SchemaId as AnonSchemaId;
// use anoncreds::types::{
//     AttributeValues, CredentialDefinitionConfig, CredentialKeyCorrectnessProof, CredentialOffer,
//     CredentialRequest, CredentialRequestMetadata, CredentialValues, LinkSecret, SignatureType,
// };

use anoncreds::types::{CredentialKeyCorrectnessProof, LinkSecret};

// Imports do Askar
use aries_askar::entry::{EntryTag, TagFilter};

// --- GLOBAL STATE ---
// Tornamos pub(crate) para que o módulo presentations.rs possa ver, mas não o mundo externo (JS)
pub(crate) static LINK_SECRET_CACHE: Lazy<Mutex<Option<Arc<LinkSecret>>>> =
    Lazy::new(|| Mutex::new(None));

// // --- HELPER FUNCTIONS ---
// fn hash_string_to_int_str(s: &str) -> String {
//     let digest = Sha256::digest(s.as_bytes()); // 32 bytes
//     let n = BigUint::from_bytes_be(&digest); // big-endian integer
//     n.to_str_radix(10) // decimal string
// }

#[napi]
impl IndyAgent {
    // =========================================================================
    //  MÉTODOS DE EMISSÃO (ISSUER) - ATUALIZADO COM PERSISTÊNCIA
    // =========================================================================
    #[napi]
    pub fn create_credential_offer(
        &self,
        env: Env,
        cred_def_id: String,
        offer_id_local: String,
    ) -> Result<JsObject> {
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        env.execute_tokio_future(
            async move {
                // Sessão Efêmera (Correto)
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // 1. Buscar a Chave Privada (Key Proof)
                let priv_entry = session
                    .fetch("cred_def_private", &cred_def_id, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro DB: {}", e)))?
                    .ok_or_else(|| {
                        napi::Error::from_reason(format!(
                            "CredDef Private não encontrada: {}",
                            cred_def_id
                        ))
                    })?;

                // Nota: Assumimos que a key_proof foi salva na TAG durante a criação da CredDef.
                let key_proof_json = priv_entry
                    .tags
                    .iter()
                    .find(|t| t.name() == "key_proof")
                    .map(|t| t.value().to_string())
                    .ok_or_else(|| napi::Error::from_reason("Key Proof não encontrado nas tags"))?;

                let key_proof: CredentialKeyCorrectnessProof =
                    serde_json::from_str(&key_proof_json)
                        .map_err(|_e| napi::Error::from_reason("Erro parse KeyProof"))?;

                // 2. Buscar a CredDef Pública (para pegar o SchemaID)
                let pub_entry = session
                    .fetch("cred_def", &cred_def_id, false)
                    .await
                    .map_err(|_e| napi::Error::from_reason("Erro DB Public"))?
                    .ok_or_else(|| napi::Error::from_reason("CredDef Public não encontrada"))?;

                let schema_id_str = pub_entry
                    .tags
                    .iter()
                    .find(|t| t.name() == "schema_id")
                    .map(|t| t.value().to_string())
                    .ok_or_else(|| napi::Error::from_reason("Schema ID não encontrado tags"))?;

                // 3. Gerar a Oferta (Anoncreds)
                let anon_schema_id = AnonSchemaId::new(schema_id_str.clone())
                    .map_err(|_e| napi::Error::from_reason("SchemaId inválido"))?;

                let anon_cred_def_id = AnonCredDefId::new(cred_def_id.clone())
                    .map_err(|_e| napi::Error::from_reason("CredDefId inválido"))?;

                let offer = anoncreds::issuer::create_credential_offer(
                    anon_schema_id, // Passar referência se exigido
                    anon_cred_def_id,
                    &key_proof,
                )
                .map_err(|e| napi::Error::from_reason(format!("Erro criando oferta: {}", e)))?;

                let offer_json = serde_json::to_string(&offer)
                    .map_err(|_e| napi::Error::from_reason("Erro serializando oferta"))?;

                // =============================================================
                // 4. PERSISTÊNCIA COM DATA
                // =============================================================

                let now_ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default() // unwrap_or_default é mais seguro que map_err aqui
                    .as_secs()
                    .to_string();

                let tags = vec![
                    EntryTag::Encrypted("cred_def_id".to_string(), cred_def_id.clone()),
                    EntryTag::Encrypted("schema_id".to_string(), schema_id_str),
                    EntryTag::Encrypted("created_at".to_string(), now_ts),
                ];

                session
                    .insert(
                        "cred_offer",
                        &offer_id_local,
                        offer_json.as_bytes(),
                        Some(&tags),
                        None,
                    )
                    .await
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro ao salvar oferta: {}", e))
                    })?;

                // 5. CORREÇÃO CRÍTICA: COMMIT OBRIGATÓRIO
                // Sem isso, o registro não é salvo no SQLite.
                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro commit oferta: {}", e)))?;

                Ok(offer_json)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  LISTAR OFERTAS (ATUALIZADO COM TIMESTAMP)
    // =========================================================================
    #[napi]
    pub fn list_credential_offers(&self, env: Env) -> Result<JsObject> {
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

                // CORREÇÃO: Adicionado o 6º argumento 'false'
                let entries = session
                    .fetch_all(Some("cred_offer"), None, None, None, false, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch: {}", e)))?;

                // ... resto do código igual ...
                let mut results = Vec::new();
                for entry in entries {
                    let s = String::from_utf8(entry.value.to_vec()).unwrap_or_default();
                    if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&s) {
                        if let Some(obj) = val.as_object_mut() {
                            obj.insert(
                                "id_local".to_string(),
                                serde_json::Value::String(entry.name),
                            );
                            let created_at = entry
                                .tags
                                .iter()
                                .find(|t| t.name() == "created_at")
                                .map(|t| t.value().to_string())
                                .unwrap_or_else(|| "0".to_string());
                            obj.insert(
                                "created_at".to_string(),
                                serde_json::Value::String(created_at),
                            );
                        }
                        results.push(val);
                    }
                }

                let json_output = serde_json::to_string(&results)
                    .map_err(|_e| napi::Error::from_reason("Erro serializando lista"))?;

                Ok(json_output)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  DELETAR OFERTA (CORRIGIDO)
    // =========================================================================
    #[napi]
    pub fn delete_credential_offer(&self, env: Env, offer_id_local: String) -> Result<JsObject> {
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

                // 1. Remove o registro
                session
                    .remove("cred_offer", &offer_id_local)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro ao deletar: {}", e)))?;

                // 2. CORREÇÃO: COMMIT OBRIGATÓRIO
                // Sem isso, a deleção é desfeita (rollback) quando a sessão fecha.
                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro commit delete: {}", e)))?;

                Ok(true)
            },
            // Converte bool do Rust -> Boolean do JS
            |&mut env, data| env.get_boolean(data),
        )
    }

    // =========================================================================
    //  LISTAR POR INTERVALO DE DATAS (NOVO)
    // =========================================================================
    #[napi]
    pub fn list_credential_offers_range(
        &self,
        env: Env,
        from_timestamp: i64, // Inicio (Segundos)
        to_timestamp: i64,   // Fim (Segundos)
    ) -> Result<JsObject> {
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

                // 1. Busca TUDO da categoria "cred_offer"
                // (Para otimização futura: Askar suporta filtros complexos, mas filtragem
                // em memória aqui é mais segura para garantir a conversão correta da string)
                let entries = session
                    .fetch_all(Some("cred_offer"), None, None, None, false, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch: {}", e)))?;

                let mut results = Vec::new();

                for entry in entries {
                    // Extrai a tag "created_at"
                    let created_at_str = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "created_at")
                        .map(|t| t.value().to_string())
                        .unwrap_or_else(|| "0".to_string());

                    // Converte para Inteiro
                    let created_at_i64 = created_at_str.parse::<i64>().unwrap_or(0);

                    // APLICA O FILTRO DE DATA
                    if created_at_i64 >= from_timestamp && created_at_i64 <= to_timestamp {
                        let s = String::from_utf8(entry.value.to_vec()).unwrap_or_default();

                        if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&s) {
                            if let Some(obj) = val.as_object_mut() {
                                obj.insert(
                                    "id_local".to_string(),
                                    serde_json::Value::String(entry.name),
                                );
                                obj.insert(
                                    "created_at".to_string(),
                                    serde_json::Value::String(created_at_str),
                                );
                            }
                            results.push(val);
                        }
                    }
                }

                let json_output = serde_json::to_string(&results)
                    .map_err(|_e| napi::Error::from_reason("Erro serializando lista"))?;

                Ok(json_output)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  DELETAR POR INTERVALO DE DATAS (CORRIGIDO)
    // =========================================================================
    #[napi]
    // MUDANÇA AQUI: de -> Result<u32> para -> Result<JsObject>
    pub fn delete_credential_offers_range(
        &self,
        env: Env,
        from_timestamp: i64,
        to_timestamp: i64,
    ) -> Result<JsObject> {
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

                // 1. Busca todos os registros
                let entries = session
                    .fetch_all(Some("cred_offer"), None, None, None, false, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch: {}", e)))?;

                let mut deleted_count: u32 = 0; // Garantindo tipo explícito

                for entry in entries {
                    // Extrai e converte a data
                    let created_at_str = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "created_at")
                        .map(|t| t.value().to_string())
                        .unwrap_or_else(|| "0".to_string());

                    let created_at_i64 = created_at_str.parse::<i64>().unwrap_or(0);

                    // 2. Verifica se está no intervalo alvo
                    if created_at_i64 >= from_timestamp && created_at_i64 <= to_timestamp {
                        // Remove o registro específico
                        session
                            .remove("cred_offer", &entry.name)
                            .await
                            .map_err(|e| {
                                napi::Error::from_reason(format!("Erro delete loop: {}", e))
                            })?;

                        deleted_count += 1;
                    }
                }

                session.commit().await.map_err(|e| {
                    napi::Error::from_reason(format!("Erro commit delete range: {}", e))
                })?;

                Ok(deleted_count)
            },
            // A conversão interna de u32 para Number do JS continua a mesma
            |&mut env, data| env.create_uint32(data),
        )
    }

    #[napi]
    pub fn create_link_secret(&self, env: Env, link_secret_id: String) -> Result<JsObject> {
        // IMPORTS
        use anoncreds::types::LinkSecret;
        use rand::Rng; // Importante: Trait necessário para usar .gen()

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

                // 1. Verificar se já existe
                if session
                    .fetch("link_secret", &link_secret_id, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro check DB: {}", e)))?
                    .is_some()
                {
                    return Ok(link_secret_id);
                }

                // 2. Gerar Seed Manualmente (CORREÇÃO DE THREAD SAFETY)
                // O problema anterior era manter 'rng' vivo através de um .await.
                // Aqui geramos e transformamos em String na mesma linha.
                // O objeto ThreadRng é descartado imediatamente após essa linha.
                let seed_str = rand::thread_rng().gen::<u128>().to_string();

                // 3. Criar o Objeto Matemático (Isso é rápido e síncrono)
                // LinkSecret::try_from aceita uma string numérica (que é a nossa seed)
                let link_secret = LinkSecret::try_from(seed_str.as_str()).map_err(|e| {
                    napi::Error::from_reason(format!("Erro criar LS matemático: {:?}", e))
                })?;

                // 4. Atualizar Cache (Memória - Síncrono)
                {
                    let mut cache = LINK_SECRET_CACHE.lock().unwrap();
                    *cache = Some(std::sync::Arc::new(link_secret));
                }

                // 5. Salvar a SEED no Banco (Persistência - Assíncrono)
                // Agora podemos fazer .await tranquilamente, pois 'rng' já morreu lá em cima.
                session
                    .insert(
                        "link_secret",
                        &link_secret_id,
                        seed_str.as_bytes(), // Salvamos a string da seed
                        None,
                        None,
                    )
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro salvar LS: {}", e)))?;

                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro commit LS: {}", e)))?;

                Ok(link_secret_id)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    /// 2. Armazena a Oferta Recebida
    #[napi]
    // CORREÇÃO: Retorno alterado de Result<String> para Result<JsObject>
    pub fn store_received_offer(&self, env: Env, offer_json: String) -> Result<JsObject> {
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

                // Parse para extrair metadados para as Tags
                let offer: serde_json::Value = serde_json::from_str(&offer_json)
                    .map_err(|e| napi::Error::from_reason(format!("JSON inválido: {}", e)))?;

                let schema_id = offer["schema_id"].as_str().unwrap_or("").to_string();
                let cred_def_id = offer["cred_def_id"].as_str().unwrap_or("").to_string();
                let nonce = offer["nonce"].as_str().unwrap_or("").to_string();

                // ID local baseado no nonce (garante unicidade para essa oferta específica)
                let id_local = format!("received-offer-{}", nonce);

                // Timestamp
                let now_ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
                    .to_string();

                let tags = vec![
                    EntryTag::Encrypted("schema_id".to_string(), schema_id),
                    EntryTag::Encrypted("cred_def_id".to_string(), cred_def_id),
                    EntryTag::Encrypted("status".to_string(), "pending".to_string()),
                    EntryTag::Encrypted("received_at".to_string(), now_ts),
                ];

                session
                    .insert(
                        "received_offer",
                        &id_local,
                        offer_json.as_bytes(),
                        Some(&tags),
                        None,
                    )
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro salvar oferta: {}", e)))?;

                // =============================================================
                // CORREÇÃO FUNDAMENTAL: COMMIT
                // =============================================================
                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro commit oferta: {}", e)))?;

                Ok(id_local)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  SOLICITAÇÃO: CRIAR CREDENTIAL REQUEST (CORRIGIDO: ENTROPY NONE)
    // =========================================================================
    #[napi]
    pub fn create_credential_request(
        &self,
        env: Env,
        link_secret_id: String,
        prover_did: String,
        cred_def_json: String,
        offer_json: String,
    ) -> Result<JsObject> {
        use anoncreds::data_types::cred_def::CredentialDefinition;
        use anoncreds::data_types::cred_offer::CredentialOffer;
        use anoncreds::types::LinkSecret;

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

                // 1. LINK SECRET
                let link_secret = {
                    let cached_ls = { LINK_SECRET_CACHE.lock().unwrap().clone() };
                    if let Some(ls) = cached_ls {
                        ls
                    } else {
                        let entry = session
                            .fetch("link_secret", &link_secret_id, false)
                            .await
                            .map_err(|e| napi::Error::from_reason(format!("Erro DB LS: {}", e)))?
                            .ok_or_else(|| {
                                napi::Error::from_reason("Link Secret não encontrado")
                            })?;
                        let seed_str = String::from_utf8(entry.value.to_vec()).unwrap_or_default();
                        let ls_obj = LinkSecret::try_from(seed_str.as_str()).map_err(|e| {
                            napi::Error::from_reason(format!("Erro LS math: {:?}", e))
                        })?;
                        let arc_ls = std::sync::Arc::new(ls_obj);
                        {
                            *LINK_SECRET_CACHE.lock().unwrap() = Some(arc_ls.clone());
                        }
                        arc_ls
                    }
                };

                // 2. PARSE CRED DEF
                let initial_json: serde_json::Value = serde_json::from_str(&cred_def_json)
                    .map_err(|e| napi::Error::from_reason(format!("Erro JSON Input: {}", e)))?;

                let mut target_obj = &initial_json;

                if let Some(res) = initial_json.get("result") {
                    if let Some(data) = res.get("data") {
                        target_obj = data;
                    } else {
                        target_obj = res;
                    }
                }

                let parsed_inner: serde_json::Value;
                if target_obj.is_string() {
                    let s = target_obj.as_str().unwrap();
                    parsed_inner = serde_json::from_str(s).map_err(|e| {
                        napi::Error::from_reason(format!("Double Parse Error: {}", e))
                    })?;
                    target_obj = &parsed_inner;
                }

                let source = target_obj.as_object().ok_or_else(|| {
                    napi::Error::from_reason(format!("CredDef payload inválido: {:?}", target_obj))
                })?;

                // 3. RECONSTRUÇÃO COMPLETA
                let mut final_map = serde_json::Map::new();

                let cred_def_id = source
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "unknown:3:CL:0:TAG".to_string());

                final_map.insert("id".to_string(), serde_json::json!(cred_def_id));

                let derived_issuer_id = cred_def_id
                    .split(':')
                    .next()
                    .unwrap_or("unknown")
                    .to_string();
                final_map.insert("issuerId".to_string(), serde_json::json!(derived_issuer_id));

                let derived_schema_id = if let Some(seq_no) = cred_def_id.split(':').nth(3) {
                    seq_no.to_string()
                } else {
                    "1".to_string()
                };

                let schema_id_val = source
                    .get("schemaId")
                    .or_else(|| source.get("schema_id"))
                    .map(|v| v.clone())
                    .unwrap_or_else(|| serde_json::json!(derived_schema_id));

                final_map.insert("schemaId".to_string(), schema_id_val);

                final_map.insert(
                    "type".to_string(),
                    source
                        .get("type")
                        .cloned()
                        .unwrap_or(serde_json::json!("CL")),
                );
                final_map.insert(
                    "tag".to_string(),
                    source
                        .get("tag")
                        .cloned()
                        .unwrap_or(serde_json::json!("TAG_PROOF")),
                );
                final_map.insert(
                    "ver".to_string(),
                    source
                        .get("ver")
                        .cloned()
                        .unwrap_or(serde_json::json!("1.0")),
                );

                if source.contains_key("primary") && !source.contains_key("value") {
                    let mut value_map = serde_json::Map::new();
                    value_map.insert(
                        "primary".to_string(),
                        source.get("primary").unwrap().clone(),
                    );
                    if let Some(rev) = source.get("revocation") {
                        value_map.insert("revocation".to_string(), rev.clone());
                    }
                    final_map.insert("value".to_string(), serde_json::Value::Object(value_map));
                } else if let Some(v) = source.get("value") {
                    final_map.insert("value".to_string(), v.clone());
                } else {
                    return Err(napi::Error::from_reason(format!(
                        "CredDef sem chaves 'primary' ou 'value'. Dump: {:?}",
                        source
                    )));
                }

                let final_json = serde_json::Value::Object(final_map);
                let cred_def: CredentialDefinition = serde_json::from_value(final_json)
                    .map_err(|e| napi::Error::from_reason(format!("Erro Struct CredDef: {}", e)))?;

                // 5. PARSE OFFER
                let offer: CredentialOffer = serde_json::from_str(&offer_json)
                    .map_err(|e| napi::Error::from_reason(format!("Erro JSON Offer: {}", e)))?;

                // 6. CRIAR REQUEST (CORREÇÃO AQUI: entropy = None)
                let (request, metadata) = anoncreds::prover::create_credential_request(
                    None,                      // <--- CORREÇÃO: Entropy deve ser None se prover_did for fornecido
                    Some(prover_did.as_str()), // prover_did
                    &cred_def,
                    &link_secret,
                    &offer.nonce,
                    &offer,
                )
                .map_err(|e| napi::Error::from_reason(format!("Erro anoncreds lib: {}", e)))?;

                // 7. PERSISTIR METADATA
                let metadata_json = serde_json::to_string(&metadata).unwrap();
                let metadata_id = offer.nonce.to_string();
                session
                    .insert(
                        "request_metadata",
                        &metadata_id,
                        metadata_json.as_bytes(),
                        None,
                        None,
                    )
                    .await
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro salvar Metadata: {}", e))
                    })?;
                session
                    .commit()
                    .await
                    .map_err(|_e| napi::Error::from_reason("Erro commit"))?;

                Ok(serde_json::to_string(&request).unwrap())
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  4. ISSUER: EMITIR CREDENCIAL (CORRIGIDO)
    // =========================================================================
    // =========================================================================
    //  EMISSÃO: CRIAR CREDENCIAL (CORRIGIDO: MAPA INTERNO)
    // =========================================================================
    #[napi]
    pub fn create_credential(
        &self,
        env: Env,
        cred_def_id: String,
        offer_json: String,
        request_json: String,
        values_json: String,
    ) -> Result<JsObject> {
        // IMPORTS
        use anoncreds::data_types::cred_def::CredentialDefinitionId;

        // Importamos os tipos necessários
        use anoncreds::types::{
            AttributeValues, CredentialOffer, CredentialRequest, CredentialValues,
        };

        // fn hash_string_to_int_str(s: &str) -> String {
        //     use std::collections::hash_map::DefaultHasher;
        //     use std::hash::{Hash, Hasher};
        //     let mut hasher = DefaultHasher::new();
        //     s.hash(&mut hasher);
        //     hasher.finish().to_string()
        // }

        fn hash_string_to_int_str(s: &str) -> String {
            use num_bigint::BigUint;
            use sha2::{Digest, Sha256};

            let digest = Sha256::digest(s.as_bytes()); // 32 bytes
            let n = BigUint::from_bytes_be(&digest); // big-endian integer
            n.to_str_radix(10) // decimal string
        }

        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        let issuer_did = cred_def_id.split(':').next().unwrap_or("").to_string();
        if issuer_did.is_empty() {
            return Err(napi::Error::from_reason(
                "Issuer DID não derivado do CredDefID",
            ));
        }

        let wallet_store = store.clone();

        env.execute_tokio_future(
            async move {
                let mut session = wallet_store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // 1. CARREGAR ARTEFATOS
                let _cred_def_id_obj = CredentialDefinitionId::new(cred_def_id.clone())
                    .map_err(|_| napi::Error::from_reason("CredDefID invalido"))?;

                let offer: CredentialOffer = serde_json::from_str(&offer_json)
                    .map_err(|e| napi::Error::from_reason(format!("Erro Offer JSON: {}", e)))?;

                let request: CredentialRequest = serde_json::from_str(&request_json)
                    .map_err(|e| napi::Error::from_reason(format!("Erro Request JSON: {}", e)))?;

                // 2. PREPARAR VALORES
                let values_map: serde_json::Map<String, serde_json::Value> =
                    serde_json::from_str(&values_json).map_err(|e| {
                        napi::Error::from_reason(format!("Erro Values JSON: {}", e))
                    })?;

                let mut cred_values = CredentialValues::default();

                for (key, val) in values_map {
                    let raw_val = val.as_str().unwrap_or("").to_string();

                    let encoded_val =
                        if raw_val.chars().all(|c| c.is_ascii_digit()) && !raw_val.is_empty() {
                            raw_val.clone()
                        } else {
                            hash_string_to_int_str(&raw_val)
                        };

                    // CORREÇÃO: Construção manual e inserção no mapa interno (.0)
                    let attr_val = AttributeValues {
                        raw: raw_val,
                        encoded: encoded_val,
                    };

                    // Acessa o HashMap interno via .0 e insere
                    cred_values.0.insert(key, attr_val);
                }

                // 3. RECUPERAR CHAVES
                let priv_entry = session
                    .fetch("cred_def_private", &cred_def_id, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro DB Priv: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("CredDef Private não achada"))?;

                let cred_def_priv_str = String::from_utf8(priv_entry.value.to_vec()).unwrap();
                let cred_def_priv: anoncreds::data_types::cred_def::CredentialDefinitionPrivate =
                    serde_json::from_str(&cred_def_priv_str)
                        .map_err(|e| napi::Error::from_reason(format!("Erro Parse Priv: {}", e)))?;

                let pub_entry = session
                    .fetch("cred_def", &cred_def_id, false)
                    .await
                    .map_err(|_e| napi::Error::from_reason("Erro DB Pub"))?
                    .ok_or_else(|| napi::Error::from_reason("CredDef Public não achada"))?;

                let cred_def_pub_str = String::from_utf8(pub_entry.value.to_vec()).unwrap();
                let cred_def_pub: anoncreds::data_types::cred_def::CredentialDefinition =
                    serde_json::from_str(&cred_def_pub_str)
                        .map_err(|e| napi::Error::from_reason(format!("Erro Parse Pub: {}", e)))?;

                // 4. CRIAR CREDENCIAL
                let credential = anoncreds::issuer::create_credential(
                    &cred_def_pub,
                    &cred_def_priv,
                    &offer,
                    &request,
                    cred_values,
                    None,
                )
                .map_err(|e| {
                    napi::Error::from_reason(format!("Erro anoncreds create_credential: {}", e))
                })?;

                // 5. SERIALIZAR E RETORNAR
                let cred_json = serde_json::to_string(&credential).unwrap();
                Ok(cred_json)
            },
            |&mut env: &mut Env, data| env.create_string(&data),
        )
    }

    //-----------------------------------------------------------
    // =========================================================================
    //  5. HOLDER: PROCESSAR E SALVAR (CORREÇÃO: COMMIT)
    // =========================================================================
    #[napi]
    pub fn store_credential(
        &self,
        env: Env,
        credential_id: String,
        credential_json: String,
        request_metadata_id: String,
        cred_def_json: String,
        rev_reg_def_json: Option<String>,
    ) -> Result<JsObject> {
        // 1. IMPORTS CORRIGIDOS (Caminhos Exatos)
        use std::convert::TryFrom;

        // Dados Estruturais ficam em data_types
        use anoncreds::data_types::cred_def::CredentialDefinition;
        use anoncreds::data_types::credential::Credential;
        use anoncreds::data_types::rev_reg_def::RevocationRegistryDefinition;

        // Metadados de Request geralmente ficam em types (serviço) ou data_types específicos.
        // Se 'anoncreds::types' falhar, tentamos importar via serde genérico,
        // mas vamos tentar o local padrão de serviço primeiro.
        use anoncreds::types::CredentialRequestMetadata;

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

                // 2. LAZY LOAD DO LINK SECRET
                let link_secret_arc = {
                    let cached_ls = {
                        let cache = LINK_SECRET_CACHE.lock().unwrap();
                        cache.clone()
                    };

                    if let Some(ls) = cached_ls {
                        ls
                    } else {
                        println!("⚠️ [RUST] Cache vazio. Buscando Link Secret no DB...");
                        let existing = session
                            .fetch("link_secret", "default", false)
                            .await
                            .map_err(|e| napi::Error::from_reason(format!("Erro DB LS: {}", e)))?;

                        let entry = existing.ok_or_else(|| {
                            napi::Error::from_reason("Link Secret não encontrado!")
                        })?;

                        let seed_str = String::from_utf8(entry.value.to_vec()).unwrap_or_default();

                        // Importante: Usar o caminho completo se o import simples falhar
                        let ls = anoncreds::types::LinkSecret::try_from(seed_str.as_str())
                            .map_err(|e| {
                                napi::Error::from_reason(format!("Erro recriar LS: {:?}", e))
                            })?;

                        let arc_ls = Arc::new(ls);
                        {
                            let mut cache = LINK_SECRET_CACHE.lock().unwrap();
                            *cache = Some(arc_ls.clone());
                        }
                        arc_ls
                    }
                };

                // 3. RECUPERAR METADATA
                let meta_entry = session
                    .fetch("request_metadata", &request_metadata_id, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch metadata: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("Request Metadata não encontrado"))?;

                let meta_str = String::from_utf8(meta_entry.value.to_vec()).unwrap_or_default();
                let cred_req_metadata: CredentialRequestMetadata = serde_json::from_str(&meta_str)
                    .map_err(|e| napi::Error::from_reason(format!("Erro parse Metadata: {}", e)))?;

                // 4. CREDENCIAL MUTÁVEL (RAW)
                // Usamos 'mut' porque process_credential altera in-place
                let mut mutable_credential: Credential = serde_json::from_str(&credential_json)
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro parse Credential JSON: {}", e))
                    })?;

                // 5. NORMALIZAÇÃO DO CRED DEF
                let mut cred_def_value: serde_json::Value = serde_json::from_str(&cred_def_json)
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro parse CredDef JSON: {}", e))
                    })?;

                if let Some(obj) = cred_def_value.as_object() {
                    if obj.contains_key("result")
                        || (obj.contains_key("data") && !obj.contains_key("value"))
                    {
                        let root = obj.get("result").unwrap_or(&cred_def_value);
                        let data = root.get("data").or(root.get("value"));

                        if let Some(d) = data {
                            cred_def_value = serde_json::json!({
                                "issuerId": root.get("origin").or(root.get("identifier")),
                                "schemaId": mutable_credential.schema_id.to_string(),
                                "tag": root.get("tag"),
                                "type": "CL",
                                "value": d
                            });
                        }
                    }
                }

                let cred_def: CredentialDefinition = serde_json::from_value(cred_def_value)
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro converter CredDef final: {}", e))
                    })?;

                // 6. REV REGISTRY
                let rev_reg_def = if let Some(json) = rev_reg_def_json {
                    if json.trim().is_empty() {
                        None
                    } else {
                        serde_json::from_str::<RevocationRegistryDefinition>(&json).ok()
                    }
                } else {
                    None
                };

                // 7. PROCESSAR (MODIFICAÇÃO IN-PLACE)
                // Passamos &mut mutable_credential
                anoncreds::prover::process_credential(
                    &mut mutable_credential,
                    &cred_req_metadata,
                    &link_secret_arc,
                    &cred_def,
                    rev_reg_def.as_ref(),
                )
                .map_err(|e| {
                    napi::Error::from_reason(format!("Erro processar credencial: {}", e))
                })?;

                // 8. SALVAR
                let processed_json = serde_json::to_string(&mutable_credential)
                    .map_err(|_| napi::Error::from_reason("Erro serializar final"))?;

                let tags = vec![
                    EntryTag::Encrypted(
                        "schema_id".to_string(),
                        mutable_credential.schema_id.to_string(),
                    ),
                    EntryTag::Encrypted(
                        "cred_def_id".to_string(),
                        mutable_credential.cred_def_id.to_string(),
                    ),
                    EntryTag::Encrypted(
                        "stored_at".to_string(),
                        SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs()
                            .to_string(),
                    ),
                ];

                session
                    .insert(
                        "credential",
                        &credential_id,
                        processed_json.as_bytes(),
                        Some(&tags),
                        None,
                    )
                    .await
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro salvar credencial: {}", e))
                    })?;

                // 9. COMMIT
                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro commit: {}", e)))?;

                Ok(credential_id)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  LISTAR CREDENCIAIS DO HOLDER (NOVO)
    //  Retorna um JSON array com metadados + um resumo de atributos (raw).
    // =========================================================================
    #[napi]
    pub fn list_credentials(&self, env: Env) -> Result<JsObject> {
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

                // Busca tudo na categoria "credential" (credenciais armazenadas pelo Holder)
                let entries = session
                    .fetch_all(Some("credential"), None, None, None, false, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch: {}", e)))?;

                let mut results = Vec::new();

                for entry in entries {
                    let s = String::from_utf8(entry.value.to_vec()).unwrap_or_default();
                    let mut obj = match serde_json::from_str::<serde_json::Value>(&s) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    // Garante objeto JSON
                    if let Some(map) = obj.as_object_mut() {
                        // id local (nome do registro no Askar)
                        map.insert(
                            "id_local".to_string(),
                            serde_json::Value::String(entry.name.clone()),
                        );

                        // tags úteis
                        let schema_id = entry
                            .tags
                            .iter()
                            .find(|t| t.name() == "schema_id")
                            .map(|t| t.value().to_string())
                            .unwrap_or_default();

                        let cred_def_id = entry
                            .tags
                            .iter()
                            .find(|t| t.name() == "cred_def_id")
                            .map(|t| t.value().to_string())
                            .unwrap_or_default();

                        let stored_at = entry
                            .tags
                            .iter()
                            .find(|t| t.name() == "stored_at")
                            .map(|t| t.value().to_string())
                            .unwrap_or_else(|| "0".to_string());

                        let alias = entry
                            .tags
                            .iter()
                            .find(|t| t.name() == "alias")
                            .map(|t| t.value().to_string());

                        if let Some(a) = alias {
                            map.insert("alias".to_string(), serde_json::Value::String(a));
                        }

                        map.insert(
                            "schema_id".to_string(),
                            serde_json::Value::String(schema_id),
                        );
                        map.insert(
                            "cred_def_id".to_string(),
                            serde_json::Value::String(cred_def_id),
                        );
                        map.insert(
                            "stored_at".to_string(),
                            serde_json::Value::String(stored_at),
                        );

                        // Resumo de atributos (apenas raw) para listagem rápida na UI
                        // Estrutura típica: credential.values.<attr>.raw
                        let mut raw_map = serde_json::Map::new();
                        if let Some(values) = map.get("values").and_then(|v| v.as_object()) {
                            for (k, v) in values {
                                if let Some(raw) = v.get("raw") {
                                    raw_map.insert(k.clone(), raw.clone());
                                }
                            }
                        }
                        map.insert("values_raw".to_string(), serde_json::Value::Object(raw_map));
                    }

                    results.push(obj);
                }

                let json_output = serde_json::to_string(&results)
                    .map_err(|_e| napi::Error::from_reason("Erro serializando lista"))?;

                Ok(json_output)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  OBTER UMA CREDENCIAL ARMAZENADA PELO ID LOCAL (NOVO)
    // =========================================================================
    #[napi]
    pub fn get_stored_credential(&self, env: Env, credential_id: String) -> Result<JsObject> {
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

                let entry = session
                    .fetch("credential", &credential_id, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch credencial: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("Credencial não encontrada"))?;

                let s = String::from_utf8(entry.value.to_vec()).unwrap_or_default();
                Ok(s)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  DELETAR CREDENCIAL ARMAZENADA (NOVO)
    //  Remove 1 credencial pelo id_local (nome do registro no Askar)
    // =========================================================================
    #[napi]
    pub fn delete_stored_credential(&self, env: Env, credential_id: String) -> Result<JsObject> {
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

                // Opcional: validar se existe (para erro mais amigável)
                let existing = session
                    .fetch("credential", &credential_id, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch: {}", e)))?;

                if existing.is_none() {
                    return Err(napi::Error::from_reason(format!(
                        "Credencial não encontrada: {}",
                        credential_id
                    )));
                }

                // Remove
                session
                    .remove("credential", &credential_id)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro ao deletar: {}", e)))?;

                // Commit obrigatório
                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro commit delete: {}", e)))?;

                Ok(true)
            },
            |&mut env, data| env.get_boolean(data),
        )
    }

    // =========================================================================
    //  EXPORTAR CREDENCIAL ARMAZENADA (NOVO)
    //  Retorna um "package" JSON com metadados + credencial completa.
    // =========================================================================
    #[napi]
    pub fn export_stored_credential(&self, env: Env, credential_id: String) -> Result<JsObject> {
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

                let entry = session
                    .fetch("credential", &credential_id, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch credencial: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("Credencial não encontrada"))?;

                let cred_str = String::from_utf8(entry.value.to_vec()).unwrap_or_default();
                let cred_val: serde_json::Value = serde_json::from_str(&cred_str)
                    .map_err(|_e| napi::Error::from_reason("Erro parse JSON credencial"))?;

                // Tags úteis (se existirem)
                let schema_id = entry
                    .tags
                    .iter()
                    .find(|t| t.name() == "schema_id")
                    .map(|t| t.value().to_string())
                    .unwrap_or_default();

                let cred_def_id = entry
                    .tags
                    .iter()
                    .find(|t| t.name() == "cred_def_id")
                    .map(|t| t.value().to_string())
                    .unwrap_or_default();

                let stored_at = entry
                    .tags
                    .iter()
                    .find(|t| t.name() == "stored_at")
                    .map(|t| t.value().to_string())
                    .unwrap_or_else(|| "0".to_string());

                // Package versionado (útil para evoluir depois)
                let pkg = serde_json::json!({
                    "type": "ssi.credential.package",
                    "version": 1,
                    "id_local": entry.name, // o nome do registro Askar
                    "schema_id": schema_id,
                    "cred_def_id": cred_def_id,
                    "stored_at": stored_at,
                    "credential": cred_val
                });

                let out = serde_json::to_string(&pkg)
                    .map_err(|_e| napi::Error::from_reason("Erro serializando package"))?;

                Ok(out)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  IMPORTAR CREDENCIAL ARMAZENADA (NOVO)
    //  Insere a credencial na categoria "credential".
    //  - overwrite=false (padrão): erro se id_local já existir
    //  - overwrite=true: substitui
    //  - new_id_local opcional: importa com novo nome local
    // Retorna o id_local final.
    // =========================================================================
    #[napi]
    pub fn import_stored_credential(
        &self,
        env: Env,
        package_json: String,
        overwrite: Option<bool>,
        new_id_local: Option<String>,
    ) -> Result<JsObject> {
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        let overwrite = overwrite.unwrap_or(false);

        env.execute_tokio_future(
            async move {
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                let pkg: serde_json::Value = serde_json::from_str(&package_json)
                    .map_err(|_e| napi::Error::from_reason("Package JSON inválido"))?;

                // id_local final
                let id_local_pkg = pkg
                    .get("id_local")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let id_local = new_id_local.unwrap_or(id_local_pkg);

                if id_local.trim().is_empty() {
                    return Err(napi::Error::from_reason(
                        "Package sem id_local (e new_id_local não foi fornecido)",
                    ));
                }

                // credencial pode vir como objeto (preferido) ou string
                let cred_val = pkg
                    .get("credential")
                    .ok_or_else(|| napi::Error::from_reason("Package sem campo 'credential'"))?;

                let cred_json = if cred_val.is_string() {
                    cred_val.as_str().unwrap_or("").to_string()
                } else {
                    serde_json::to_string(cred_val)
                        .map_err(|_e| napi::Error::from_reason("Erro serializando credential"))?
                };

                // Tags: tenta do package; se faltar, tenta do próprio JSON da credencial
                let mut schema_id = pkg
                    .get("schema_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let mut cred_def_id = pkg
                    .get("cred_def_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let mut stored_at = pkg
                    .get("stored_at")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                if schema_id.is_empty() || cred_def_id.is_empty() {
                    // tenta extrair do JSON da credencial
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&cred_json) {
                        if schema_id.is_empty() {
                            schema_id = v
                                .get("schema_id")
                                .and_then(|x| x.as_str())
                                .unwrap_or("")
                                .to_string();
                        }
                        if cred_def_id.is_empty() {
                            cred_def_id = v
                                .get("cred_def_id")
                                .and_then(|x| x.as_str())
                                .unwrap_or("")
                                .to_string();
                        }
                    }
                }

                if stored_at.is_empty() || stored_at == "0" {
                    stored_at = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs()
                        .to_string();
                }

                // Se já existe:
                let existing = session
                    .fetch("credential", &id_local, false)
                    .await
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro fetch existente: {}", e))
                    })?;

                if existing.is_some() {
                    if !overwrite {
                        return Err(napi::Error::from_reason(format!(
                            "Credencial já existe: {} (overwrite=false)",
                            id_local
                        )));
                    }

                    // overwrite=true -> remove antes de inserir
                    session.remove("credential", &id_local).await.map_err(|e| {
                        napi::Error::from_reason(format!("Erro remove overwrite: {}", e))
                    })?;
                }

                let tags = vec![
                    EntryTag::Encrypted("schema_id".to_string(), schema_id),
                    EntryTag::Encrypted("cred_def_id".to_string(), cred_def_id),
                    EntryTag::Encrypted("stored_at".to_string(), stored_at),
                ];

                session
                    .insert(
                        "credential",
                        &id_local,
                        cred_json.as_bytes(),
                        Some(&tags),
                        None,
                    )
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro insert import: {}", e)))?;

                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro commit import: {}", e)))?;

                Ok(id_local)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  LISTAR CREDENCIAIS COM FILTRO (NOVO)
    //  Filtra por tags: schema_id e/ou cred_def_id (ambos opcionais).
    //  Retorna o mesmo "shape" do list_credentials (id_local + tags + values_raw).
    // =========================================================================
    #[napi]
    pub fn list_credentials_by(
        &self,
        env: Env,
        schema_id: Option<String>,
        cred_def_id: Option<String>,
    ) -> Result<JsObject> {
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

                // Monta um filtro JSON (Askar) baseado nas tags.
                // Monta TagFilter programaticamente (compatível com aries-askar 0.4.6)
                let mut parts: Vec<TagFilter> = Vec::new();

                if let Some(sid) = schema_id.clone() {
                    parts.push(TagFilter::is_eq("schema_id", sid));
                }

                if let Some(cid) = cred_def_id.clone() {
                    parts.push(TagFilter::is_eq("cred_def_id", cid));
                }

                let tag_filter: Option<TagFilter> = match parts.len() {
                    0 => None,
                    1 => Some(parts.remove(0)),
                    _ => Some(TagFilter::all_of(parts)), // AND
                };

                let entries = session
                    .fetch_all(Some("credential"), tag_filter, None, None, false, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch: {}", e)))?;

                let mut results = Vec::new();

                for entry in entries {
                    let s = String::from_utf8(entry.value.to_vec()).unwrap_or_default();
                    let mut obj = match serde_json::from_str::<serde_json::Value>(&s) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    if let Some(map) = obj.as_object_mut() {
                        // id_local (nome do registro no Askar)
                        map.insert(
                            "id_local".to_string(),
                            serde_json::Value::String(entry.name.clone()),
                        );

                        // tags úteis
                        let schema_id_tag = entry
                            .tags
                            .iter()
                            .find(|t| t.name() == "schema_id")
                            .map(|t| t.value().to_string())
                            .unwrap_or_default();

                        let cred_def_id_tag = entry
                            .tags
                            .iter()
                            .find(|t| t.name() == "cred_def_id")
                            .map(|t| t.value().to_string())
                            .unwrap_or_default();

                        let stored_at = entry
                            .tags
                            .iter()
                            .find(|t| t.name() == "stored_at")
                            .map(|t| t.value().to_string())
                            .unwrap_or_else(|| "0".to_string());

                        let alias = entry
                            .tags
                            .iter()
                            .find(|t| t.name() == "alias")
                            .map(|t| t.value().to_string());

                        if let Some(a) = alias {
                            map.insert("alias".to_string(), serde_json::Value::String(a));
                        }

                        map.insert(
                            "schema_id".to_string(),
                            serde_json::Value::String(schema_id_tag),
                        );
                        map.insert(
                            "cred_def_id".to_string(),
                            serde_json::Value::String(cred_def_id_tag),
                        );
                        map.insert(
                            "stored_at".to_string(),
                            serde_json::Value::String(stored_at),
                        );

                        // values_raw para listagem rápida
                        let mut raw_map = serde_json::Map::new();
                        if let Some(values) = map.get("values").and_then(|v| v.as_object()) {
                            for (k, v) in values {
                                if let Some(raw) = v.get("raw") {
                                    raw_map.insert(k.clone(), raw.clone());
                                }
                            }
                        }
                        map.insert("values_raw".to_string(), serde_json::Value::Object(raw_map));
                    }

                    results.push(obj);
                }

                let json_output = serde_json::to_string(&results)
                    .map_err(|_e| napi::Error::from_reason("Erro serializando lista"))?;

                Ok(json_output)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  RESUMO DE CREDENCIAIS (NOVO)
    //  Retorna:
    //  {
    //    total: number,
    //    by_schema_id: { "<schema_id>": number, ... },
    //    by_cred_def_id: { "<cred_def_id>": number, ... }
    //  }
    // =========================================================================
    #[napi]
    pub fn get_credentials_summary(&self, env: Env) -> Result<JsObject> {
        use std::collections::HashMap;

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

                // Busca todos os registros na categoria "credential".
                // Como precisamos das tags para sumarizar, fetch_all é o caminho.
                let entries = session
                    .fetch_all(Some("credential"), None, None, None, false, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch: {}", e)))?;

                let mut total: u64 = 0;
                let mut by_schema_id: HashMap<String, u64> = HashMap::new();
                let mut by_cred_def_id: HashMap<String, u64> = HashMap::new();

                for entry in entries {
                    total += 1;

                    let schema_id = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "schema_id")
                        .map(|t| t.value().to_string())
                        .unwrap_or_else(|| "(missing)".to_string());

                    let cred_def_id = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "cred_def_id")
                        .map(|t| t.value().to_string())
                        .unwrap_or_else(|| "(missing)".to_string());

                    *by_schema_id.entry(schema_id).or_insert(0) += 1;
                    *by_cred_def_id.entry(cred_def_id).or_insert(0) += 1;
                }

                let out = serde_json::json!({
                    "total": total,
                    "by_schema_id": by_schema_id,
                    "by_cred_def_id": by_cred_def_id
                });

                let json_output = serde_json::to_string(&out)
                    .map_err(|_e| napi::Error::from_reason("Erro serializando summary"))?;

                Ok(json_output)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  SETAR ALIAS DE UMA CREDENCIAL ARMAZENADA (NOVO)
    //  Guarda o alias como tag "alias" no registro "credential".
    // =========================================================================
    #[napi]
    pub fn set_stored_credential_alias(
        &self,
        env: Env,
        credential_id: String,
        alias: String,
    ) -> Result<JsObject> {
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

                // Busca a credencial
                let entry = session
                    .fetch("credential", &credential_id, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("Credencial não encontrada"))?;

                // Recria tags preservando as existentes, substituindo/inserindo "alias"
                let mut tags: Vec<EntryTag> = Vec::new();
                let mut has_alias = false;

                for t in entry.tags.iter() {
                    if t.name() == "alias" {
                        tags.push(EntryTag::Encrypted("alias".to_string(), alias.clone()));
                        has_alias = true;
                    } else {
                        tags.push(EntryTag::Encrypted(
                            t.name().to_string(),
                            t.value().to_string(),
                        ));
                    }
                }

                if !has_alias {
                    tags.push(EntryTag::Encrypted("alias".to_string(), alias.clone()));
                }

                // Upsert do mesmo registro (remove + insert)
                session
                    .remove("credential", &credential_id)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro remove (alias): {}", e)))?;

                session
                    .insert(
                        "credential",
                        &credential_id,
                        entry.value.as_ref(),
                        Some(&tags),
                        None,
                    )
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro insert (alias): {}", e)))?;

                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro commit (alias): {}", e)))?;

                Ok(true)
            },
            |&mut env, data| env.get_boolean(data),
        )
    }

    // =========================================================================
    //  LIMPAR/REMOVER ALIAS (NOVO)
    //  Remove a tag "alias" do registro.
    // =========================================================================
    #[napi]
    pub fn clear_stored_credential_alias(
        &self,
        env: Env,
        credential_id: String,
    ) -> Result<JsObject> {
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

                let entry = session
                    .fetch("credential", &credential_id, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("Credencial não encontrada"))?;

                // Copia tags exceto "alias"
                let mut tags: Vec<EntryTag> = Vec::new();
                for t in entry.tags.iter() {
                    if t.name() == "alias" {
                        continue;
                    }
                    tags.push(EntryTag::Encrypted(
                        t.name().to_string(),
                        t.value().to_string(),
                    ));
                }

                // Upsert (remove + insert)
                session
                    .remove("credential", &credential_id)
                    .await
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro remove (clear alias): {}", e))
                    })?;

                session
                    .insert(
                        "credential",
                        &credential_id,
                        entry.value.as_ref(),
                        Some(&tags),
                        None,
                    )
                    .await
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro insert (clear alias): {}", e))
                    })?;

                session.commit().await.map_err(|e| {
                    napi::Error::from_reason(format!("Erro commit (clear alias): {}", e))
                })?;

                Ok(true)
            },
            |&mut env, data| env.get_boolean(data),
        )
    }

    // =========================================================================
    //  RENOMEAR id_local DE UMA CREDENCIAL ARMAZENADA (NOVO)
    //  Move "credential" de old_id_local -> new_id_local.
    //  - overwrite=false (padrão): erro se new_id_local já existir
    //  - overwrite=true: substitui (remove new_id_local antes)
    //  Retorna o new_id_local.
    // =========================================================================
    #[napi]
    pub fn rename_stored_credential_id(
        &self,
        env: Env,
        old_id_local: String,
        new_id_local: String,
        overwrite: Option<bool>,
    ) -> Result<JsObject> {
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        let overwrite = overwrite.unwrap_or(false);

        env.execute_tokio_future(
            async move {
                if old_id_local.trim().is_empty() || new_id_local.trim().is_empty() {
                    return Err(napi::Error::from_reason(
                        "old_id_local/new_id_local inválido(s)",
                    ));
                }
                if old_id_local == new_id_local {
                    // idempotente: nada a fazer
                    return Ok(new_id_local);
                }

                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // Fetch do antigo
                let old_entry = session
                    .fetch("credential", &old_id_local, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch old: {}", e)))?
                    .ok_or_else(|| {
                        napi::Error::from_reason("Credencial não encontrada (old_id_local)")
                    })?;

                // Se o novo já existe
                let new_exists = session
                    .fetch("credential", &new_id_local, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch new: {}", e)))?
                    .is_some();

                if new_exists && !overwrite {
                    return Err(napi::Error::from_reason(format!(
                        "new_id_local já existe: {} (overwrite=false)",
                        new_id_local
                    )));
                }

                // Se overwrite=true e new existe, remove antes
                if new_exists && overwrite {
                    session
                        .remove("credential", &new_id_local)
                        .await
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Erro remove new (overwrite): {}", e))
                        })?;
                }

                // Copiar tags do old_entry
                let mut tags: Vec<EntryTag> = Vec::new();
                for t in old_entry.tags.iter() {
                    // Mantém todas as tags exatamente
                    tags.push(EntryTag::Encrypted(
                        t.name().to_string(),
                        t.value().to_string(),
                    ));
                }

                // Remove old
                session
                    .remove("credential", &old_id_local)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro remove old: {}", e)))?;

                // Insere com novo nome, mesmo value+tags
                session
                    .insert(
                        "credential",
                        &new_id_local,
                        old_entry.value.as_ref(),
                        Some(&tags),
                        None,
                    )
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro insert new: {}", e)))?;

                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro commit rename: {}", e)))?;

                Ok(new_id_local)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  LISTAR CREDENCIAIS COM "VIEW MODE" (NOVO)
    //  mode:
    //   - "compact": {id_local, alias?, schema_id, cred_def_id, stored_at}
    //   - "full": mesmo shape do listCredentials (inclui values_raw etc.)
    // =========================================================================
    #[napi]
    pub fn list_credentials_view(&self, env: Env, mode: String) -> Result<JsObject> {
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        let mode_norm = mode.trim().to_lowercase();

        env.execute_tokio_future(
            async move {
                if mode_norm != "compact" && mode_norm != "full" {
                    return Err(napi::Error::from_reason(
                        "mode inválido. Use 'compact' ou 'full'.",
                    ));
                }

                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                let entries = session
                    .fetch_all(Some("credential"), None, None, None, false, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch: {}", e)))?;

                let mut results: Vec<serde_json::Value> = Vec::new();

                for entry in entries {
                    // Tags úteis
                    let schema_id = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "schema_id")
                        .map(|t| t.value().to_string())
                        .unwrap_or_default();

                    let cred_def_id = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "cred_def_id")
                        .map(|t| t.value().to_string())
                        .unwrap_or_default();

                    let stored_at = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "stored_at")
                        .map(|t| t.value().to_string())
                        .unwrap_or_else(|| "0".to_string());

                    let alias = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "alias")
                        .map(|t| t.value().to_string());

                    if mode_norm == "compact" {
                        // Compact: não parseia JSON da credencial
                        let mut m = serde_json::Map::new();
                        m.insert(
                            "id_local".to_string(),
                            serde_json::Value::String(entry.name.clone()),
                        );
                        m.insert(
                            "schema_id".to_string(),
                            serde_json::Value::String(schema_id),
                        );
                        m.insert(
                            "cred_def_id".to_string(),
                            serde_json::Value::String(cred_def_id),
                        );
                        m.insert(
                            "stored_at".to_string(),
                            serde_json::Value::String(stored_at),
                        );
                        if let Some(a) = alias {
                            m.insert("alias".to_string(), serde_json::Value::String(a));
                        }
                        results.push(serde_json::Value::Object(m));
                        continue;
                    }

                    // Full: parseia e injeta id_local + tags + values_raw (igual listCredentials)
                    let s = String::from_utf8(entry.value.to_vec()).unwrap_or_default();
                    let mut obj = match serde_json::from_str::<serde_json::Value>(&s) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    if let Some(map) = obj.as_object_mut() {
                        map.insert(
                            "id_local".to_string(),
                            serde_json::Value::String(entry.name.clone()),
                        );
                        map.insert(
                            "schema_id".to_string(),
                            serde_json::Value::String(schema_id),
                        );
                        map.insert(
                            "cred_def_id".to_string(),
                            serde_json::Value::String(cred_def_id),
                        );
                        map.insert(
                            "stored_at".to_string(),
                            serde_json::Value::String(stored_at),
                        );
                        if let Some(a) = alias {
                            map.insert("alias".to_string(), serde_json::Value::String(a));
                        }

                        // values_raw
                        let mut raw_map = serde_json::Map::new();
                        if let Some(values) = map.get("values").and_then(|v| v.as_object()) {
                            for (k, v) in values {
                                if let Some(raw) = v.get("raw") {
                                    raw_map.insert(k.clone(), raw.clone());
                                }
                            }
                        }
                        map.insert("values_raw".to_string(), serde_json::Value::Object(raw_map));
                    }

                    results.push(obj);
                }

                let out = serde_json::to_string(&results)
                    .map_err(|_e| napi::Error::from_reason("Erro serializando lista"))?;

                Ok(out)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  LISTAR CREDENCIAIS COM "VIEW MODE" + PAGINAÇÃO (NOVO)
    //  mode:
    //   - "compact": {id_local, alias?, schema_id, cred_def_id, stored_at}
    //   - "full": inclui values_raw (parse do JSON)
    //  limit/offset: paginação
    // =========================================================================
    #[napi]
    pub fn list_credentials_view_paged(
        &self,
        env: Env,
        mode: String,
        limit: u32,
        offset: u32,
    ) -> Result<JsObject> {
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        let mode_norm = mode.trim().to_lowercase();

        env.execute_tokio_future(
            async move {
                if mode_norm != "compact" && mode_norm != "full" {
                    return Err(napi::Error::from_reason(
                        "mode inválido. Use 'compact' ou 'full'.",
                    ));
                }

                let limit = if limit == 0 { 1 } else { limit } as usize;
                let offset = offset as usize;

                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // Busca tudo (tags + value) e pagina localmente.
                // Em "compact" não parseia JSON da credencial.
                let entries = session
                    .fetch_all(Some("credential"), None, None, None, false, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch: {}", e)))?;

                let mut results: Vec<serde_json::Value> = Vec::new();

                for entry in entries.into_iter().skip(offset).take(limit) {
                    let schema_id = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "schema_id")
                        .map(|t| t.value().to_string())
                        .unwrap_or_default();

                    let cred_def_id = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "cred_def_id")
                        .map(|t| t.value().to_string())
                        .unwrap_or_default();

                    let stored_at = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "stored_at")
                        .map(|t| t.value().to_string())
                        .unwrap_or_else(|| "0".to_string());

                    let alias = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "alias")
                        .map(|t| t.value().to_string());

                    if mode_norm == "compact" {
                        let mut m = serde_json::Map::new();
                        m.insert(
                            "id_local".to_string(),
                            serde_json::Value::String(entry.name.clone()),
                        );
                        m.insert(
                            "schema_id".to_string(),
                            serde_json::Value::String(schema_id),
                        );
                        m.insert(
                            "cred_def_id".to_string(),
                            serde_json::Value::String(cred_def_id),
                        );
                        m.insert(
                            "stored_at".to_string(),
                            serde_json::Value::String(stored_at),
                        );
                        if let Some(a) = alias {
                            m.insert("alias".to_string(), serde_json::Value::String(a));
                        }
                        results.push(serde_json::Value::Object(m));
                        continue;
                    }

                    // full
                    let s = String::from_utf8(entry.value.to_vec()).unwrap_or_default();
                    let mut obj = match serde_json::from_str::<serde_json::Value>(&s) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    if let Some(map) = obj.as_object_mut() {
                        map.insert(
                            "id_local".to_string(),
                            serde_json::Value::String(entry.name.clone()),
                        );
                        map.insert(
                            "schema_id".to_string(),
                            serde_json::Value::String(schema_id),
                        );
                        map.insert(
                            "cred_def_id".to_string(),
                            serde_json::Value::String(cred_def_id),
                        );
                        map.insert(
                            "stored_at".to_string(),
                            serde_json::Value::String(stored_at),
                        );
                        if let Some(a) = alias {
                            map.insert("alias".to_string(), serde_json::Value::String(a));
                        }

                        let mut raw_map = serde_json::Map::new();
                        if let Some(values) = map.get("values").and_then(|v| v.as_object()) {
                            for (k, v) in values {
                                if let Some(raw) = v.get("raw") {
                                    raw_map.insert(k.clone(), raw.clone());
                                }
                            }
                        }
                        map.insert("values_raw".to_string(), serde_json::Value::Object(raw_map));
                    }

                    results.push(obj);
                }

                let out = serde_json::to_string(&results)
                    .map_err(|_e| napi::Error::from_reason("Erro serializando lista"))?;

                Ok(out)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  LISTAR CREDENCIAIS COM CURSOR (NOVO)
    //  Cursor é um offset decimal em string ("0", "2", "4"...)
    //  Retorna JSON:
    //   { items: [...], next_cursor: "N" | null }
    // =========================================================================
    #[napi]
    pub fn list_credentials_view_cursor(
        &self,
        env: Env,
        mode: String,
        limit: u32,
        cursor: Option<String>,
    ) -> Result<JsObject> {
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        let mode_norm = mode.trim().to_lowercase();

        env.execute_tokio_future(
            async move {
                if mode_norm != "compact" && mode_norm != "full" {
                    return Err(napi::Error::from_reason(
                        "mode inválido. Use 'compact' ou 'full'.",
                    ));
                }

                let limit_usize = (if limit == 0 { 1 } else { limit }) as usize;

                // cursor -> offset
                let offset_usize: usize = match cursor {
                    None => 0,
                    Some(s) => {
                        let t = s.trim();
                        if t.is_empty() {
                            0
                        } else {
                            t.parse::<usize>().map_err(|_| {
                                napi::Error::from_reason(
                                    "cursor inválido (esperado string numérica)",
                                )
                            })?
                        }
                    }
                };

                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // Fetch tudo e aplica cursor/limit localmente (cursor = offset).
                let entries = session
                    .fetch_all(Some("credential"), None, None, None, false, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch: {}", e)))?;

                let total = entries.len();
                let end = std::cmp::min(offset_usize + limit_usize, total);

                let mut items: Vec<serde_json::Value> = Vec::new();

                for entry in entries.into_iter().skip(offset_usize).take(limit_usize) {
                    let schema_id = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "schema_id")
                        .map(|t| t.value().to_string())
                        .unwrap_or_default();

                    let cred_def_id = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "cred_def_id")
                        .map(|t| t.value().to_string())
                        .unwrap_or_default();

                    let stored_at = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "stored_at")
                        .map(|t| t.value().to_string())
                        .unwrap_or_else(|| "0".to_string());

                    let alias = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "alias")
                        .map(|t| t.value().to_string());

                    if mode_norm == "compact" {
                        let mut m = serde_json::Map::new();
                        m.insert(
                            "id_local".to_string(),
                            serde_json::Value::String(entry.name.clone()),
                        );
                        m.insert(
                            "schema_id".to_string(),
                            serde_json::Value::String(schema_id),
                        );
                        m.insert(
                            "cred_def_id".to_string(),
                            serde_json::Value::String(cred_def_id),
                        );
                        m.insert(
                            "stored_at".to_string(),
                            serde_json::Value::String(stored_at),
                        );
                        if let Some(a) = alias {
                            m.insert("alias".to_string(), serde_json::Value::String(a));
                        }
                        items.push(serde_json::Value::Object(m));
                        continue;
                    }

                    // full
                    let s = String::from_utf8(entry.value.to_vec()).unwrap_or_default();
                    let mut obj = match serde_json::from_str::<serde_json::Value>(&s) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    if let Some(map) = obj.as_object_mut() {
                        map.insert(
                            "id_local".to_string(),
                            serde_json::Value::String(entry.name.clone()),
                        );
                        map.insert(
                            "schema_id".to_string(),
                            serde_json::Value::String(schema_id),
                        );
                        map.insert(
                            "cred_def_id".to_string(),
                            serde_json::Value::String(cred_def_id),
                        );
                        map.insert(
                            "stored_at".to_string(),
                            serde_json::Value::String(stored_at),
                        );
                        if let Some(a) = alias {
                            map.insert("alias".to_string(), serde_json::Value::String(a));
                        }

                        let mut raw_map = serde_json::Map::new();
                        if let Some(values) = map.get("values").and_then(|v| v.as_object()) {
                            for (k, v) in values {
                                if let Some(raw) = v.get("raw") {
                                    raw_map.insert(k.clone(), raw.clone());
                                }
                            }
                        }
                        map.insert("values_raw".to_string(), serde_json::Value::Object(raw_map));
                    }

                    items.push(obj);
                }

                let next_cursor = if end < total {
                    Some((offset_usize + limit_usize).to_string())
                } else {
                    None
                };

                let out = serde_json::json!({
                    "items": items,
                    "next_cursor": next_cursor
                });

                let out_str = serde_json::to_string(&out)
                    .map_err(|_| napi::Error::from_reason("Erro serializando cursor response"))?;

                Ok(out_str)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  CURSOR ORDENADO POR id_local (NOVO)
    //  - order_by = OrderBy::Name (id_local)
    //  - cursor = último id_local da página anterior (string)
    //  Retorna:
    //   { items: [...], next_cursor: "<last_id_local>" | null }
    // =========================================================================
    #[napi]
    pub fn list_credentials_view_cursor_by_id_local(
        &self,
        env: Env,
        mode: String,
        limit: u32,
        cursor: Option<String>,
    ) -> Result<JsObject> {
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        let mode_norm = mode.trim().to_lowercase();

        env.execute_tokio_future(
            async move {
                if mode_norm != "compact" && mode_norm != "full" {
                    return Err(napi::Error::from_reason(
                        "mode inválido. Use 'compact' ou 'full'.",
                    ));
                }

                let limit_usize = (if limit == 0 { 1 } else { limit }) as usize;
                let cursor_name = cursor
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());

                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // IMPORTANT: aqui usamos OrderBy::Name pra garantir ordenação estável por id_local.
                // A assinatura do askar 0.4.6 espera OrderBy como 3º param (você já viu isso no erro).
                let include_value = mode_norm == "full";

                let entries = session
                    .fetch_all(
                        Some("credential"),
                        None,
                        None, // ✅ limit do askar (não usar aqui, vamos cortar no Rust)
                        Some(OrderBy::Id), // ✅ order_by por id_local (record id)
                        false, // descending=false
                        include_value, // ✅ só traz value se mode=="full"
                    )
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch: {}", e)))?;

                // Aplica cursor (id_local > cursor) e limit localmente
                let mut items: Vec<serde_json::Value> = Vec::new();
                let mut last_id: Option<String> = None;

                for entry in entries.into_iter() {
                    if let Some(ref c) = cursor_name {
                        if entry.name <= *c {
                            continue;
                        }
                    }

                    // Tags úteis
                    let schema_id = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "schema_id")
                        .map(|t| t.value().to_string())
                        .unwrap_or_default();

                    let cred_def_id = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "cred_def_id")
                        .map(|t| t.value().to_string())
                        .unwrap_or_default();

                    let stored_at = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "stored_at")
                        .map(|t| t.value().to_string())
                        .unwrap_or_else(|| "0".to_string());

                    let alias = entry
                        .tags
                        .iter()
                        .find(|t| t.name() == "alias")
                        .map(|t| t.value().to_string());

                    if mode_norm == "compact" {
                        let mut m = serde_json::Map::new();
                        m.insert(
                            "id_local".to_string(),
                            serde_json::Value::String(entry.name.clone()),
                        );
                        m.insert(
                            "schema_id".to_string(),
                            serde_json::Value::String(schema_id),
                        );
                        m.insert(
                            "cred_def_id".to_string(),
                            serde_json::Value::String(cred_def_id),
                        );
                        m.insert(
                            "stored_at".to_string(),
                            serde_json::Value::String(stored_at),
                        );
                        if let Some(a) = alias {
                            m.insert("alias".to_string(), serde_json::Value::String(a));
                        }
                        last_id = Some(entry.name.clone());
                        items.push(serde_json::Value::Object(m));
                    } else {
                        // full (precisa do value)
                        // Se você estiver usando include_value=false acima, troque o fetch_all include_value para true.
                        // Como seu projeto atual usa (false,false) em vários lugares, vou manter isso aqui,
                        // MAS para "full" precisamos do value: então vamos refazer o fetch do item específico.
                        let full_entry = session
                            .fetch("credential", &entry.name, false)
                            .await
                            .map_err(|e| {
                                napi::Error::from_reason(format!("Erro fetch full: {}", e))
                            })?
                            .ok_or_else(|| {
                                napi::Error::from_reason("Credencial não encontrada (full)")
                            })?;

                        let s = String::from_utf8(full_entry.value.to_vec()).unwrap_or_default();
                        let mut obj = serde_json::from_str::<serde_json::Value>(&s)
                            .map_err(|_| napi::Error::from_reason("Credencial inválida (JSON)"))?;

                        if let Some(map) = obj.as_object_mut() {
                            map.insert(
                                "id_local".to_string(),
                                serde_json::Value::String(entry.name.clone()),
                            );
                            map.insert(
                                "schema_id".to_string(),
                                serde_json::Value::String(schema_id),
                            );
                            map.insert(
                                "cred_def_id".to_string(),
                                serde_json::Value::String(cred_def_id),
                            );
                            map.insert(
                                "stored_at".to_string(),
                                serde_json::Value::String(stored_at),
                            );
                            if let Some(a) = alias {
                                map.insert("alias".to_string(), serde_json::Value::String(a));
                            }

                            let mut raw_map = serde_json::Map::new();
                            if let Some(values) = map.get("values").and_then(|v| v.as_object()) {
                                for (k, v) in values {
                                    if let Some(raw) = v.get("raw") {
                                        raw_map.insert(k.clone(), raw.clone());
                                    }
                                }
                            }
                            map.insert(
                                "values_raw".to_string(),
                                serde_json::Value::Object(raw_map),
                            );
                        }

                        last_id = Some(entry.name.clone());
                        items.push(obj);
                    }

                    if items.len() >= limit_usize {
                        break;
                    }
                }

                // Se retornou exatamente limit, pode haver mais — mas aqui não sabemos sem continuar.
                // Estratégia simples: se items.len()==limit, next_cursor = last_id; senão null.
                let next_cursor = if items.len() == limit_usize {
                    last_id
                } else {
                    None
                };

                let out = serde_json::json!({
                    "items": items,
                    "next_cursor": next_cursor
                });

                let out_str = serde_json::to_string(&out)
                    .map_err(|_| napi::Error::from_reason("Erro serializando cursor response"))?;

                Ok(out_str)
            },
            |&mut env, data| env.create_string(&data),
        )
    }
}
