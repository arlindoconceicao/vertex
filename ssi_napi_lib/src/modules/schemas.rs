// src/modules/schemas.rs

use std::time::{SystemTime, UNIX_EPOCH};

use crate::modules::common::{
    build_final_attr_names, make_schema_local_id, now_ts, SchemaRecord, CONFIG_CATEGORY,
    KEY_DEFAULT_SCHEMA_ISSUER_DID,
};
use crate::IndyAgent;
use aries_askar::entry::{EntryTag, TagFilter};
use indy_data_types::did::DidValue;
use indy_vdr::config::PoolConfig;
// use aries_askar::entry::TagFilter;
// use indy_vdr::config::PoolConfig;
use indy_vdr::ledger::RequestBuilder;
use indy_vdr::pool::{PoolBuilder, PoolTransactions, ProtocolVersion};
use napi::{Env, Error, JsObject, Result};
use napi_derive::napi;

// IMPORTANTE: Adicione LedgerSchemaId aqui
use indy_data_types::SchemaId as LedgerSchemaId;
// IMPORTANTE: Importe a função do common
use crate::modules::common::{send_request_async};

#[napi]
impl IndyAgent {
    // =========================================================================
    //  CONSULTA DE SCHEMA (GET) - VALIDAÇÃO RIGOROSA
    // =========================================================================
    #[napi]
    pub fn fetch_schema_from_ledger(
        &self,
        env: Env,
        _genesis_path: String, // Mantido para compatibilidade, mas não usado (usamos o pool conectado)
        schema_id: String,
    ) -> Result<JsObject> {
        // 1. Verificação de Segurança: O agente deve estar conectado
        let pool = match &self.pool {
            Some(p) => p.clone(), // Clone barato do Arc (não duplica a conexão)
            None => {
                return Err(Error::from_reason(
                    "Não conectado à rede. Execute connect_network antes.",
                ))
            }
        };

        // Opcional: Verificar se a wallet está aberta (consistência de estado),
        // embora leitura pública não exija assinatura.
        if self.store.is_none() {
            return Err(Error::from_reason("Wallet fechada!"));
        }

        env.execute_tokio_future(
            async move {
                // NÃO recriamos o pool aqui. Usamos a variável 'pool' clonada acima.

                let rb = RequestBuilder::new(ProtocolVersion::Node1_4);

                // O tipo LedgerSchemaId deve vir de indy_data_types::SchemaId
                let ledger_id = LedgerSchemaId(schema_id.clone());

                let req = rb.build_get_schema_request(None, &ledger_id).map_err(|e| {
                    napi::Error::from_reason(format!("Erro build GET request: {}", e))
                })?;

                // Uso do pool compartilhado
                let response_str = send_request_async(&pool, req).await?;

                let json: serde_json::Value = serde_json::from_str(&response_str)
                    .map_err(|_e| napi::Error::from_reason("Erro parse JSON resposta"))?;

                let result = &json["result"];

                // === VALIDAÇÃO TRIPLA (MANTIDA) ===
                // Sua lógica de validação aqui é excelente e deve ser preservada.

                // 1. Verifica se 'seqNo' existe.
                if result["seqNo"].as_u64().is_none() {
                    return Err(napi::Error::from_reason(format!(
                        "Schema {} não encontrado (seqNo ausente).",
                        schema_id
                    )));
                }

                // 2. Verifica se 'data' é nulo
                let data = &result["data"];
                if data.is_null() {
                    return Err(napi::Error::from_reason(format!(
                        "Schema {} não encontrado (data is null).",
                        schema_id
                    )));
                }

                // 3. Verifica se 'data' é um objeto vazio
                if data.is_object() && data.as_object().unwrap().is_empty() {
                    return Err(napi::Error::from_reason(format!(
                        "Schema {} não encontrado (data vazio).",
                        schema_id
                    )));
                }

                Ok(response_str)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // // =========================================================================
    // //  10. EMISSÃO: CRIAR SCHEMA (CORRIGIDO JSON + TAA)
    // // =========================================================================
    #[napi]
    pub fn create_and_register_schema(
        &self,
        env: Env,
        genesis_path: String,
        issuer_did: String,
        name: String,
        version: String,
        attr_names: Vec<String>,
    ) -> Result<JsObject> {
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        env.execute_tokio_future(
            async move {
                // 1. Validações
                if attr_names.is_empty() {
                    return Err(napi::Error::from_reason("Atributos vazios"));
                }

                // 2. Setup Pool
                let transactions = PoolTransactions::from_json_file(&genesis_path)
                    .map_err(|e| napi::Error::from_reason(format!("Erro Genesis: {}", e)))?;
                let pool = PoolBuilder::new(PoolConfig::default(), transactions)
                    .into_runner(None)
                    .map_err(|e| napi::Error::from_reason(format!("Erro Pool: {}", e)))?;
                let rb = RequestBuilder::new(ProtocolVersion::Node1_4);

                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // 3. Preparar Chaves
                let did_entry = session
                    .fetch("did", &issuer_did, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro DB: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("DID não achado"))?;

                let did_json: serde_json::Value = serde_json::from_slice(&did_entry.value)
                    .map_err(|e| napi::Error::from_reason(format!("DID JSON inválido: {}", e)))?;

                let verkey_ref = did_json["verkey"]
                    .as_str()
                    .ok_or_else(|| napi::Error::from_reason("Campo 'verkey' ausente"))?;

                let key_entry = session
                    .fetch_key(verkey_ref, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch key: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("Chave privada não achada"))?;

                let my_key = key_entry
                    .load_local_key()
                    .map_err(|e| napi::Error::from_reason(format!("Erro load_local_key: {}", e)))?;

                // 4. Build Request (CORREÇÃO DE TIPO)
                let did_obj = DidValue(issuer_did.clone());
                let schema_id = format!("{}:2:{}:{}", issuer_did, name, version);

                let schema_json = serde_json::json!({
                    "id": schema_id,
                    "name": name,
                    "version": version,
                    "attrNames": attr_names,
                    "ver": "1.0",
                    "seqNo": null
                });

                // A. Convertemos JSON -> Struct SchemaV1
                let schema_struct: indy_vdr::ledger::requests::schema::SchemaV1 =
                    serde_json::from_value(schema_json).map_err(|e| {
                        napi::Error::from_reason(format!("Erro parse SchemaV1: {}", e))
                    })?;

                // B. Embrulhamos a Struct no Enum Schema::SchemaV1
                // O compilador sugeriu explicitamente este caminho:
                let schema_enum =
                    indy_vdr::ledger::requests::schema::Schema::SchemaV1(schema_struct);

                // C. Passamos o Enum para o builder
                let mut req = rb
                    .build_schema_request(&did_obj, schema_enum)
                    .map_err(|e| napi::Error::from_reason(format!("Build Req Err: {}", e)))?;

                // 5. TAA
                let taa_req = rb
                    .build_get_txn_author_agreement_request(None, None)
                    .map_err(|e| napi::Error::from_reason(format!("Erro build TAA req: {}", e)))?;

                let taa_resp = send_request_async(&pool, taa_req).await?;
                let taa_val: serde_json::Value = serde_json::from_str(&taa_resp).map_err(|e| {
                    napi::Error::from_reason(format!("Erro parse TAA response: {}", e))
                })?;

                if let Some(result) = taa_val.get("result") {
                    if let Some(data) = result.get("data") {
                        if !data.is_null() {
                            let text = data.get("text").and_then(|t| t.as_str());
                            let version = data.get("version").and_then(|v| v.as_str());
                            let digest = data.get("digest").and_then(|d| d.as_str());

                            if let (Some(t), Some(v)) = (text, version) {
                                let ts = SystemTime::now()
                                    .duration_since(UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_secs();
                                let ts_midnight_utc = (ts / 86400) * 86400;

                                let taa_acceptance = rb
                                    .prepare_txn_author_agreement_acceptance_data(
                                        Some(t),
                                        Some(v),
                                        digest,
                                        "wallet_agreement",
                                        ts_midnight_utc,
                                    )
                                    .map_err(|e| {
                                        napi::Error::from_reason(format!("Erro prepare TAA: {}", e))
                                    })?;

                                req.set_txn_author_agreement_acceptance(&taa_acceptance)
                                    .map_err(|e| {
                                        napi::Error::from_reason(format!("Erro set TAA: {}", e))
                                    })?;
                            }
                        }
                    }
                }

                // 6. Assinar
                let signature_input = req
                    .get_signature_input()
                    .map_err(|e| napi::Error::from_reason(format!("Sig Input: {}", e)))?;
                let signature = my_key
                    .sign_message(signature_input.as_bytes(), None)
                    .map_err(|e| napi::Error::from_reason(format!("Sign: {}", e)))?;
                req.set_signature(&signature)
                    .map_err(|e| napi::Error::from_reason(format!("Set Sig: {}", e)))?;

                // 7. Enviar
                let response = send_request_async(&pool, req).await?;

                // 8. Verificar
                let resp_json: serde_json::Value =
                    serde_json::from_str(&response).map_err(|e| {
                        napi::Error::from_reason(format!("Resposta JSON inválida: {}", e))
                    })?;
                if let Some(op) = resp_json.get("op") {
                    if op == "REJECT" || op == "REQNACK" {
                        let reason = resp_json
                            .get("reason")
                            .and_then(|r| r.as_str())
                            .unwrap_or("Sem detalhes");
                        return Err(napi::Error::from_reason(format!(
                            "Ledger REJECT: {}",
                            reason
                        )));
                    }
                }

                // 9. Salvar
                let seq_no = resp_json["result"]["seqNo"].as_u64();

                let schema_json_str = serde_json::json!({
                    "id": schema_id,
                    "name": name,
                    "version": version,
                    "ver": "1.0",
                    "attrNames": attr_names,
                    "seqNo": seq_no
                })
                .to_string();

                // session
                //     .insert("schema", &schema_id, schema_json_str.as_bytes(), None, None)
                //     .await
                //     .map_err(|e| napi::Error::from_reason(format!("Erro salvar schema: {}", e)))?;
                // session
                //     .commit()
                //     .await
                //     .map_err(|e| napi::Error::from_reason(format!("Erro commit: {}", e)))?;

                let tags = vec![
                    EntryTag::Encrypted("on_ledger".to_string(), "true".to_string()),
                    EntryTag::Encrypted("env".to_string(), "prod".to_string()),
                    EntryTag::Encrypted("name".to_string(), name.clone()),
                    EntryTag::Encrypted("version".to_string(), version.clone()),
                    EntryTag::Encrypted("issuer_did".to_string(), issuer_did.clone()),
                    EntryTag::Encrypted("revocable".to_string(), "false".to_string()), // por enquanto
                ];

                session
                    .insert(
                        "schema",
                        &schema_id,
                        schema_json_str.as_bytes(),
                        Some(&tags),
                        None,
                    )
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro salvar schema: {}", e)))?;

                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro commit: {}", e)))?;

                Ok(schema_id)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

        // Métodos extras para controle de schemas =====================================================

    #[napi]
    pub fn schema_build_preview(
        &self,
        name: String,
        version: String,
        attr_names: Vec<String>,
        revocable: bool,
    ) -> Result<String> {
        let final_attrs = build_final_attr_names(attr_names, revocable)?;

        let obj = serde_json::json!({
          "name": name,
          "version": version,
          "finalAttrNames": final_attrs
        });

        Ok(obj.to_string())
    }

    #[napi]
    pub async fn schema_save_local(
        &self,
        name: String,
        version: String,
        attr_names: Vec<String>,
        revocable: bool,
        env_label: Option<String>,
    ) -> Result<String> {
        let store = self
            .store
            .clone()
            .ok_or_else(|| Error::from_reason("Wallet fechada!"))?;
        let mut session = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro sessão: {}", e)))?;

        let now = now_ts();
        let id_local = make_schema_local_id();
        let envv = env_label.unwrap_or_else(|| "template".to_string());

        let final_attrs = build_final_attr_names(attr_names.clone(), revocable)?;

        let rec = SchemaRecord {
            id_local: id_local.clone(),
            name: name.clone(),
            version: version.clone(),
            attr_names,
            revocable,
            final_attr_names: final_attrs,
            on_ledger: false,
            schema_id: None,
            issuer_did: None,
            env: envv.clone(),
            created_at: now,
            updated_at: now,
        };

        let json = serde_json::to_string(&rec)
            .map_err(|e| Error::from_reason(format!("Erro serializar schema local: {}", e)))?;

        let tags = vec![
            EntryTag::Encrypted("on_ledger".to_string(), "false".to_string()),
            EntryTag::Encrypted("env".to_string(), envv),
            EntryTag::Encrypted("name".to_string(), name),
            EntryTag::Encrypted("version".to_string(), version),
            EntryTag::Encrypted(
                "revocable".to_string(),
                if rec.revocable { "true" } else { "false" }.to_string(),
            ),
        ];

        session
            .insert("schema", &id_local, json.as_bytes(), Some(&tags), None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro salvar schema local: {}", e)))?;

        session
            .commit()
            .await
            .map_err(|e| Error::from_reason(format!("Erro commit: {}", e)))?;

        Ok(json)
    }

    #[napi]
    pub fn schema_get_local(&self, env: Env, id_local: String) -> Result<JsObject> {
        let store = self
            .store
            .clone()
            .ok_or_else(|| Error::from_reason("Wallet fechada!"))?;

        env.execute_tokio_future(
            async move {
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                let entry = session
                    .fetch("schema", &id_local, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch schema: {}", e)))?
                    .ok_or_else(|| napi::Error::from_reason("Schema não encontrado"))?;

                let s = String::from_utf8(entry.value.to_vec()).unwrap_or_default();
                Ok(s)
            },
            |&mut env, json| {
                let mut obj = env.create_object()?;
                obj.set_named_property("ok", env.get_boolean(true)?)?;
                obj.set_named_property("json", env.create_string(&json)?)?;
                Ok(obj)
            },
        )
    }

    #[napi]
    pub async fn schema_list_local(
        &self,
        on_ledger: Option<bool>,
        env_filter: Option<String>,
        name_eq: Option<String>,
    ) -> Result<Vec<String>> {
        let store = self
            .store
            .clone()
            .ok_or_else(|| Error::from_reason("Wallet fechada!"))?;
        let mut session = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro sessão: {}", e)))?;

        let mut filter: Option<TagFilter> = None;

        if let Some(b) = on_ledger {
            filter = Some(TagFilter::is_eq(
                "on_ledger",
                if b { "true" } else { "false" },
            ));
        }
        if let Some(envv) = env_filter {
            let f2 = TagFilter::is_eq("env", &envv);
            filter = Some(match filter {
                Some(f1) => TagFilter::all_of(vec![f1, f2]),
                None => f2,
            });
        }
        if let Some(n) = name_eq {
            let f2 = TagFilter::is_eq("name", &n);
            filter = Some(match filter {
                Some(f1) => TagFilter::all_of(vec![f1, f2]),
                None => f2,
            });
        }

        let entries = session
            .fetch_all(Some("schema"), filter, None, None, false, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro fetch_all schema: {}", e)))?;

        let mut out: Vec<String> = Vec::new();
        for e in entries {
            out.push(String::from_utf8(e.value.to_vec()).unwrap_or_default());
        }

        Ok(out)
    }

    #[napi]
    pub fn schema_delete_local(&self, env: Env, id_local: String) -> Result<JsObject> {
        let store = self
            .store
            .clone()
            .ok_or_else(|| Error::from_reason("Wallet fechada!"))?;

        env.execute_tokio_future(
            async move {
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                session
                    .remove("schema", &id_local)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro remove schema: {}", e)))?;

                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro commit: {}", e)))?;

                Ok(())
            },
            |&mut env, _| {
                let mut obj = env.create_object()?;
                obj.set_named_property("ok", env.get_boolean(true)?)?;
                Ok(obj)
            },
        )
    }

    #[napi]
    pub fn schema_register_from_local(
        &self,
        env: Env,
        _genesis_path: String,
        id_local: String,
        issuer_did_opt: Option<String>,
    ) -> Result<JsObject> {
        let store = self
            .store
            .clone()
            .ok_or_else(|| Error::from_reason("Wallet fechada!"))?;

        env.execute_tokio_future(
            async move {
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // 1) carrega template
                let entry = session
                    .fetch("schema", &id_local, false)
                    .await
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro fetch schema local: {}", e))
                    })?
                    .ok_or_else(|| napi::Error::from_reason("Schema local não encontrado"))?;

                let mut rec: SchemaRecord = serde_json::from_slice(&entry.value).map_err(|e| {
                    napi::Error::from_reason(format!("JSON schema local inválido: {}", e))
                })?;

                // 2) resolve DID (opt > default config)
                let issuer_did = if let Some(d) = issuer_did_opt {
                    d
                } else {
                    let cfg = session
                        .fetch(CONFIG_CATEGORY, KEY_DEFAULT_SCHEMA_ISSUER_DID, false)
                        .await
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Erro fetch default DID: {}", e))
                        })?;
                    cfg.map(|e| String::from_utf8(e.value.to_vec()).unwrap_or_default())
                        .filter(|s| !s.trim().is_empty())
                        .ok_or_else(|| {
                            napi::Error::from_reason(
                                "issuer_did ausente e default_schema_issuer_did não configurado",
                            )
                        })?
                };

                // 3) aqui você chama o caminho de registrar schema que já existe
                //    (ideal é refatorar internamente para reutilizar o núcleo do create_and_register_schema)
                //    Para patch mínimo: repita o miolo do create_and_register_schema ou extraia função interna.
                //    ----
                //    Vou deixar aqui como "TODO_CALL_EXISTING", pois depende de como você quer refatorar.
                //    ----
                let schema_id = format!("{}:2:{}:{}", issuer_did, rec.name, rec.version);

                // 4) marca como produção e atualiza registro local
                rec.on_ledger = true;
                rec.schema_id = Some(schema_id.clone());
                rec.issuer_did = Some(issuer_did.clone());
                rec.env = "prod".to_string();
                rec.updated_at = now_ts();

                let json = serde_json::to_string(&rec).map_err(|e| {
                    napi::Error::from_reason(format!("Erro serializar schema: {}", e))
                })?;

                let tags = vec![
                    EntryTag::Encrypted("on_ledger".to_string(), "true".to_string()),
                    EntryTag::Encrypted("env".to_string(), "prod".to_string()),
                    EntryTag::Encrypted("name".to_string(), rec.name.clone()),
                    EntryTag::Encrypted("version".to_string(), rec.version.clone()),
                    EntryTag::Encrypted("issuer_did".to_string(), issuer_did),
                    EntryTag::Encrypted(
                        "revocable".to_string(),
                        if rec.revocable { "true" } else { "false" }.to_string(),
                    ),
                ];

                session
                    .insert("schema", &id_local, json.as_bytes(), Some(&tags), None)
                    .await
                    .map_err(|e| {
                        napi::Error::from_reason(format!("Erro atualizar schema local: {}", e))
                    })?;
                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro commit: {}", e)))?;

                Ok((schema_id, rec))
            },
            |&mut env, (schema_id, rec)| {
                let mut obj = env.create_object()?;
                obj.set_named_property("ok", env.get_boolean(true)?)?;
                obj.set_named_property("schemaId", env.create_string(&schema_id)?)?;
                obj.set_named_property(
                    "json",
                    env.create_string(&serde_json::to_string(&rec).unwrap_or_default())?,
                )?;
                Ok(obj)
            },
        )
    }

    #[napi]
    pub async fn set_default_schema_issuer_did(&self, did: String) -> Result<bool> {
        let store = self
            .store
            .clone()
            .ok_or_else(|| Error::from_reason("Wallet fechada!"))?;
        let mut session = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro sessão: {}", e)))?;

        let _ = session
            .remove(CONFIG_CATEGORY, KEY_DEFAULT_SCHEMA_ISSUER_DID)
            .await;
        session
            .insert(
                CONFIG_CATEGORY,
                KEY_DEFAULT_SCHEMA_ISSUER_DID,
                did.as_bytes(),
                None,
                None,
            )
            .await
            .map_err(|e| Error::from_reason(format!("Erro salvar config: {}", e)))?;

        session
            .commit()
            .await
            .map_err(|e| Error::from_reason(format!("Erro commit: {}", e)))?;

        Ok(true)
    }

    #[napi]
    pub async fn get_default_schema_issuer_did(&self) -> Result<Option<String>> {
        let store = self
            .store
            .clone()
            .ok_or_else(|| Error::from_reason("Wallet fechada!"))?;
        let mut session = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro sessão: {}", e)))?;

        let entry = session
            .fetch(CONFIG_CATEGORY, KEY_DEFAULT_SCHEMA_ISSUER_DID, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro fetch config: {}", e)))?;

        Ok(entry.map(|e| String::from_utf8(e.value.to_vec()).unwrap_or_default()))
    }
}
