// src/modules/presentations.rs
// use crate::modules::common::napi_err;
use crate::IndyAgent;
// Importamos o cache compartilhado do módulo de credenciais
use crate::modules::credentials::LINK_SECRET_CACHE;

use napi::{Env, Error, JsObject, Result};
use napi_derive::napi;
use std::collections::HashMap;
use std::convert::TryFrom;
// use std::sync::Arc;

// Imports Anoncreds
use anoncreds::data_types::cred_def::CredentialDefinitionId as AnonCredDefId;
// use anoncreds::data_types::cred_def::{CredentialDefinition, CredentialDefinitionId};
use anoncreds::data_types::cred_def::CredentialDefinition;
// use anoncreds::data_types::credential::Credential;
use anoncreds::data_types::schema::SchemaId as AnonSchemaId;
// use anoncreds::data_types::schema::{Schema, SchemaId};
// use anoncreds::types::{LinkSecret, PresentCredentials, Presentation, PresentationRequest};

use anoncreds::data_types::schema::Schema;
use anoncreds::types::{Presentation, PresentationRequest};

use anoncreds::verifier::verify_presentation;

// Funções auxiliares:
// -------------------------------
// Helpers: Spec de UI -> RequestedCredentials (AnonCreds)
// -------------------------------

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

// -------------------------------
// Spec UI-friendly
// -------------------------------
#[derive(Debug, Deserialize)]
struct RequestedCredsSpecV1 {
    #[serde(default)]
    selection: Vec<RequestedCredSelectionItemV1>,

    #[serde(default)]
    self_attested: std::collections::HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct RequestedCredSelectionItemV1 {
    cred_id: String,

    #[serde(default)]
    attributes: Vec<RequestedAttrPickV1>,

    #[serde(default)]
    predicates: Vec<RequestedPredPickV1>,

    #[serde(default)]
    timestamp: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RequestedAttrPickV1 {
    referent: String,
    #[serde(default = "default_true")]
    revealed: bool,
}

#[derive(Debug, Deserialize)]
struct RequestedPredPickV1 {
    referent: String,
}

fn default_true() -> bool {
    true
}

// -------------------------------
// Saída no formato que seu core já consome
// -------------------------------
#[derive(Debug, Serialize)]
struct RequestedCredentialsJsonOut {
    requested_attributes: std::collections::HashMap<String, RequestedAttrOut>,
    requested_predicates: std::collections::HashMap<String, RequestedPredOut>,
    self_attested_attributes: std::collections::HashMap<String, String>,
}

#[derive(Debug, Serialize)]
struct RequestedAttrOut {
    cred_id: String,
    revealed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    timestamp: Option<u64>,
}

#[derive(Debug, Serialize)]
struct RequestedPredOut {
    cred_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    timestamp: Option<u64>,
}

// -------------------------------
// Validação via JSON (compatível com qualquer versão do anoncreds)
// -------------------------------
fn validate_selection_against_pres_req_json(
    pres_req_json: &JsonValue,
    spec: &RequestedCredsSpecV1,
) -> std::result::Result<(), napi::Error> {
    let req_attrs = pres_req_json
        .get("requested_attributes")
        .and_then(|v| v.as_object())
        .ok_or_else(|| napi::Error::from_reason("presentationRequest sem requested_attributes"))?;

    let req_preds = pres_req_json
        .get("requested_predicates")
        .and_then(|v| v.as_object())
        .ok_or_else(|| napi::Error::from_reason("presentationRequest sem requested_predicates"))?;

    for item in &spec.selection {
        for a in &item.attributes {
            if !req_attrs.contains_key(&a.referent) {
                return Err(napi::Error::from_reason(format!(
                    "selection.attributes.referent '{}' não existe em presentationRequest.requested_attributes",
                    a.referent
                )));
            }
        }
        for p in &item.predicates {
            if !req_preds.contains_key(&p.referent) {
                return Err(napi::Error::from_reason(format!(
                    "selection.predicates.referent '{}' não existe em presentationRequest.requested_predicates",
                    p.referent
                )));
            }
        }
    }

    Ok(())
}

// -------------------------------
// Builder: spec -> requested_credentials_json
// -------------------------------
fn build_requested_credentials_from_spec(
    spec: RequestedCredsSpecV1,
) -> std::result::Result<String, napi::Error> {
    let mut out = RequestedCredentialsJsonOut {
        requested_attributes: std::collections::HashMap::new(),
        requested_predicates: std::collections::HashMap::new(),
        self_attested_attributes: spec.self_attested,
    };

    for item in spec.selection {
        for a in item.attributes {
            out.requested_attributes.insert(
                a.referent,
                RequestedAttrOut {
                    cred_id: item.cred_id.clone(),
                    revealed: a.revealed,
                    timestamp: item.timestamp,
                },
            );
        }

        for p in item.predicates {
            out.requested_predicates.insert(
                p.referent,
                RequestedPredOut {
                    cred_id: item.cred_id.clone(),
                    timestamp: item.timestamp,
                },
            );
        }
    }

    serde_json::to_string(&out).map_err(|e| {
        napi::Error::from_reason(format!("Erro serializar requested_credentials: {}", e))
    })
}

#[napi]
impl IndyAgent {
    // =========================================================================
    //  6. HOLDER: GERAR APRESENTAÇÃO (FINAL)
    // =========================================================================
    // =========================================================================
    //  PROVA: CRIAR APRESENTAÇÃO (CORRIGIDO: LIFETIME KEEPER)
    // =========================================================================
    #[napi]
    pub fn create_presentation(
        &self,
        env: Env,
        presentation_request_json: String,
        requested_credentials_json: String,
        schemas_json: String,
        cred_defs_json: String,
    ) -> Result<JsObject> {
        // --- IMPORTS ---
        use std::collections::HashMap;

        // Estruturas de Dados
        use anoncreds::data_types::cred_def::{CredentialDefinition, CredentialDefinitionId};
        use anoncreds::data_types::credential::Credential;
        use anoncreds::data_types::schema::{Schema, SchemaId};

        // Tipos de Alto Nível
        use anoncreds::types::{LinkSecret, PresentCredentials, PresentationRequest};

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
                            .fetch("link_secret", "default", false)
                            .await
                            .map_err(|e| napi::Error::from_reason(format!("Erro DB LS: {}", e)))?
                            .ok_or_else(|| {
                                napi::Error::from_reason("Link Secret 'default' não encontrado")
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

                // 2. PARSE REQUEST
                let request: PresentationRequest = serde_json::from_str(&presentation_request_json)
                    .map_err(|e| napi::Error::from_reason(format!("Erro Request JSON: {}", e)))?;

                // 3. SCHEMAS
                let schemas_raw: HashMap<String, serde_json::Value> =
                    serde_json::from_str(&schemas_json).map_err(|e| {
                        napi::Error::from_reason(format!("Erro JSON Schemas: {}", e))
                    })?;

                let mut schemas: HashMap<SchemaId, Schema> = HashMap::new();
                for (k, v) in schemas_raw {
                    let id = SchemaId::new(k.clone()).map_err(|_| {
                        napi::Error::from_reason(format!("SchemaId inválido: {}", k))
                    })?;

                    let mut target = &v;
                    if let Some(res) = v.get("result") {
                        if let Some(data) = res.get("data") {
                            target = data;
                        } else {
                            target = res;
                        }
                    }
                    let parsed_inner: serde_json::Value;
                    if target.is_string() {
                        let s = target.as_str().unwrap();
                        parsed_inner = serde_json::from_str(s).unwrap_or(serde_json::Value::Null);
                        target = &parsed_inner;
                    }
                    let source = target
                        .as_object()
                        .ok_or_else(|| napi::Error::from_reason("Schema invalido"))?;

                    // Reconstrução manual para garantir compatibilidade
                    let mut clean = serde_json::Map::new();
                    if let Some(x) = source.get("name") {
                        clean.insert("name".to_string(), x.clone());
                    }
                    if let Some(x) = source.get("version") {
                        clean.insert("version".to_string(), x.clone());
                    }

                    let attrs = source.get("attrNames").or_else(|| source.get("attr_names"));
                    if let Some(x) = attrs {
                        clean.insert("attrNames".to_string(), x.clone());
                    }

                    let derived_issuer = k.split(':').next().unwrap_or("unknown");
                    clean.insert("issuerId".to_string(), serde_json::json!(derived_issuer));

                    if let Some(x) = source.get("id") {
                        clean.insert("id".to_string(), x.clone());
                    }
                    if let Some(x) = source.get("ver") {
                        clean.insert("ver".to_string(), x.clone());
                    }

                    let schema_struct: Schema =
                        serde_json::from_value(serde_json::Value::Object(clean)).map_err(|e| {
                            napi::Error::from_reason(format!("Erro Struct Schema {}: {}", k, e))
                        })?;

                    schemas.insert(id, schema_struct);
                }

                // 4. CRED DEFS
                let cred_defs_raw: HashMap<String, serde_json::Value> =
                    serde_json::from_str(&cred_defs_json).map_err(|e| {
                        napi::Error::from_reason(format!("Erro JSON CredDefs: {}", e))
                    })?;

                let mut cred_defs: HashMap<CredentialDefinitionId, CredentialDefinition> =
                    HashMap::new();
                for (k, v) in cred_defs_raw {
                    let id = CredentialDefinitionId::new(k.clone()).map_err(|_| {
                        napi::Error::from_reason(format!("CredDefId inválido: {}", k))
                    })?;

                    let mut target = &v;
                    if let Some(res) = v.get("result") {
                        if let Some(data) = res.get("data") {
                            target = data;
                        } else {
                            target = res;
                        }
                    }
                    let parsed_inner: serde_json::Value;
                    if target.is_string() {
                        let s = target.as_str().unwrap();
                        parsed_inner = serde_json::from_str(s).unwrap_or(serde_json::Value::Null);
                        target = &parsed_inner;
                    }
                    let source = target.as_object().ok_or_else(|| {
                        napi::Error::from_reason(format!("CredDef {} invalida", k))
                    })?;

                    let mut clean = serde_json::Map::new();
                    clean.insert("id".to_string(), serde_json::json!(k));

                    let derived_issuer = k.split(':').next().unwrap_or("unknown");
                    clean.insert("issuerId".to_string(), serde_json::json!(derived_issuer));

                    let derived_schema_id = k.split(':').nth(3).unwrap_or("1");
                    let sid = source
                        .get("schemaId")
                        .or_else(|| source.get("schema_id"))
                        .map(|x| x.clone())
                        .unwrap_or(serde_json::json!(derived_schema_id));
                    clean.insert("schemaId".to_string(), sid);

                    clean.insert(
                        "type".to_string(),
                        source
                            .get("type")
                            .cloned()
                            .unwrap_or(serde_json::json!("CL")),
                    );
                    clean.insert(
                        "tag".to_string(),
                        source
                            .get("tag")
                            .cloned()
                            .unwrap_or(serde_json::json!("TAG_PROOF")),
                    );
                    clean.insert(
                        "ver".to_string(),
                        source
                            .get("ver")
                            .cloned()
                            .unwrap_or(serde_json::json!("1.0")),
                    );

                    if source.contains_key("primary") && !source.contains_key("value") {
                        let mut val_map = serde_json::Map::new();
                        val_map.insert(
                            "primary".to_string(),
                            source.get("primary").unwrap().clone(),
                        );
                        if let Some(rev) = source.get("revocation") {
                            val_map.insert("revocation".to_string(), rev.clone());
                        }
                        clean.insert("value".to_string(), serde_json::Value::Object(val_map));
                    } else if let Some(val) = source.get("value") {
                        clean.insert("value".to_string(), val.clone());
                    } else {
                        return Err(napi::Error::from_reason(format!(
                            "CredDef {} sem chaves",
                            k
                        )));
                    }

                    let cd_struct: CredentialDefinition =
                        serde_json::from_value(serde_json::Value::Object(clean)).map_err(|e| {
                            napi::Error::from_reason(format!("Erro Struct CredDef {}: {}", k, e))
                        })?;

                    cred_defs.insert(id, cd_struct);
                }

                // 5. PROCESSAMENTO DE PEDIDOS (Agrupamento)
                let req_creds_input: serde_json::Value =
                    serde_json::from_str(&requested_credentials_json)
                        .map_err(|_| napi::Error::from_reason("Erro RequestedCredentials Input"))?;

                struct CredentialAction {
                    referent: String,
                    is_predicate: bool,
                    revealed: bool,
                    #[allow(dead_code)]
                    timestamp: Option<u64>,
                }
                let mut cred_actions: HashMap<String, Vec<CredentialAction>> = HashMap::new();

                if let Some(req_attrs) = req_creds_input
                    .get("requested_attributes")
                    .and_then(|v| v.as_object())
                {
                    for (referent, info) in req_attrs {
                        let cred_id = info.get("cred_id").unwrap().as_str().unwrap().to_string();
                        let revealed = info.get("revealed").unwrap().as_bool().unwrap_or(true);
                        let timestamp = info.get("timestamp").and_then(|t| t.as_u64());
                        cred_actions
                            .entry(cred_id)
                            .or_default()
                            .push(CredentialAction {
                                referent: referent.clone(),
                                is_predicate: false,
                                revealed,
                                timestamp,
                            });
                    }
                }
                if let Some(req_preds) = req_creds_input
                    .get("requested_predicates")
                    .and_then(|v| v.as_object())
                {
                    for (referent, info) in req_preds {
                        let cred_id = info.get("cred_id").unwrap().as_str().unwrap().to_string();
                        let timestamp = info.get("timestamp").and_then(|t| t.as_u64());
                        cred_actions
                            .entry(cred_id)
                            .or_default()
                            .push(CredentialAction {
                                referent: referent.clone(),
                                is_predicate: true,
                                revealed: false,
                                timestamp,
                            });
                    }
                }

                // 6. CARREGAR E MANTER CREDENCIAIS (O FIX DE LIFETIME)
                let mut credential_keeper: HashMap<String, Credential> = HashMap::new();

                // Carrega todas as credenciais necessárias do DB para a memória
                for cred_id in cred_actions.keys() {
                    let cred_entry = session
                        .fetch("credential", cred_id, false)
                        .await
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Erro DB fetch {}: {}", cred_id, e))
                        })?
                        .ok_or_else(|| {
                            napi::Error::from_reason(format!("Cred {} nao achada", cred_id))
                        })?;

                    let cred_str = String::from_utf8(cred_entry.value.to_vec()).unwrap_or_default();
                    let cred_json: serde_json::Value = serde_json::from_str(&cred_str).unwrap();
                    let actual_cred = cred_json.get("credential").unwrap_or(&cred_json).clone();

                    let credential: Credential =
                        serde_json::from_value(actual_cred).map_err(|e| {
                            napi::Error::from_reason(format!("Erro parse Cred {}: {}", cred_id, e))
                        })?;

                    credential_keeper.insert(cred_id.clone(), credential);
                }

                // 7. MONTAR A PROVA (Usando referências do Keeper)
                let mut present_credentials = PresentCredentials::default();

                for (cred_id, actions) in cred_actions {
                    // Aqui pegamos a referência (&Credential) que VIVE no credential_keeper
                    // O keeper vive até o fim desta função async, satisfazendo o borrow checker.
                    let credential_ref = credential_keeper
                        .get(&cred_id)
                        .ok_or_else(|| napi::Error::from_reason("Erro interno keeper"))?;

                    let mut cred_builder =
                        present_credentials.add_credential(credential_ref, None, None);

                    for action in actions {
                        if action.is_predicate {
                            cred_builder.add_requested_predicate(&action.referent);
                        } else {
                            cred_builder.add_requested_attribute(&action.referent, action.revealed);
                        }
                    }
                }

                // 8. GERAR
                let presentation = anoncreds::prover::create_presentation(
                    &request,
                    present_credentials,
                    Some(HashMap::new()), // self_attested
                    &link_secret,
                    &schemas,
                    &cred_defs,
                )
                .map_err(|e| {
                    napi::Error::from_reason(format!("Erro MATEMÁTICO create_presentation: {}", e))
                })?;

                let json = serde_json::to_string(&presentation).unwrap();
                Ok(json)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    // =========================================================================
    //  7. VERIFIER: VALIDAR (FINAL)
    // =========================================================================
    #[napi]
    pub fn verify_presentation(
        &self,
        env: Env,
        presentation_request_json: String,
        presentation_json: String,
        schemas_json: String,
        cred_defs_json: String,
    ) -> Result<JsObject> {
        env.execute_tokio_future(
            async move {
                let request: PresentationRequest = serde_json::from_str(&presentation_request_json)
                    .map_err(|e| napi::Error::from_reason(format!("Erro Request: {}", e)))?;

                let presentation: Presentation = serde_json::from_str(&presentation_json)
                    .map_err(|e| napi::Error::from_reason(format!("Erro Presentation: {}", e)))?;

                // --- SCHEMAS ---
                let schemas_raw: HashMap<String, serde_json::Value> =
                    serde_json::from_str(&schemas_json)
                        .map_err(|_| napi::Error::from_reason("Erro Schemas"))?;

                let mut schemas = HashMap::new();
                for (k, v) in schemas_raw {
                    let id_json = serde_json::Value::String(k.clone());
                    let id: AnonSchemaId = serde_json::from_value(id_json)
                        .map_err(|_| napi::Error::from_reason("Bad SchemaId"))?;

                    let mut final_val = v.clone();
                    if let Some(res) = final_val.get("result") {
                        if let Some(data) = res.get("data") {
                            final_val = data.clone();
                        }
                    } else if let Some(data) = final_val.get("data") {
                        final_val = data.clone();
                    }

                    if let Some(obj) = final_val.as_object_mut() {
                        if !obj.contains_key("issuerId") {
                            let parts: Vec<&str> = k.split(':').collect();
                            if !parts.is_empty() {
                                obj.insert("issuerId".to_string(), serde_json::json!(parts[0]));
                            }
                        }
                        if !obj.contains_key("attrNames") && obj.contains_key("attr_names") {
                            let attrs = obj.get("attr_names").unwrap().clone();
                            obj.insert("attrNames".to_string(), attrs);
                        }
                    }
                    let schema: Schema = serde_json::from_value(final_val).map_err(|e| {
                        napi::Error::from_reason(format!("Schema {} invalido: {}", k, e))
                    })?;
                    schemas.insert(id, schema);
                }

                // --- CRED DEFS ---
                let cred_defs_raw: HashMap<String, serde_json::Value> =
                    serde_json::from_str(&cred_defs_json)
                        .map_err(|_| napi::Error::from_reason("Erro CredDefs"))?;
                let mut cred_defs = HashMap::new();
                for (k, v) in cred_defs_raw {
                    let id_json = serde_json::Value::String(k.clone());
                    let id: AnonCredDefId = serde_json::from_value(id_json)
                        .map_err(|_| napi::Error::from_reason("Bad CredDefId"))?;

                    let mut final_val = v.clone();
                    if let Some(res) = final_val.get("result") {
                        if let Some(data) = res.get("data") {
                            final_val = data.clone();
                        }
                    } else if let Some(data) = final_val.get("data") {
                        final_val = data.clone();
                    }

                    let needs_wrapping = if let Some(obj) = final_val.as_object() {
                        !obj.contains_key("value") && obj.contains_key("primary")
                    } else {
                        false
                    };

                    if needs_wrapping {
                        let content = final_val.clone();
                        final_val = serde_json::json!({ "value": content });
                    }

                    if let Some(obj) = final_val.as_object_mut() {
                        if !obj.contains_key("schemaId") {
                            if let Some(sid) = obj.get("schema_id").cloned() {
                                obj.insert("schemaId".to_string(), sid);
                            } else {
                                let parts: Vec<&str> = k.split(':').collect();
                                if parts.len() >= 4 {
                                    obj.insert("schemaId".to_string(), serde_json::json!(parts[3]));
                                }
                            }
                        }
                        if !obj.contains_key("issuerId") {
                            let parts: Vec<&str> = k.split(':').collect();
                            if !parts.is_empty() {
                                obj.insert("issuerId".to_string(), serde_json::json!(parts[0]));
                            }
                        }
                        if !obj.contains_key("type") {
                            obj.insert("type".to_string(), serde_json::json!("CL"));
                        }
                        if !obj.contains_key("ver") {
                            obj.insert("ver".to_string(), serde_json::json!("1.0"));
                        }
                        if !obj.contains_key("tag") {
                            obj.insert("tag".to_string(), serde_json::json!("TAG_PROOF"));
                        }
                    }

                    let cd: CredentialDefinition =
                        serde_json::from_value(final_val).map_err(|e| {
                            napi::Error::from_reason(format!("CredDef invalida: {}", e))
                        })?;
                    cred_defs.insert(id, cd);
                }

                // VALIDAR
                let valid = verify_presentation(
                    &presentation,
                    &request,
                    &schemas,
                    &cred_defs,
                    None,
                    None,
                    None,
                )
                .map_err(|e| napi::Error::from_reason(format!("Erro verificação: {}", e)))?;

                Ok(valid)
            },
            |&mut env, data| env.get_boolean(data),
        )
    }

    /// 1) Converte "selection_json" (UI friendly) -> requested_credentials_json (formato anoncreds)
    /// Útil para debug e para o Electron montar facilmente.
    #[napi]
    pub fn build_requested_credentials_v1(
        &self,
        env: Env,
        selection_json: String,
    ) -> Result<JsObject> {
        env.execute_tokio_future(
            async move {
                let spec: RequestedCredsSpecV1 =
                    serde_json::from_str(&selection_json).map_err(|e| {
                        napi::Error::from_reason(format!("JSON inválido selection_json: {}", e))
                    })?;

                let out = build_requested_credentials_from_spec(spec)?;
                Ok(out)
            },
            |&mut env, data| env.create_string(&data),
        )
    }

    /// 2) Create presentation "v2" (multi-cred + reveal/unrevealed + predicates)
    /// Entrada:
    /// - presentation_request_json: igual hoje (anoncreds PresentationRequest)
    /// - selection_json: formato UI-friendly (RequestedCredsSpecV1)
    /// - schemas_json: map schemaId -> payload ledger/local
    /// - cred_defs_json: map credDefId -> payload ledger/local
    #[napi]
    pub fn create_presentation_v2(
        &self,
        env: Env,
        presentation_request_json: String,
        selection_json: String,
        schemas_json: String,
        cred_defs_json: String,
    ) -> Result<JsObject> {
        // Imports (iguais ao seu create_presentation atual)
        use anoncreds::data_types::cred_def::{CredentialDefinition, CredentialDefinitionId};
        use anoncreds::data_types::credential::Credential;
        use anoncreds::data_types::schema::{Schema, SchemaId};
        use anoncreds::types::{LinkSecret, PresentCredentials, PresentationRequest};
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

                // 1) Link secret (igual você já faz)
                let link_secret = {
                    let cached_ls = { LINK_SECRET_CACHE.lock().unwrap().clone() };
                    if let Some(ls) = cached_ls {
                        ls
                    } else {
                        let entry = session
                            .fetch("link_secret", "default", false)
                            .await
                            .map_err(|e| napi::Error::from_reason(format!("Erro DB LS: {}", e)))?
                            .ok_or_else(|| {
                                napi::Error::from_reason("Link Secret 'default' não encontrado")
                            })?;
                        let seed_str = String::from_utf8(entry.value.to_vec()).unwrap_or_default();
                        let ls_obj = LinkSecret::try_from(seed_str.as_str()).map_err(|e| {
                            napi::Error::from_reason(format!("Erro LS math: {:?}", e))
                        })?;
                        let arc_ls = std::sync::Arc::new(ls_obj);
                        *LINK_SECRET_CACHE.lock().unwrap() = Some(arc_ls.clone());
                        arc_ls
                    }
                };

                // 2) Parse PresentationRequest
                let request: PresentationRequest = serde_json::from_str(&presentation_request_json)
                    .map_err(|e| napi::Error::from_reason(format!("Erro Request JSON: {}", e)))?;

                // 3) Parse selection spec e validar referents
                let spec: RequestedCredsSpecV1 =
                    serde_json::from_str(&selection_json).map_err(|e| {
                        napi::Error::from_reason(format!("JSON inválido selection_json: {}", e))
                    })?;

                let pres_req_json_val: serde_json::Value =
                    serde_json::from_str(&presentation_request_json).map_err(|e| {
                        napi::Error::from_reason(format!(
                            "presentationRequest JSON inválido: {}",
                            e
                        ))
                    })?;

                validate_selection_against_pres_req_json(&pres_req_json_val, &spec)?;

                // 4) Converter selection -> requested_credentials_json (formato esperado pelo seu core)
                let requested_credentials_json = build_requested_credentials_from_spec(spec)
                    .map_err(|e| napi::Error::from_reason(format!("{}", e)))?;

                // 5) A partir daqui, reutilizamos sua lógica atual:
                //    - parse schemas_json e cred_defs_json
                //    - agrupar ações por cred_id
                //    - carregar N credenciais do DB
                //    - montar PresentCredentials com revealed/predicates

                // -------- SCHEMAS (igual ao seu create_presentation) --------
                let schemas_raw: HashMap<String, serde_json::Value> =
                    serde_json::from_str(&schemas_json).map_err(|e| {
                        napi::Error::from_reason(format!("Erro JSON Schemas: {}", e))
                    })?;

                let mut schemas: HashMap<SchemaId, Schema> = HashMap::new();
                for (k, v) in schemas_raw {
                    let id = SchemaId::new(k.clone()).map_err(|_| {
                        napi::Error::from_reason(format!("SchemaId inválido: {}", k))
                    })?;

                    let mut target = &v;
                    if let Some(res) = v.get("result") {
                        if let Some(data) = res.get("data") {
                            target = data;
                        } else {
                            target = res;
                        }
                    }
                    let parsed_inner: serde_json::Value;
                    if target.is_string() {
                        let s = target.as_str().unwrap();
                        parsed_inner = serde_json::from_str(s).unwrap_or(serde_json::Value::Null);
                        target = &parsed_inner;
                    }
                    let source = target
                        .as_object()
                        .ok_or_else(|| napi::Error::from_reason("Schema invalido"))?;

                    let mut clean = serde_json::Map::new();
                    if let Some(x) = source.get("name") {
                        clean.insert("name".to_string(), x.clone());
                    }
                    if let Some(x) = source.get("version") {
                        clean.insert("version".to_string(), x.clone());
                    }
                    let attrs = source.get("attrNames").or_else(|| source.get("attr_names"));
                    if let Some(x) = attrs {
                        clean.insert("attrNames".to_string(), x.clone());
                    }

                    let derived_issuer = k.split(':').next().unwrap_or("unknown");
                    clean.insert("issuerId".to_string(), serde_json::json!(derived_issuer));

                    if let Some(x) = source.get("id") {
                        clean.insert("id".to_string(), x.clone());
                    }
                    if let Some(x) = source.get("ver") {
                        clean.insert("ver".to_string(), x.clone());
                    }

                    let schema_struct: Schema =
                        serde_json::from_value(serde_json::Value::Object(clean)).map_err(|e| {
                            napi::Error::from_reason(format!("Erro Struct Schema {}: {}", k, e))
                        })?;

                    schemas.insert(id, schema_struct);
                }

                // -------- CRED DEFS (igual ao seu create_presentation) --------
                let cred_defs_raw: HashMap<String, serde_json::Value> =
                    serde_json::from_str(&cred_defs_json).map_err(|e| {
                        napi::Error::from_reason(format!("Erro JSON CredDefs: {}", e))
                    })?;

                let mut cred_defs: HashMap<CredentialDefinitionId, CredentialDefinition> =
                    HashMap::new();
                for (k, v) in cred_defs_raw {
                    let id = CredentialDefinitionId::new(k.clone()).map_err(|_| {
                        napi::Error::from_reason(format!("CredDefId inválido: {}", k))
                    })?;

                    let mut target = &v;
                    if let Some(res) = v.get("result") {
                        if let Some(data) = res.get("data") {
                            target = data;
                        } else {
                            target = res;
                        }
                    }
                    let parsed_inner: serde_json::Value;
                    if target.is_string() {
                        let s = target.as_str().unwrap();
                        parsed_inner = serde_json::from_str(s).unwrap_or(serde_json::Value::Null);
                        target = &parsed_inner;
                    }
                    let source = target.as_object().ok_or_else(|| {
                        napi::Error::from_reason(format!("CredDef {} invalida", k))
                    })?;

                    let mut clean = serde_json::Map::new();
                    clean.insert("id".to_string(), serde_json::json!(k));

                    let derived_issuer = k.split(':').next().unwrap_or("unknown");
                    clean.insert("issuerId".to_string(), serde_json::json!(derived_issuer));

                    let derived_schema_id = k.split(':').nth(3).unwrap_or("1");
                    let sid = source
                        .get("schemaId")
                        .or_else(|| source.get("schema_id"))
                        .cloned()
                        .unwrap_or(serde_json::json!(derived_schema_id));
                    clean.insert("schemaId".to_string(), sid);

                    clean.insert(
                        "type".to_string(),
                        source
                            .get("type")
                            .cloned()
                            .unwrap_or(serde_json::json!("CL")),
                    );
                    clean.insert(
                        "tag".to_string(),
                        source
                            .get("tag")
                            .cloned()
                            .unwrap_or(serde_json::json!("TAG_PROOF")),
                    );
                    clean.insert(
                        "ver".to_string(),
                        source
                            .get("ver")
                            .cloned()
                            .unwrap_or(serde_json::json!("1.0")),
                    );

                    if source.contains_key("primary") && !source.contains_key("value") {
                        let mut val_map = serde_json::Map::new();
                        val_map.insert(
                            "primary".to_string(),
                            source.get("primary").unwrap().clone(),
                        );
                        if let Some(rev) = source.get("revocation") {
                            val_map.insert("revocation".to_string(), rev.clone());
                        }
                        clean.insert("value".to_string(), serde_json::Value::Object(val_map));
                    } else if let Some(val) = source.get("value") {
                        clean.insert("value".to_string(), val.clone());
                    } else {
                        return Err(napi::Error::from_reason(format!(
                            "CredDef {} sem chaves",
                            k
                        )));
                    }

                    let cd_struct: CredentialDefinition =
                        serde_json::from_value(serde_json::Value::Object(clean)).map_err(|e| {
                            napi::Error::from_reason(format!("Erro Struct CredDef {}: {}", k, e))
                        })?;

                    cred_defs.insert(id, cd_struct);
                }

                // -------- parse requested_credentials_json (formato anoncreds-like) --------
                let req_creds_input: serde_json::Value =
                    serde_json::from_str(&requested_credentials_json)
                        .map_err(|_| napi::Error::from_reason("Erro RequestedCredentials Input"))?;

                // Agrupar por cred_id
                struct CredentialAction {
                    referent: String,
                    is_predicate: bool,
                    revealed: bool,
                    timestamp: Option<u64>,
                }
                let mut cred_actions: HashMap<String, Vec<CredentialAction>> = HashMap::new();

                if let Some(req_attrs) = req_creds_input
                    .get("requested_attributes")
                    .and_then(|v| v.as_object())
                {
                    for (referent, info) in req_attrs {
                        let cred_id = info
                            .get("cred_id")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| {
                                napi::Error::from_reason("requested_attributes.*.cred_id ausente")
                            })?
                            .to_string();
                        let revealed = info
                            .get("revealed")
                            .and_then(|x| x.as_bool())
                            .unwrap_or(true);
                        let timestamp = info.get("timestamp").and_then(|t| t.as_u64());

                        cred_actions
                            .entry(cred_id)
                            .or_default()
                            .push(CredentialAction {
                                referent: referent.clone(),
                                is_predicate: false,
                                revealed,
                                timestamp,
                            });
                    }
                }

                if let Some(req_preds) = req_creds_input
                    .get("requested_predicates")
                    .and_then(|v| v.as_object())
                {
                    for (referent, info) in req_preds {
                        let cred_id = info
                            .get("cred_id")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| {
                                napi::Error::from_reason("requested_predicates.*.cred_id ausente")
                            })?
                            .to_string();
                        let timestamp = info.get("timestamp").and_then(|t| t.as_u64());

                        cred_actions
                            .entry(cred_id)
                            .or_default()
                            .push(CredentialAction {
                                referent: referent.clone(),
                                is_predicate: true,
                                revealed: false,
                                timestamp,
                            });
                    }
                }

                // Carregar credenciais do DB (categoria "credential") e manter vivas
                let mut credential_keeper: HashMap<String, Credential> = HashMap::new();
                for cred_id in cred_actions.keys() {
                    let cred_entry = session
                        .fetch("credential", cred_id, false)
                        .await
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Erro DB fetch {}: {}", cred_id, e))
                        })?
                        .ok_or_else(|| {
                            napi::Error::from_reason(format!("Cred {} nao achada", cred_id))
                        })?;

                    let cred_str = String::from_utf8(cred_entry.value.to_vec()).unwrap_or_default();
                    let cred_json: serde_json::Value =
                        serde_json::from_str(&cred_str).unwrap_or(serde_json::Value::Null);
                    let actual_cred = cred_json.get("credential").unwrap_or(&cred_json).clone();

                    let credential: Credential =
                        serde_json::from_value(actual_cred).map_err(|e| {
                            napi::Error::from_reason(format!("Erro parse Cred {}: {}", cred_id, e))
                        })?;

                    credential_keeper.insert(cred_id.clone(), credential);
                }

                // Montar PresentCredentials
                let mut present_credentials = PresentCredentials::default();
                for (cred_id, actions) in cred_actions {
                    let credential_ref = credential_keeper
                        .get(&cred_id)
                        .ok_or_else(|| napi::Error::from_reason("Erro interno keeper"))?;

                    let mut cred_builder =
                        present_credentials.add_credential(credential_ref, None, None);

                    for action in actions {
                        if action.is_predicate {
                            cred_builder.add_requested_predicate(&action.referent);
                        } else {
                            cred_builder.add_requested_attribute(&action.referent, action.revealed);
                        }
                    }
                }

                // Self-attested (do spec)
                let self_attested = req_creds_input
                    .get("self_attested_attributes")
                    .and_then(|v| v.as_object())
                    .map(|m| {
                        m.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                            .collect::<HashMap<String, String>>()
                    })
                    .unwrap_or_else(HashMap::new);

                let presentation = anoncreds::prover::create_presentation(
                    &request,
                    present_credentials,
                    Some(self_attested),
                    &link_secret,
                    &schemas,
                    &cred_defs,
                )
                .map_err(|e| {
                    napi::Error::from_reason(format!("Erro MATEMÁTICO create_presentation: {}", e))
                })?;

                Ok(serde_json::to_string(&presentation).unwrap())
            },
            |&mut env, data| env.create_string(&data),
        )
    }
}
