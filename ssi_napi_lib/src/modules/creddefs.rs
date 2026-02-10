// src/modules/creddefs.rs
use crate::modules::common::{send_request_async};
use crate::IndyAgent;
use aries_askar::entry::EntryTag;
use napi::{Env, Error, JsObject, Result};
use napi_derive::napi;
use std::time::{SystemTime, UNIX_EPOCH};

// Imports de dados do Anoncreds
// use anoncreds::data_types::issuer_id::IssuerId;
// use anoncreds::data_types::schema::{AttributeNames, Schema, SchemaId as AnonSchemaId};
// use anoncreds::issuer::create_credential_definition;
// use anoncreds::types::{CredentialDefinitionConfig, SignatureType};

// Imports do Indy VDR para Ledger
use indy_vdr::config::PoolConfig;
// use indy_vdr::ledger::requests::cred_def::{
//     CredentialDefinition as VdrCredDefEnum, CredentialDefinitionV1 as VdrCredDefStruct,
// };
use indy_vdr::ledger::RequestBuilder;
use indy_vdr::pool::PoolBuilder;
use indy_vdr::pool::{PoolTransactions, ProtocolVersion};
use indy_vdr::utils::did::DidValue;

// Import de ID tipado para busca
use indy_data_types::CredentialDefinitionId;

#[napi]
impl IndyAgent {
    // =========================================================================
    //  CONSULTA DE CREDENTIAL DEFINITION (GET)
    // =========================================================================
    #[napi]
    pub fn fetch_cred_def_from_ledger(
        &self,
        env: Env,
        _genesis_path: String, // Mantido para compatibilidade, mas ignorado (usamos o pool conectado)
        cred_def_id: String,
    ) -> Result<JsObject> {
        // 1. Verificação de Conexão (Pool Compartilhado)
        let pool = match &self.pool {
            Some(p) => p.clone(), // Clone barato do Arc
            None => {
                return Err(Error::from_reason(
                    "Não conectado à rede. Execute connect_network antes.",
                ))
            }
        };

        // Opcional: Verificação da Wallet (Consistência)
        if self.store.is_none() {
            return Err(Error::from_reason("Wallet fechada!"));
        }

        env.execute_tokio_future(
            async move {
                // NÃO recriamos o pool. Usamos a conexão persistente.
                let rb = RequestBuilder::new(ProtocolVersion::Node1_4);

                // O ID da CredDef é tipado no Indy VDR
                let ledger_id = CredentialDefinitionId(cred_def_id.clone());

                let req = rb
                    .build_get_cred_def_request(None, &ledger_id)
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro build GET request: {}", e))
                    })?;

                // Envio usando o pool compartilhado
                let response_str = send_request_async(&pool, req).await?;

                let json: serde_json::Value = serde_json::from_str(&response_str)
                    .map_err(|_e| napi::Error::from_reason("Erro parse JSON resposta"))?;

                // === VALIDAÇÃO (MANTIDA) ===
                // O Ledger retorna { result: { data: { ... } } }
                let result = &json["result"];

                if result["data"].is_null() {
                    return Err(napi::Error::from_reason(format!(
                        "CredDef {} não encontrada (data is null).",
                        cred_def_id
                    )));
                }

                // Opcional: Validação extra de 'seqNo' ou campos internos se desejar,
                // mas 'data' não nulo já é um forte indicador de sucesso.

                Ok(response_str)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

        // =========================================================================
    //  11. EMISSÃO: CRIAR CRED DEF (CORRIGIDO: IMPORTS DATA_TYPES)
    // =========================================================================
    #[napi]
    pub fn create_and_register_cred_def(
        &self,
        env: Env,
        genesis_path: String,
        issuer_did: String,
        schema_id: String,
        tag: String,
    ) -> Result<JsObject> {
        // 1. IMPORTS CORRIGIDOS (SEPARADOS POR MÓDULO CORRETO)

        // A. Estruturas de Dados (Schema, ID, Atributos) -> data_types
        use anoncreds::data_types::issuer_id::IssuerId;
        use anoncreds::data_types::schema::{AttributeNames, Schema, SchemaId};

        // B. Configuração e Tipos de Assinatura -> types (conforme tentativas anteriores)
        // Se der erro aqui, mova para data_types::cred_def
        use anoncreds::types::{CredentialDefinitionConfig, SignatureType};

        use anoncreds::issuer::create_credential_definition;

        // C. VDR Imports
        use indy_vdr::ledger::requests::cred_def::{
            CredentialDefinition as VdrCredDefEnum, CredentialDefinitionV1 as VdrCredDefStruct,
        };

        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        env.execute_tokio_future(
            async move {
                // 2. Pool e Sessão
                let transactions = PoolTransactions::from_json_file(&genesis_path)
                    .map_err(|e| napi::Error::from_reason(format!("Erro genesis: {}", e)))?;
                let pool = PoolBuilder::new(PoolConfig::default(), transactions)
                    .into_runner(None)
                    .map_err(|e| napi::Error::from_reason(format!("Erro pool: {}", e)))?;
                let rb = RequestBuilder::new(ProtocolVersion::Node1_4);

                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // 3. GET_SCHEMA
                let schema_id_ledger = indy_vdr::ledger::identifiers::SchemaId(schema_id.clone());
                let get_schema_req = rb
                    .build_get_schema_request(None, &schema_id_ledger)
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro build GET_SCHEMA: {}", e))
                    })?;

                let get_schema_resp = send_request_async(&pool, get_schema_req).await?;
                let get_schema_json: serde_json::Value = serde_json::from_str(&get_schema_resp)
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro parse GET_SCHEMA: {}", e))
                    })?;

                let seq_no = get_schema_json["result"]["seqNo"].as_u64().ok_or_else(|| {
                    napi::Error::from_reason("SeqNo ausente (Schema não confirmado)")
                })?;

                // 4. ID Determinístico
                let cred_def_id = format!("{}:3:CL:{}:{}", issuer_did, seq_no, tag);

                // 5. Idempotência
                if session
                    .fetch("cred_def_private", &cred_def_id, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro verificar wallet: {}", e)))?
                    .is_some()
                {
                    return Ok(cred_def_id);
                }

                // 6. Reconstruir Schema
                let schema_data_val = &get_schema_json["result"]["data"];

                let schema_json_obj: serde_json::Value = if schema_data_val.is_string() {
                    serde_json::from_str(schema_data_val.as_str().unwrap()).map_err(|e| {
                        napi::Error::from_reason(format!("Erro parse Schema Data: {}", e))
                    })?
                } else {
                    schema_data_val.clone()
                };

                let name = schema_json_obj["name"].as_str().unwrap_or("").to_string();
                let version = schema_json_obj["version"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();

                let attr_vec: Vec<String> =
                    if let Some(arr) = schema_json_obj["attrNames"].as_array() {
                        arr.iter()
                            .map(|v| v.as_str().unwrap_or("").to_string())
                            .collect()
                    } else if let Some(arr) = schema_json_obj["attr_names"].as_array() {
                        arr.iter()
                            .map(|v| v.as_str().unwrap_or("").to_string())
                            .collect()
                    } else {
                        return Err(napi::Error::from_reason(
                            "Atributos não encontrados no Schema",
                        ));
                    };

                let schema_issuer_did = schema_id
                    .split(':')
                    .next()
                    .unwrap_or(&issuer_did)
                    .to_string();

                // CORREÇÃO: Usamos o wrapper AttributeNames(vec) importado corretamente
                let schema_obj = Schema {
                    name,
                    version,
                    attr_names: AttributeNames(attr_vec),
                    issuer_id: IssuerId::new(schema_issuer_did).map_err(|e| {
                        napi::Error::from_reason(format!("IssuerID schema inválido: {}", e))
                    })?,
                };

                // 7. Criar Cred Def (Anoncreds)
                let anon_schema_id = SchemaId::new(schema_id.clone())
                    .map_err(|e| napi::Error::from_reason(format!("SchemaID inválido: {}", e)))?;

                let anon_issuer_id = IssuerId::new(issuer_did.clone())
                    .map_err(|e| napi::Error::from_reason(format!("IssuerID inválido: {}", e)))?;

                let config = CredentialDefinitionConfig {
                    support_revocation: false,
                };

                let (cred_def_pub, cred_def_priv, key_proof) = create_credential_definition(
                    anon_schema_id,
                    &schema_obj,
                    anon_issuer_id,
                    &tag,
                    SignatureType::CL,
                    config,
                )
                .map_err(|e| {
                    napi::Error::from_reason(format!("Erro criando CredDef Maths: {}", e))
                })?;

                // 8. Salvar na Wallet
                let priv_json = serde_json::to_string(&cred_def_priv)
                    .map_err(|_| napi::Error::from_reason("Serializar priv"))?;
                let key_proof_json = serde_json::to_string(&key_proof)
                    .map_err(|_| napi::Error::from_reason("Serializar key_proof"))?;
                let pub_json = serde_json::to_string(&cred_def_pub)
                    .map_err(|_| napi::Error::from_reason("Serializar pub"))?;

                session
                    .insert(
                        "cred_def_private",
                        &cred_def_id,
                        priv_json.as_bytes(),
                        Some(&vec![EntryTag::Encrypted(
                            "key_proof".to_string(),
                            key_proof_json,
                        )]),
                        None,
                    )
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Save Private: {}", e)))?;

                session
                    .insert(
                        "cred_def",
                        &cred_def_id,
                        pub_json.as_bytes(),
                        Some(&vec![EntryTag::Encrypted(
                            "schema_id".to_string(),
                            schema_id.clone(),
                        )]),
                        None,
                    )
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Save Public: {}", e)))?;

                // 9. Publicar no VDR
                let mut cred_def_val = serde_json::to_value(&cred_def_pub)
                    .map_err(|e| napi::Error::from_reason(format!("Erro json value: {}", e)))?;

                if let Some(obj) = cred_def_val.as_object_mut() {
                    obj.insert("ver".to_string(), serde_json::json!("1.0"));
                    obj.insert("id".to_string(), serde_json::json!(cred_def_id.clone()));
                    obj.insert(
                        "schemaId".to_string(),
                        serde_json::json!(seq_no.to_string()),
                    );
                    obj.insert("type".to_string(), serde_json::json!("CL"));
                }

                let vdr_struct: VdrCredDefStruct =
                    serde_json::from_value(cred_def_val).map_err(|e| {
                        napi::Error::from_reason(format!("Erro convert VDR Struct: {}", e))
                    })?;

                let vdr_enum = VdrCredDefEnum::CredentialDefinitionV1(vdr_struct);

                let did_obj = DidValue(issuer_did.clone());
                let mut req = rb
                    .build_cred_def_request(&did_obj, vdr_enum)
                    .map_err(|e| napi::Error::from_reason(format!("Erro build req: {}", e)))?;

                // 10. TAA
                let taa_req = rb
                    .build_get_txn_author_agreement_request(None, None)
                    .map_err(|e| napi::Error::from_reason(format!("TAA req build: {}", e)))?;
                let taa_resp = send_request_async(&pool, taa_req).await?;
                let taa_val: serde_json::Value = serde_json::from_str(&taa_resp)
                    .map_err(|_| napi::Error::from_reason("TAA parse error"))?;

                if let Some(res) = taa_val.get("result") {
                    if let Some(data) = res.get("data") {
                        if !data.is_null() {
                            let text = data.get("text").and_then(|t| t.as_str());
                            let version = data.get("version").and_then(|v| v.as_str());
                            let digest = data.get("digest").and_then(|d| d.as_str());

                            if let (Some(t), Some(v)) = (text, version) {
                                let ts = SystemTime::now()
                                    .duration_since(UNIX_EPOCH)
                                    .unwrap()
                                    .as_secs();
                                let ts_midnight = (ts / 86400) * 86400;
                                let taa = rb
                                    .prepare_txn_author_agreement_acceptance_data(
                                        Some(t),
                                        Some(v),
                                        digest,
                                        "wallet_agreement",
                                        ts_midnight,
                                    )
                                    .map_err(|e| {
                                        napi::Error::from_reason(format!("TAA prep: {}", e))
                                    })?;
                                req.set_txn_author_agreement_acceptance(&taa).map_err(|e| {
                                    napi::Error::from_reason(format!("TAA set: {}", e))
                                })?;
                            }
                        }
                    }
                }

                // 11. Assinar e Enviar
                let did_entry = session
                    .fetch("did", &issuer_did, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Fetch DID: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("DID issuer não achado"))?;

                let did_json_val: serde_json::Value =
                    serde_json::from_slice(&did_entry.value).unwrap();
                let verkey = did_json_val["verkey"].as_str().unwrap();

                let key_entry = session
                    .fetch_key(verkey, false)
                    .await
                    .map_err(|_| napi::Error::from_reason("Fetch key error"))?
                    .ok_or_else(|| napi::Error::from_reason("Chave privada não achada"))?;

                let signer_key = key_entry
                    .load_local_key()
                    .map_err(|_| napi::Error::from_reason("Load key error"))?;

                let signature = signer_key
                    .sign_message(req.get_signature_input().unwrap().as_bytes(), None)
                    .map_err(|e| napi::Error::from_reason(format!("Sign error: {}", e)))?;

                req.set_signature(&signature)
                    .map_err(|e| napi::Error::from_reason(format!("Set sig error: {}", e)))?;

                let _resp = send_request_async(&pool, req).await?;

                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Commit: {}", e)))?;

                Ok(cred_def_id)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

}
