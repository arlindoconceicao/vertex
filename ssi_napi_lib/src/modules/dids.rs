// src/modules/dids.rs
use crate::{ledger, send_request_async}; // Importa o módulo ledger.rs que você já possui
use crate::IndyAgent;
use aries_askar::entry::{EntryTag, TagFilter};
use aries_askar::kms::{KeyAlg, LocalKey};
use base64::Engine;
use base64::engine::general_purpose;
use napi::{Env, Error, JsObject, Result};
use napi_derive::napi;
use serde::Deserialize;
use serde_json::json;
use tokio::time::{Instant, sleep};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// Re-importando do common o que for necessário
use crate::modules::common::now_ts;

#[derive(Debug, Deserialize, Default)]
pub struct DidSearchFilter {
    #[serde(rename = "type")]
    pub type_field: Option<String>, // "own" | "external" | "all"
    pub query: Option<String>,    // substring
    pub createdFrom: Option<u64>, // epoch seconds
    pub createdTo: Option<u64>,   // epoch seconds
    pub isPublic: Option<bool>,   // default false
    pub role: Option<String>,     // "ENDORSER" | "TRUSTEE" | "STEWARD" | "none"
    pub origin: Option<String>,   // "generated" | "imported_seed" | "manual" | "legacy"
    pub limit: Option<usize>,     // default 50
    pub offset: Option<usize>,    // default 0
}

#[derive(Debug, Deserialize, Default)]
pub struct CreateDidPolicy {
    pub requireTrusteeForEndorser: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
pub struct CreateDidOpts {
    pub alias: Option<String>,
    #[serde(rename = "public")]
    pub public_: Option<bool>,
    pub role: Option<String>,         // "ENDORSER|TRUSTEE|STEWARD|none"
    pub submitterDid: Option<String>, // obrigatório se public=true
    pub policy: Option<CreateDidPolicy>,
}

#[napi]
impl IndyAgent {
    // =========================================================================
    //  9. GESTÃO DE DIDs
    // =========================================================================

    #[napi]
    pub async unsafe fn get_did(&self, did: String) -> Result<String> {
        // 1) Validar store aberta
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Carteira fechada!")),
        };

        // 2) Abrir sessão efêmera
        let mut session = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro Sessão: {}", e)))?;

        // 3) Buscar entry "did" pelo nome (chave) = did
        let entry_opt = session
            .fetch("did", &did, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro fetch DID: {}", e)))?;

        let entry = match entry_opt {
            Some(e) => e,
            None => return Err(Error::from_reason(format!("DID não encontrado: {}", did))),
        };

        // 4) Converter bytes -> string
        let s = String::from_utf8(entry.value.to_vec())
            .map_err(|e| Error::from_reason(format!("Erro UTF-8 no registro DID: {}", e)))?;

        // 5) Parsear JSON (se não for JSON válido, não quebra: devolve um wrapper)
        let mut val: serde_json::Value = match serde_json::from_str(&s) {
            Ok(v) => v,
            Err(_) => {
                // fallback para registros antigos/corrompidos
                json!({
                    "did": did,
                    "raw": s
                })
            }
        };

        // 6) Garantia de segurança: remover qualquer campo "seed" (se existir por erro)
        if let Some(obj) = val.as_object_mut() {
            obj.remove("seed");
            obj.remove("seedHex");
            obj.remove("seedB64");
            obj.remove("privateKey");
            obj.remove("secret");
        }

        // 7) Garantir que "did" está presente (compat com registros antigos)
        if val.get("did").is_none() {
            if let Some(obj) = val.as_object_mut() {
                obj.insert("did".to_string(), serde_json::Value::String(did));
            }
        }

        // 8) Retornar JSON
        serde_json::to_string(&val)
            .map_err(|e| Error::from_reason(format!("Erro serializar DID: {}", e)))
    }

    // ----------------------------------------------------------
    #[napi]
    pub async unsafe fn get_did_by_verkey(&self, verkey: String) -> Result<String> {
        // 1) Validar store aberta
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Carteira fechada!")),
        };

        // 2) Abrir sessão efêmera
        let mut session = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro Sessão: {}", e)))?;

        // 3) Buscar por tag "verkey"
        let filter = TagFilter::is_eq("verkey", verkey.clone());

        // Buscamos no máximo 2 para detectar duplicidade
        let entries = session
            .fetch_all(Some("did"), Some(filter), None, None, false, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro busca por verkey: {}", e)))?;

        if entries.is_empty() {
            return Err(Error::from_reason(format!(
                "Verkey não encontrada na carteira: {}",
                verkey
            )));
        }

        if entries.len() > 1 {
            return Err(Error::from_reason(format!(
                "Verkey duplicada na carteira ({} registros): {}",
                entries.len(),
                verkey
            )));
        }

        // 4) Converter bytes -> string
        let entry = &entries[0];
        let s = String::from_utf8(entry.value.to_vec())
            .map_err(|e| Error::from_reason(format!("Erro UTF-8 no registro DID: {}", e)))?;

        // 5) Parsear JSON (fallback se vier algo inesperado)
        let mut val: serde_json::Value = match serde_json::from_str(&s) {
            Ok(v) => v,
            Err(_) => json!({
                "verkey": verkey,
                "raw": s
            }),
        };

        // 6) Hardening: remover possíveis campos sensíveis
        if let Some(obj) = val.as_object_mut() {
            obj.remove("seed");
            obj.remove("seedHex");
            obj.remove("seedB64");
            obj.remove("privateKey");
            obj.remove("secret");
        }

        // 7) Garantir que "verkey" esteja presente (compat com legados)
        if val.get("verkey").is_none() {
            if let Some(obj) = val.as_object_mut() {
                obj.insert("verkey".to_string(), serde_json::Value::String(verkey));
            }
        }

        // 8) Retornar JSON
        serde_json::to_string(&val)
            .map_err(|e| Error::from_reason(format!("Erro serializar DID: {}", e)))
    }

    // =========================================================
    // 2) Busca/listagem avançada com filtros
    // =========================================================
    #[napi]
    pub async unsafe fn search_dids(&self, filter_json: String) -> Result<String> {
        // 1) Store aberta?
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Carteira fechada!")),
        };

        // 2) Parse do filtro
        let f: DidSearchFilter = serde_json::from_str(&filter_json)
            .map_err(|e| Error::from_reason(format!("Filtro JSON inválido: {}", e)))?;

        // defaults
        let type_req = f
            .type_field
            .clone()
            .unwrap_or_else(|| "all".to_string())
            .to_lowercase();

        let query_lc = f.query.clone().unwrap_or_default().to_lowercase();
        let has_query = !query_lc.trim().is_empty();

        let created_from = f.createdFrom.unwrap_or(0);
        let created_to = f.createdTo.unwrap_or(u64::MAX);

        let want_is_public = f.isPublic; // Option<bool>
        let want_role = f.role.clone().map(|s| s.to_lowercase()); // Option<String>
        let want_origin = f.origin.clone().map(|s| s.to_lowercase()); // Option<String>

        let offset = f.offset.unwrap_or(0);
        let limit = f.limit.unwrap_or(50);

        // 3) Abrir sessão
        let mut session = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro Sessão: {}", e)))?;

        // 4) Estratégia compatível com seu banco atual:
        //    - como alguns JSONs antigos não têm "type", nós buscaremos por tags:
        //      (own) e/ou (external) separadamente e INJETAMOS "type" no retorno quando faltar.
        let mut buckets: Vec<(String, Vec<aries_askar::entry::Entry>)> = Vec::new();

        match type_req.as_str() {
            "own" => {
                let filter = TagFilter::is_eq("type", "own".to_string());
                let entries = session
                    .fetch_all(Some("did"), Some(filter), None, None, false, false)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro busca own: {}", e)))?;
                buckets.push(("own".to_string(), entries));
            }
            "external" => {
                let filter = TagFilter::is_eq("type", "external".to_string());
                let entries = session
                    .fetch_all(Some("did"), Some(filter), None, None, false, false)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro busca external: {}", e)))?;
                buckets.push(("external".to_string(), entries));
            }
            _ => {
                // all: faz duas buscas e concatena
                let filter_own = TagFilter::is_eq("type", "own".to_string());
                let own = session
                    .fetch_all(Some("did"), Some(filter_own), None, None, false, false)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro busca own: {}", e)))?;
                buckets.push(("own".to_string(), own));

                let filter_ext = TagFilter::is_eq("type", "external".to_string());
                let ext = session
                    .fetch_all(Some("did"), Some(filter_ext), None, None, false, false)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro busca external: {}", e)))?;
                buckets.push(("external".to_string(), ext));
            }
        }

        // 5) Normalização + filtros
        let mut results: Vec<serde_json::Value> = Vec::new();

        for (bucket_type, entries) in buckets {
            for entry in entries {
                let s = match String::from_utf8(entry.value.to_vec()) {
                    Ok(x) => x,
                    Err(_) => continue, // ignora registro corrompido
                };

                let mut v: serde_json::Value = match serde_json::from_str(&s) {
                    Ok(x) => x,
                    Err(_) => continue, // ignora JSON inválido
                };

                // ---- normalização (DidRecord v1) ----
                if let Some(obj) = v.as_object_mut() {
                    // hardening: remover campos sensíveis se existirem por acidente
                    obj.remove("seed");
                    obj.remove("seedHex");
                    obj.remove("seedB64");
                    obj.remove("privateKey");
                    obj.remove("secret");

                    // garantir campos mínimos
                    if obj.get("method").is_none() {
                        obj.insert(
                            "method".to_string(),
                            serde_json::Value::String("sov".to_string()),
                        );
                    }

                    // type pode estar ausente em registros antigos (ex.: store_their_did)
                    if obj.get("type").is_none() {
                        obj.insert(
                            "type".to_string(),
                            serde_json::Value::String(bucket_type.clone()),
                        );
                    }

                    // createdAt pode estar ausente em legados
                    if obj.get("createdAt").is_none() {
                        obj.insert("createdAt".to_string(), serde_json::Value::Number(0.into()));
                    }

                    // isPublic / role / origin podem estar ausentes
                    if obj.get("isPublic").is_none() {
                        obj.insert("isPublic".to_string(), serde_json::Value::Bool(false));
                    }
                    if obj.get("role").is_none() {
                        obj.insert("role".to_string(), serde_json::Value::Null);
                    }
                    if obj.get("origin").is_none() {
                        obj.insert(
                            "origin".to_string(),
                            serde_json::Value::String("legacy".to_string()),
                        );
                    }
                } else {
                    continue; // não é objeto
                }

                // ---- aplicar filtros ----
                let did_s = v
                    .get("did")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_lowercase();
                let verkey_s = v
                    .get("verkey")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_lowercase();
                let alias_s = v
                    .get("alias")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_lowercase();

                if has_query {
                    let ok = did_s.contains(&query_lc)
                        || verkey_s.contains(&query_lc)
                        || alias_s.contains(&query_lc);
                    if !ok {
                        continue;
                    }
                }

                let created_at = v.get("createdAt").and_then(|x| x.as_u64()).unwrap_or(0);

                // se o usuário pediu intervalo e o registro é legado (createdAt=0), exclui
                if (f.createdFrom.is_some() || f.createdTo.is_some()) && created_at == 0 {
                    continue;
                }
                if created_at < created_from || created_at > created_to {
                    continue;
                }

                if let Some(want_pub) = want_is_public {
                    let is_pub = v.get("isPublic").and_then(|x| x.as_bool()).unwrap_or(false);
                    if is_pub != want_pub {
                        continue;
                    }
                }

                if let Some(want_r) = &want_role {
                    let role_val = v.get("role");
                    let role_norm = match role_val {
                        Some(serde_json::Value::String(s)) => s.to_lowercase(),
                        Some(serde_json::Value::Null) | None => "none".to_string(),
                        _ => "none".to_string(),
                    };
                    if &role_norm != want_r {
                        continue;
                    }
                }

                if let Some(want_o) = &want_origin {
                    let origin_norm = v
                        .get("origin")
                        .and_then(|x| x.as_str())
                        .unwrap_or("legacy")
                        .to_lowercase();
                    if &origin_norm != want_o {
                        continue;
                    }
                }

                results.push(v);
            }
        }

        // 6) Ordenação determinística: createdAt desc, depois did asc
        results.sort_by(|a, b| {
            let ca = a.get("createdAt").and_then(|x| x.as_u64()).unwrap_or(0);
            let cb = b.get("createdAt").and_then(|x| x.as_u64()).unwrap_or(0);
            match cb.cmp(&ca) {
                std::cmp::Ordering::Equal => {
                    let da = a.get("did").and_then(|x| x.as_str()).unwrap_or("");
                    let db = b.get("did").and_then(|x| x.as_str()).unwrap_or("");
                    da.cmp(db)
                }
                o => o,
            }
        });

        // 7) Paginação
        let start = std::cmp::min(offset, results.len());
        let end = std::cmp::min(start + limit, results.len());
        let page = results[start..end].to_vec();

        serde_json::to_string(&page)
            .map_err(|e| Error::from_reason(format!("Erro serializar search_dids: {}", e)))
    }

    // =========================================================
    // 3) Export/Import em lote (DID + verkey, sem seed)
    // =========================================================
    #[napi]
    pub async unsafe fn export_dids_batch(&self, filter_json: String) -> Result<String> {
        // 1) Reutiliza o search_dids para aplicar filtros e normalizar DidRecord
        let arr_str = self.search_dids(filter_json).await?;

        let arr_val: serde_json::Value = serde_json::from_str(&arr_str).map_err(|e| {
            Error::from_reason(format!("search_dids retornou JSON inválido: {}", e))
        })?;

        let items = arr_val
            .as_array()
            .ok_or_else(|| Error::from_reason("search_dids não retornou um array JSON"))?;

        // 2) Extrai apenas {did, verkey, alias?}
        let mut out_items: Vec<serde_json::Value> = Vec::with_capacity(items.len());

        for v in items {
            let did = v
                .get("did")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let verkey = v
                .get("verkey")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();

            // Se faltar did/verkey, ignora item (ou você pode retornar erro — aqui preferi robustez)
            if did.trim().is_empty() || verkey.trim().is_empty() {
                continue;
            }

            let alias_opt = v
                .get("alias")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());

            if let Some(alias) = alias_opt {
                if !alias.trim().is_empty() {
                    out_items.push(json!({
                        "did": did,
                        "verkey": verkey,
                        "alias": alias
                    }));
                    continue;
                }
            }

            out_items.push(json!({
                "did": did,
                "verkey": verkey
            }));
        }

        // 3) exportedAt
        let exported_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // 4) Monta o batch v1
        let batch = json!({
            "type": "ssi-did-batch-v1",
            "exportedAt": exported_at,
            "count": out_items.len(),
            "items": out_items
        });

        // 5) Serializa
        serde_json::to_string(&batch)
            .map_err(|e| Error::from_reason(format!("Erro serializar export_dids_batch: {}", e)))
    }

    // --------------------------------------------------------
    #[napi]
    pub async unsafe fn import_dids_batch(
        &mut self,
        batch_json: String,
        mode: Option<String>, // default: "external"
    ) -> Result<String> {
        // 1) Validar store aberta
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Carteira fechada!")),
        };

        // 2) Mode (por enquanto só suportamos "external")
        let mode_norm = mode
            .unwrap_or_else(|| "external".to_string())
            .to_lowercase();
        if mode_norm != "external" {
            return Err(Error::from_reason(format!(
                "Modo não suportado: {}. Use 'external'.",
                mode_norm
            )));
        }

        // 3) Parse do JSON de entrada
        let v: serde_json::Value = serde_json::from_str(&batch_json)
            .map_err(|e| Error::from_reason(format!("batch_json inválido: {}", e)))?;

        // 4) Extrair lista de items:
        //    - aceita wrapper { type:"ssi-did-batch-v1", items:[...] }
        //    - aceita diretamente um array [...]
        let items_val = if v.is_array() {
            v.clone()
        } else if v.is_object() {
            // valida type quando existir
            if let Some(t) = v.get("type").and_then(|x| x.as_str()) {
                if t != "ssi-did-batch-v1" {
                    return Err(Error::from_reason(format!(
                        "batch.type inválido: {} (esperado ssi-did-batch-v1)",
                        t
                    )));
                }
            }
            v.get("items")
                .cloned()
                .ok_or_else(|| Error::from_reason("batch_json não contém campo 'items'"))?
        } else {
            return Err(Error::from_reason(
                "batch_json deve ser um array ou um objeto {items:[...]}",
            ));
        };

        let items = items_val
            .as_array()
            .ok_or_else(|| Error::from_reason("Campo 'items' deve ser um array"))?;

        // 5) Sessão
        let mut session = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro ao criar sessão: {}", e)))?;

        // 6) Counters
        let mut imported: u64 = 0;
        let mut skipped: u64 = 0;
        let updated: u64 = 0; // por enquanto não fazemos update (fica 0)

        // 7) timestamp para records importados
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // 8) Processar cada item
        for (idx, it) in items.iter().enumerate() {
            let did = it
                .get("did")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let verkey = it
                .get("verkey")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let alias = it
                .get("alias")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .trim()
                .to_string();

            // Skip itens inválidos (não aborta o lote)
            if did.is_empty() || verkey.is_empty() {
                skipped += 1;
                continue;
            }

            // 8.1) Checar se já existe (idempotência)
            let existing = session
                .fetch("did", &did, false)
                .await
                .map_err(|e| Error::from_reason(format!("Erro fetch DID (idx {}): {}", idx, e)))?;

            if let Some(e) = existing {
                // Se já existe, valida conflito de verkey
                let s = String::from_utf8(e.value.to_vec()).unwrap_or_default();
                if let Ok(ev) = serde_json::from_str::<serde_json::Value>(&s) {
                    let existing_vk = ev.get("verkey").and_then(|x| x.as_str()).unwrap_or("");
                    if !existing_vk.is_empty() && existing_vk != verkey {
                        return Err(Error::from_reason(format!(
                        "Conflito: DID já existe com verkey diferente (idx {}): did={} existing_verkey={} new_verkey={}",
                        idx, did, existing_vk, verkey
                    )));
                    }
                }
                skipped += 1;
                continue;
            }

            // 8.2) Inserir como external (DidRecord v1 já padronizado)
            let tags = vec![
                EntryTag::Encrypted("type".to_string(), "external".to_string()),
                EntryTag::Encrypted("verkey".to_string(), verkey.clone()),
                // alias pode estar vazio — ainda assim é útil ter a tag
                EntryTag::Encrypted("alias".to_string(), alias.clone()),
                EntryTag::Encrypted("createdAt".to_string(), created_at.to_string()),
                EntryTag::Encrypted("isPublic".to_string(), "false".to_string()),
                EntryTag::Encrypted("origin".to_string(), "imported_json".to_string()),
                EntryTag::Encrypted("role".to_string(), "none".to_string()),
            ];

            let metadata = json!({
                "did": did,
                "verkey": verkey,
                "method": "sov",
                "alias": alias,
                "type": "external",
                "origin": "imported_json",
                "createdAt": created_at,
                "isPublic": false,
                "role": serde_json::Value::Null
            })
            .to_string();

            // inserir
            session
                .insert("did", &did, metadata.as_bytes(), Some(&tags), None)
                .await
                .map_err(|e| Error::from_reason(format!("Erro insert DID (idx {}): {}", idx, e)))?;

            imported += 1;
        }

        // 9) Commit único no final (melhor performance e consistência)
        session
            .commit()
            .await
            .map_err(|e| Error::from_reason(format!("Erro commit import_dids_batch: {}", e)))?;

        // 10) Resumo
        let summary = json!({
            "ok": true,
            "mode": mode_norm,
            "imported": imported,
            "skipped": skipped,
            "updated": updated
        });

        serde_json::to_string(&summary)
            .map_err(|e| Error::from_reason(format!("Erro serializar resumo: {}", e)))
    }

    // =========================================================
    // 4) Criação v2: local/public + alias + role + metadata
    // =========================================================

    #[napi]
    pub async unsafe fn create_did_v2(&mut self, opts_json: String) -> Result<String> {
        // 1) Validar Store (wallet)
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        // 2) Parse opts
        let opts: CreateDidOpts = serde_json::from_str(&opts_json)
            .map_err(|e| Error::from_reason(format!("opts_json inválido: {}", e)))?;

        let alias = opts.alias.clone().unwrap_or_else(|| "Meu DID".to_string());
        let make_public = opts.public_.unwrap_or(false);

        let role_norm = opts.role.clone().unwrap_or_else(|| "none".to_string());
        let role_norm_up = role_norm.trim().to_uppercase();
        let role_for_ledger: Option<String> = match role_norm_up.as_str() {
            "ENDORSER" | "TRUSTEE" | "STEWARD" => Some(role_norm_up.clone()),
            _ => None,
        };

        let submitter_did = opts
            .submitterDid
            .clone()
            .unwrap_or_default()
            .trim()
            .to_string();

        let require_trustee = opts
            .policy
            .as_ref()
            .and_then(|p| p.requireTrusteeForEndorser)
            .unwrap_or(true);

        if make_public && submitter_did.is_empty() {
            return Err(Error::from_reason(
                "opts.public=true exige submitterDid (DID com permissão para gravar no ledger).",
            ));
        }

        // 3) Timestamp
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // 4) Abrir sessão e criar DID local (keypair)
        let mut session = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro sessão: {}", e)))?;

        // Gerar chave (igual create_own_did v1)
        let key = LocalKey::generate_with_rng(KeyAlg::Ed25519, false)
            .map_err(|e| Error::from_reason(format!("Erro gerar chave: {}", e)))?;

        let verkey_bytes = key
            .to_public_bytes()
            .map_err(|e| Error::from_reason(format!("Erro verkey bytes: {}", e)))?;

        // DID Indy: primeiros 16 bytes da verkey em base58
        let did_bytes = &verkey_bytes[0..16];
        let did = bs58::encode(did_bytes).into_string();
        let verkey = bs58::encode(&verkey_bytes).into_string();

        // 5) Salvar chave privada no KMS (idempotente)
        let key_exists = session
            .fetch_key(&verkey, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro check key: {}", e)))?
            .is_some();

        if !key_exists {
            session
                .insert_key(&verkey, &key, Some("ed25519"), None, None, None)
                .await
                .map_err(|e| Error::from_reason(format!("Erro salvar Key: {}", e)))?;
        }

        // 6) Salvar DidRecord v1 já padronizado (sem seed)
        let did_record = json!({
            "did": did,
            "verkey": verkey,
            "method": "sov",
            "alias": alias,
            "type": "own",
            "origin": "generated",
            "createdAt": created_at,
            "isPublic": false,
            "role": serde_json::Value::Null
        });

        let tags = vec![
            EntryTag::Encrypted("type".to_string(), "own".to_string()),
            EntryTag::Encrypted(
                "verkey".to_string(),
                did_record["verkey"].as_str().unwrap_or("").to_string(),
            ),
            EntryTag::Encrypted(
                "alias".to_string(),
                did_record["alias"].as_str().unwrap_or("").to_string(),
            ),
            EntryTag::Encrypted("createdAt".to_string(), created_at.to_string()),
            EntryTag::Encrypted("isPublic".to_string(), "false".to_string()),
            EntryTag::Encrypted("origin".to_string(), "generated".to_string()),
            EntryTag::Encrypted("role".to_string(), "none".to_string()),
        ];

        let did_str = did_record["did"].as_str().unwrap_or("").to_string();
        let verkey_str = did_record["verkey"].as_str().unwrap_or("").to_string();

        let did_exists = session
            .fetch("did", &did_str, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro check DID: {}", e)))?
            .is_some();

        if !did_exists {
            session
                .insert(
                    "did",
                    &did_str,
                    did_record.to_string().as_bytes(),
                    Some(&tags),
                    None,
                )
                .await
                .map_err(|e| Error::from_reason(format!("Erro salvar DID record: {}", e)))?;
        }

        // 7) Commit do DID local primeiro
        session
            .commit()
            .await
            .map_err(|e| Error::from_reason(format!("Erro commit DID local: {}", e)))?;

        // 8) Se não for público, retornar aqui
        if !make_public {
            let out = json!({
                "ok": true,
                "did": did_str,
                "verkey": verkey_str,
                "isPublic": false,
                "role": serde_json::Value::Null,
                "createdAt": created_at
            });
            return serde_json::to_string(&out)
                .map_err(|e| Error::from_reason(format!("Erro serializar retorno: {}", e)));
        }

        // 9) Publicação no ledger (NYM) — exige pool conectado
        let pool = match &self.pool {
            Some(p) => p.clone(),
            None => {
                return Err(Error::from_reason(
                    "Não conectado à rede. Execute connect_network antes.",
                ))
            }
        };

        // 9.1) Política: ENDORSER exige TRUSTEE (best-effort via GET_NYM do submitter)
        if require_trustee && role_norm_up == "ENDORSER" {
            let submitter_nym = ledger::get_nym(&pool, &submitter_did).await.map_err(|e| {
                Error::from_reason(format!("Falha ao resolver submitterDid no ledger: {}", e))
            })?;

            // Tenta extrair role do GET_NYM (em Indy, data pode vir como string JSON)
            let role_ok = (|| -> Option<bool> {
                let root: serde_json::Value = serde_json::from_str(&submitter_nym).ok()?;
                let data = root.get("result")?.get("data")?;

                // data pode vir como string JSON ou objeto
                let data_obj: serde_json::Value = if data.is_string() {
                    serde_json::from_str::<serde_json::Value>(data.as_str()?).ok()?
                } else {
                    data.clone()
                };

                let role_val = data_obj.get("role")?;

                // Aceita "0" (trustee) ou "TRUSTEE"
                if role_val.is_string() {
                    let s = role_val.as_str()?.to_uppercase();
                    return Some(s == "TRUSTEE" || s == "0");
                }

                if role_val.is_number() {
                    return Some(role_val.as_i64()? == 0);
                }

                Some(false)
            })()
            .unwrap_or(false);

            if !role_ok {
                return Err(Error::from_reason(
                "Política: role ENDORSER exige submitterDid TRUSTEE (não foi possível validar como TRUSTEE no ledger).",
            ));
            }
        }

        // 9.2) Montar NYM (mesma lógica do register_did_on_ledger, sem Env)
        let rb = indy_vdr::ledger::RequestBuilder::new(indy_vdr::pool::ProtocolVersion::Node1_4);

        // A) TAA
        let taa_req = rb
            .build_get_txn_author_agreement_request(None, None)
            .map_err(|e| Error::from_reason(format!("Erro build TAA req: {}", e)))?;

        let taa_resp = send_request_async(&pool, taa_req).await?;
        let taa_val: serde_json::Value = serde_json::from_str(&taa_resp)
            .map_err(|e| Error::from_reason(format!("Erro parse TAA response: {}", e)))?;

        let taa_acceptance = if !taa_val["result"]["data"].is_null() {
            let text = taa_val["result"]["data"]["text"].as_str();
            let version = taa_val["result"]["data"]["version"].as_str();
            let digest = taa_val["result"]["data"]["digest"].as_str();

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
                .map_err(|e| Error::from_reason(format!("Erro prepare TAA data: {}", e)))?,
            )
        } else {
            None
        };

        // B) Role
        let role_enum = match role_for_ledger.as_deref() {
            Some("ENDORSER") => Some(indy_vdr::ledger::constants::UpdateRole::Set(
                indy_vdr::ledger::constants::LedgerRole::Endorser,
            )),
            Some("TRUSTEE") => Some(indy_vdr::ledger::constants::UpdateRole::Set(
                indy_vdr::ledger::constants::LedgerRole::Trustee,
            )),
            Some("STEWARD") => Some(indy_vdr::ledger::constants::UpdateRole::Set(
                indy_vdr::ledger::constants::LedgerRole::Steward,
            )),
            _ => None,
        };

        let submitter = indy_vdr::utils::did::DidValue(submitter_did.clone());
        let target = indy_vdr::utils::did::DidValue(did_str.clone());

        let mut req = rb
            .build_nym_request(
                &submitter,
                &target,
                Some(verkey_str.clone()),
                None,
                role_enum,
                None,
                None,
            )
            .map_err(|e| Error::from_reason(format!("Erro build NYM: {}", e)))?;

        if let Some(taa) = taa_acceptance {
            req.set_txn_author_agreement_acceptance(&taa)
                .map_err(|e| Error::from_reason(format!("Erro anexando TAA: {}", e)))?;
        }

        // C) Assinar com o submitter
        let mut session2 = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro sessão wallet: {}", e)))?;

        let did_entry = session2
            .fetch("did", &submitter_did, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro DB fetch submitter DID: {}", e)))?
            .ok_or_else(|| {
                Error::from_reason(format!("DID Submitter {} não encontrado", submitter_did))
            })?;

        let did_json: serde_json::Value = serde_json::from_slice(&did_entry.value)
            .map_err(|e| Error::from_reason(format!("JSON inválido no submitter DID: {}", e)))?;

        let submitter_verkey_ref = did_json["verkey"]
            .as_str()
            .ok_or_else(|| Error::from_reason("Campo verkey ausente no registro do submitter"))?;

        let key_entry = session2
            .fetch_key(submitter_verkey_ref, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro fetch key submitter: {}", e)))?
            .ok_or_else(|| Error::from_reason("Chave privada do submitter não encontrada"))?;

        let local_key = key_entry
            .load_local_key()
            .map_err(|e| Error::from_reason(format!("Erro load key: {}", e)))?;

        let signature_input = req
            .get_signature_input()
            .map_err(|e| Error::from_reason(format!("Erro sig input: {}", e)))?;

        let signature = local_key
            .sign_message(signature_input.as_bytes(), None)
            .map_err(|e| Error::from_reason(format!("Erro assinando: {}", e)))?;

        req.set_signature(&signature)
            .map_err(|e| Error::from_reason(format!("Erro set sig: {}", e)))?;

        // D) Enviar
        let ledger_response = send_request_async(&pool, req).await?;

        // 10) Atualizar DID record (isPublic=true e role) — transação atômica
        let mut session3 = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro sessão wallet (update DID): {}", e)))?;

        // Buscar o record atual para preservar createdAt/alias
        let current = session3
            .fetch("did", &did_str, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro fetch DID (update): {}", e)))?
            .ok_or_else(|| Error::from_reason("DID recém-criado não encontrado para update"))?;

        let mut cur_val: serde_json::Value = serde_json::from_slice(&current.value)
            .map_err(|e| Error::from_reason(format!("Erro parse DID atual: {}", e)))?;

        if let Some(obj) = cur_val.as_object_mut() {
            obj.insert("isPublic".to_string(), serde_json::Value::Bool(true));
            if let Some(r) = &role_for_ledger {
                obj.insert("role".to_string(), serde_json::Value::String(r.clone()));
            } else {
                obj.insert("role".to_string(), serde_json::Value::Null);
            }
            obj.insert("ledger".to_string(), json!({
            "registeredAt": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
            "submitterDid": submitter_did
        }));
        }

        // Recriar tags (compatível com seu Askar: não há update)
        let alias_final = cur_val
            .get("alias")
            .and_then(|x| x.as_str())
            .unwrap_or("Meu DID");
        let role_tag = role_for_ledger
            .clone()
            .unwrap_or_else(|| "none".to_string());

        let tags3 = vec![
            EntryTag::Encrypted("type".to_string(), "own".to_string()),
            EntryTag::Encrypted("verkey".to_string(), verkey_str.clone()),
            EntryTag::Encrypted("alias".to_string(), alias_final.to_string()),
            EntryTag::Encrypted("createdAt".to_string(), created_at.to_string()),
            EntryTag::Encrypted("isPublic".to_string(), "true".to_string()),
            EntryTag::Encrypted("origin".to_string(), "generated".to_string()),
            EntryTag::Encrypted("role".to_string(), role_tag),
        ];

        // ATENÇÃO: remove+insert no mesmo commit => atômico
        session3
            .remove("did", &did_str)
            .await
            .map_err(|e| Error::from_reason(format!("Erro remove DID (update): {}", e)))?;

        session3
            .insert(
                "did",
                &did_str,
                cur_val.to_string().as_bytes(),
                Some(&tags3),
                None,
            )
            .await
            .map_err(|e| Error::from_reason(format!("Erro insert DID (update): {}", e)))?;

        session3
            .commit()
            .await
            .map_err(|e| Error::from_reason(format!("Erro commit update DID: {}", e)))?;

        // 11) Retorno final
        let out = json!({
            "ok": true,
            "did": did_str,
            "verkey": verkey_str,
            "isPublic": true,
            "role": role_for_ledger.clone().map(serde_json::Value::String).unwrap_or(serde_json::Value::Null),
            "createdAt": created_at,
            "ledgerResponse": ledger_response
        });

        serde_json::to_string(&out)
            .map_err(|e| Error::from_reason(format!("Erro serializar retorno: {}", e)))
    }

    // =========================================================
    // 5) Import v2 por seed (seed nunca é retornada)
    // =========================================================

    #[napi]
    pub async unsafe fn import_did_from_seed_v2(
        &mut self,
        seed: String, // aceita HEX (64 chars) OU Base64
        alias: Option<String>,
    ) -> Result<String> {
        // 1) Wallet aberta?
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        // 2) Decode seed -> 32 bytes
        let seed_trim = seed.trim().to_string();

        // helper: decode hex (64 chars)
        fn decode_hex_32(s: &str) -> Option<[u8; 32]> {
            if s.len() != 64 {
                return None;
            }
            if !s
                .bytes()
                .all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F'))
            {
                return None;
            }
            let mut out = [0u8; 32];
            for i in 0..32 {
                let hi = u8::from_str_radix(&s[i * 2..i * 2 + 1], 16).ok()?;
                let lo = u8::from_str_radix(&s[i * 2 + 1..i * 2 + 2], 16).ok()?;
                out[i] = (hi << 4) | lo;
            }
            Some(out)
        }

        let seed_bytes: [u8; 32] = if let Some(h) = decode_hex_32(&seed_trim) {
            h
        } else {
            // Base64 (standard). Se quiser suportar URL-safe também, eu ajusto.
            let decoded = general_purpose::STANDARD
                .decode(seed_trim.as_bytes())
                .map_err(|e| Error::from_reason(format!("Seed inválida (hex/base64): {}", e)))?;

            if decoded.len() != 32 {
                return Err(Error::from_reason(format!(
                    "Seed inválida: esperado 32 bytes após decode, veio {} bytes",
                    decoded.len()
                )));
            }

            let mut arr = [0u8; 32];
            arr.copy_from_slice(&decoded);
            arr
        };

        // 3) Derivar LocalKey a partir da seed
        let key = LocalKey::from_secret_bytes(KeyAlg::Ed25519, &seed_bytes)
            .map_err(|e| Error::from_reason(format!("Erro derivar chave da seed: {}", e)))?;

        let verkey_bytes = key
            .to_public_bytes()
            .map_err(|e| Error::from_reason(format!("Erro obter verkey bytes: {}", e)))?;

        let did_bytes = &verkey_bytes[0..16];
        let did = bs58::encode(did_bytes).into_string();
        let verkey = bs58::encode(&verkey_bytes).into_string();

        // 4) createdAt
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // 5) Abrir sessão
        let mut session = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro sessão: {}", e)))?;

        // 6) Idempotência/Conflito:
        //    - se DID já existe e verkey for diferente => erro
        //    - se já existe igual => ok (não duplica)
        let existing = session
            .fetch("did", &did, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro fetch DID: {}", e)))?;

        if let Some(e) = existing {
            let s = String::from_utf8(e.value.to_vec()).unwrap_or_default();
            if let Ok(ev) = serde_json::from_str::<serde_json::Value>(&s) {
                let existing_vk = ev.get("verkey").and_then(|x| x.as_str()).unwrap_or("");
                if !existing_vk.is_empty() && existing_vk != verkey {
                    return Err(Error::from_reason(format!(
                    "Conflito: DID já existe com verkey diferente. did={} existing_verkey={} new_verkey={}",
                    did, existing_vk, verkey
                )));
                }
            }

            // garantir que a key existe no KMS
            let key_exists = session
                .fetch_key(&verkey, false)
                .await
                .map_err(|e| Error::from_reason(format!("Erro check key: {}", e)))?
                .is_some();

            if !key_exists {
                session
                    .insert_key(&verkey, &key, Some("ed25519"), None, None, None)
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro inserir key: {}", e)))?;
                session
                    .commit()
                    .await
                    .map_err(|e| Error::from_reason(format!("Erro commit: {}", e)))?;
            }

            let out = json!({
                "ok": true,
                "did": did,
                "verkey": verkey,
                "origin": "imported_seed",
                "createdAt": created_at
            });
            return serde_json::to_string(&out)
                .map_err(|e| Error::from_reason(format!("Erro serializar retorno: {}", e)));
        }

        // 7) Inserir key no KMS se não existir
        let key_exists = session
            .fetch_key(&verkey, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro check key: {}", e)))?
            .is_some();

        if !key_exists {
            session
                .insert_key(&verkey, &key, Some("ed25519"), None, None, None)
                .await
                .map_err(|e| Error::from_reason(format!("Erro inserir key: {}", e)))?;
        }

        // 8) Inserir DidRecord v1 (type=own, origin=imported_seed)
        let alias_final = alias.unwrap_or_else(|| "Seed DID".to_string());

        let record = json!({
            "did": did,
            "verkey": verkey,
            "method": "sov",
            "alias": alias_final,
            "type": "own",
            "origin": "imported_seed",
            "createdAt": created_at,
            "isPublic": false,
            "role": serde_json::Value::Null
        });

        let tags = vec![
            EntryTag::Encrypted("type".to_string(), "own".to_string()),
            EntryTag::Encrypted(
                "verkey".to_string(),
                record["verkey"].as_str().unwrap_or("").to_string(),
            ),
            EntryTag::Encrypted(
                "alias".to_string(),
                record["alias"].as_str().unwrap_or("").to_string(),
            ),
            EntryTag::Encrypted("createdAt".to_string(), created_at.to_string()),
            EntryTag::Encrypted("isPublic".to_string(), "false".to_string()),
            EntryTag::Encrypted("origin".to_string(), "imported_seed".to_string()),
            EntryTag::Encrypted("role".to_string(), "none".to_string()),
        ];

        session
            .insert(
                "did",
                record["did"].as_str().unwrap_or(""),
                record.to_string().as_bytes(),
                Some(&tags),
                None,
            )
            .await
            .map_err(|e| Error::from_reason(format!("Erro inserir DID record: {}", e)))?;

        session
            .commit()
            .await
            .map_err(|e| Error::from_reason(format!("Erro commit: {}", e)))?;

        // 9) Retorno
        let out = json!({
            "ok": true,
            "did": record["did"],
            "verkey": record["verkey"],
            "origin": "imported_seed",
            "createdAt": created_at
        });

        serde_json::to_string(&out)
            .map_err(|e| Error::from_reason(format!("Erro serializar retorno: {}", e)))
    }

    // -------------------------------------------------------------------------------------------
    #[napi]
    pub fn create_own_did(&self, env: Env) -> Result<JsObject> {
        // 1. Clonar Store (Thread-safe)
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        env.execute_tokio_future(
            async move {
                // 2. Sessão Efêmera
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão: {}", e)))?;

                // 3. Gerar Par de Chaves (Ed25519)
                let key = LocalKey::generate_with_rng(KeyAlg::Ed25519, false)
                    .map_err(|e| napi::Error::from_reason(format!("Erro gerar chave: {}", e)))?;

                let verkey_bytes = key
                    .to_public_bytes()
                    .map_err(|e| napi::Error::from_reason(format!("Erro verkey bytes: {}", e)))?;

                // 4. Calcular DID (Padrão Indy: Primeiros 16 bytes da Verkey em Base58)
                let did_bytes = &verkey_bytes[0..16];
                let did = bs58::encode(did_bytes).into_string();
                let verkey = bs58::encode(&verkey_bytes).into_string();

                // 5. Salvar Chave Privada (KMS)
                // CORREÇÃO: Removido .unwrap(). Usamos map_err para segurança.
                let key_exists = session
                    .fetch_key(&verkey, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro check key: {}", e)))?
                    .is_some();

                if !key_exists {
                    session
                        .insert_key(&verkey, &key, Some("ed25519"), None, None, None)
                        .await
                        .map_err(|e| napi::Error::from_reason(format!("Erro salvar Key: {}", e)))?;
                }

                // 6. Salvar Metadados do DID
                // 6. Salvar Metadados do DID (PR-01: DidRecord v1 completo)
                let created_at = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();

                let metadata = serde_json::json!({
                    "did": did,
                    "verkey": verkey,
                    "method": "sov",
                    "alias": "Meu DID",
                    "type": "own",
                    "origin": "generated",
                    "createdAt": created_at,
                    "isPublic": false,
                    "role": serde_json::Value::Null
                });

                let tags = vec![
                    EntryTag::Encrypted("type".to_string(), "own".to_string()),
                    EntryTag::Encrypted("verkey".to_string(), verkey.clone()),
                    EntryTag::Encrypted("alias".to_string(), "Meu DID".to_string()),
                    EntryTag::Encrypted("createdAt".to_string(), created_at.to_string()),
                    EntryTag::Encrypted("isPublic".to_string(), "false".to_string()),
                    EntryTag::Encrypted("origin".to_string(), "generated".to_string()),
                    EntryTag::Encrypted("role".to_string(), "none".to_string()),
                ];

                // CORREÇÃO: Removido .unwrap() aqui também.
                let did_exists = session
                    .fetch("did", &did, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro check DID: {}", e)))?
                    .is_some();

                if !did_exists {
                    session
                        .insert(
                            "did",
                            &did,
                            metadata.to_string().as_bytes(),
                            Some(&tags),
                            None,
                        )
                        .await
                        .map_err(|e| {
                            napi::Error::from_reason(format!("Erro salvar Metadata: {}", e))
                        })?;
                }

                // 7. Commit (Obrigatório)
                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro commit DID: {}", e)))?;

                let result = vec![did, verkey];
                Ok(result)
            },
            |&mut env, data| {
                let mut arr = env.create_array(2)?;
                arr.set(0, env.create_string(&data[0])?)?;
                arr.set(1, env.create_string(&data[1])?)?;
                Ok(arr)
            },
        )
    }

    // --------------------------------------------------------
    #[napi]
    pub async unsafe fn store_their_did(
        &mut self,
        did: String,
        verkey: String,
        alias: String,
    ) -> Result<String> {
        // 1) Obter clone do Store (thread-safe)
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Carteira fechada!")),
        };

        // 2) Criar sessão EFÊMERA
        let mut session = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro ao criar sessão: {}", e)))?;

        // 3) Verificar existência (Idempotência)
        let existing = session
            .fetch("did", &did, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro fetch: {}", e)))?;

        if existing.is_some() {
            return Ok(did);
        }

        // 4) createdAt (epoch)
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // 🔒 Clones necessários para evitar "move" antes do insert/return
        let did_key = did.clone();
        let verkey_tag = verkey.clone();
        let alias_tag = alias.clone();

        // 5) Tags padronizadas (PR-01)
        let tags = vec![
            EntryTag::Encrypted("type".to_string(), "external".to_string()),
            EntryTag::Encrypted("verkey".to_string(), verkey_tag),
            EntryTag::Encrypted("alias".to_string(), alias_tag),
            EntryTag::Encrypted("createdAt".to_string(), created_at.to_string()),
            EntryTag::Encrypted("isPublic".to_string(), "false".to_string()),
            EntryTag::Encrypted("origin".to_string(), "imported_json".to_string()),
            EntryTag::Encrypted("role".to_string(), "none".to_string()),
        ];

        // 6) DidRecord v1 padronizado (JSON armazenado) — NUNCA inclui seed
        let metadata = json!({
            "did": did,
            "verkey": verkey,
            "method": "sov",
            "alias": alias,
            "type": "external",
            "origin": "imported_json",
            "createdAt": created_at,
            "isPublic": false,
            "role": serde_json::Value::Null
        })
        .to_string();

        // 7) Inserir
        session
            .insert("did", &did_key, metadata.as_bytes(), Some(&tags), None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro ao salvar DID externo: {}", e)))?;

        // 8) COMMIT (Obrigatório)
        session
            .commit()
            .await
            .map_err(|e| Error::from_reason(format!("Erro ao commitar DID externo: {}", e)))?;

        Ok(did_key)
    }

    #[napi]
    pub async unsafe fn list_dids(&self, category_type: String) -> Result<String> {
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Carteira fechada!")),
        };

        let mut session = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro Sessão: {}", e)))?;

        let category_norm = category_type.trim().to_lowercase();
        if category_norm != "own" && category_norm != "external" {
            return Err(Error::from_reason(format!(
                "category_type inválido: {} (use 'own' ou 'external')",
                category_type
            )));
        }

        // Filtra pela tag "type" ("own" ou "external")
        let filter = TagFilter::is_eq("type", category_norm.clone());

        let entries = session
            .fetch_all(Some("did"), Some(filter), None, None, false, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro busca: {}", e)))?;

        let mut results: Vec<serde_json::Value> = Vec::new();

        for entry in entries {
            let s = match String::from_utf8(entry.value.to_vec()) {
                Ok(x) => x,
                Err(_) => continue,
            };

            let mut v: serde_json::Value = match serde_json::from_str::<serde_json::Value>(&s) {
                Ok(x) => x,
                Err(_) => continue, // ignora JSON corrompido
            };

            // Normalização PR-01 (sem quebrar legados)
            if let Some(obj) = v.as_object_mut() {
                // hardening: remover possíveis campos sensíveis se existirem por acidente
                obj.remove("seed");
                obj.remove("seedHex");
                obj.remove("seedB64");
                obj.remove("privateKey");
                obj.remove("secret");

                if obj.get("method").is_none() {
                    obj.insert(
                        "method".to_string(),
                        serde_json::Value::String("sov".to_string()),
                    );
                }

                if obj.get("type").is_none() {
                    obj.insert(
                        "type".to_string(),
                        serde_json::Value::String(category_norm.clone()),
                    );
                }

                if obj.get("createdAt").is_none() {
                    obj.insert("createdAt".to_string(), serde_json::Value::Number(0.into()));
                }

                if obj.get("isPublic").is_none() {
                    obj.insert("isPublic".to_string(), serde_json::Value::Bool(false));
                }

                if obj.get("origin").is_none() {
                    obj.insert(
                        "origin".to_string(),
                        serde_json::Value::String("legacy".to_string()),
                    );
                }

                if obj.get("role").is_none() {
                    obj.insert("role".to_string(), serde_json::Value::Null);
                }
            } else {
                continue;
            }

            results.push(v);
        }

        serde_json::to_string(&results)
            .map_err(|e| Error::from_reason(format!("Erro serializar lista: {}", e)))
    }

        // --------------------------------------------------------
    // OTIMIZAÇÃO: Alterado de &mut self para &self
    // Isso permite múltiplas consultas simultâneas ao ledger sem travar o agente.
    #[napi]
    pub async unsafe fn resolve_did_on_ledger(&self, did_to_fetch: String) -> Result<String> {
        let pool = match &self.pool {
            Some(p) => p.clone(), // clone do Arc para ficar estável nos awaits
            None => return Err(Error::from_reason("Não conectado à rede (Pool closed)")),
        };

        let did = did_to_fetch.trim().to_string();
        if did.is_empty() {
            return Err(Error::from_reason("did_to_fetch vazio"));
        }

        // Defaults conservadores (podem ser ajustados via env vars)
        let tries: u32 = std::env::var("SSI_RESOLVE_TRIES")
            .ok()
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(10);

        let delay_ms: u64 = std::env::var("SSI_RESOLVE_DELAY_MS")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(400);

        // Helper: retorna true se o GET_NYM trouxe data útil
        fn has_nym_data(resp: &str) -> bool {
            let v: serde_json::Value = match serde_json::from_str(resp) {
                Ok(x) => x,
                Err(_) => return false,
            };

            let data = v.get("result").and_then(|r| r.get("data"));
            match data {
                Some(serde_json::Value::String(s)) => !s.trim().is_empty() && s.trim() != "null",
                Some(serde_json::Value::Object(_)) => true,
                Some(serde_json::Value::Null) | None => false,
                _ => false,
            }
        }

        let mut last_resp: Option<String> = None;

        for attempt in 1..=tries {
            let resp = ledger::get_nym(&pool, &did)
                .await
                .map_err(|e| Error::from_reason(e))?;

            if has_nym_data(&resp) {
                return Ok(resp);
            }

            last_resp = Some(resp);

            // Se ainda não achou, aguarda e tenta de novo (evita falso "não encontrado")
            if attempt < tries {
                sleep(Duration::from_millis(delay_ms)).await;
            }
        }

        // Não achou data após retries: mantém compatibilidade retornando a última resposta do ledger
        Ok(
            last_resp
                .unwrap_or_else(|| "{\"ok\":false,\"message\":\"empty response\"}".to_string()),
        )
    }

    // =========================================================================
    // ... (outros métodos anteriores)

    /// Cria/Importa um DID a partir de uma SEED (String de 32 caracteres)
    /// Útil para importar DIDs fixos de redes como Indicio ou Sovrin
    #[napi]
    pub fn import_did_from_seed(&self, env: Env, seed: String) -> Result<JsObject> {
        let store = match &self.store {
            Some(s) => s.clone(),
            None => {
                return Err(napi::Error::from_reason(
                    "Carteira não inicializada. Execute create/open antes.",
                ))
            }
        };

        env.execute_tokio_future(
            async move {
                let mut session = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(e.to_string()))?;

                if seed.len() != 32 {
                    return Err(napi::Error::from_reason("Seed deve ter 32 caracteres."));
                }
                let secret_bytes = seed.as_bytes();

                // 1. Gerar chaves
                let key = LocalKey::from_secret_bytes(KeyAlg::Ed25519, secret_bytes)
                    .map_err(|e| napi::Error::from_reason(e.to_string()))?;

                let pub_bytes = key
                    .to_public_bytes()
                    .map_err(|e| napi::Error::from_reason(e.to_string()))?;

                let verkey = bs58::encode(&pub_bytes).into_string();
                let did = bs58::encode(&pub_bytes[0..16]).into_string();

                // 2. Verificar duplicidade (Idempotência)
                let existing_key = session.fetch_key(&verkey, false).await.map_err(|e| {
                    napi::Error::from_reason(format!("Erro ao verificar chave: {}", e))
                })?;

                if existing_key.is_some() {
                    return Ok(vec![did, verkey]);
                }

                // 3. Inserir Chave
                session
                    .insert_key(&verkey, &key, Some("ed25519"), None, None, None)
                    .await
                    .map_err(|e| napi::Error::from_reason(e.to_string()))?;

                // 4. Preparar Metadados
                // CLONE 1: Clonamos verkey aqui para não perder a posse dela
                let record = serde_json::json!({
                    "did": did,
                    "verkey": verkey.clone(),
                    "metadata": "Imported via Seed (Indicio)"
                });

                // 5. Preparar Tags
                // CLONE 2: Clonamos verkey AQUI TAMBÉM.
                // Isso resolve o erro "use of moved value" no return final.
                let tags = vec![
                    EntryTag::Encrypted("type".to_string(), "own".to_string()),
                    EntryTag::Encrypted("verkey".to_string(), verkey.clone()),
                ];

                // 6. Inserir Registro (Usando metadata e tags)
                session
                    .insert(
                        "did",
                        &did,
                        record.to_string().as_bytes(),
                        Some(&tags),
                        None,
                    )
                    .await
                    .map_err(|e| napi::Error::from_reason(e.to_string()))?;

                // 7. Commit
                session
                    .commit()
                    .await
                    .map_err(|e| napi::Error::from_reason(e.to_string()))?;

                // RETORNO: Aqui usamos a variável original 'verkey' (Move final)
                Ok(vec![did, verkey])
            },
            |&mut env, data| {
                let mut arr = env.create_array(data.len() as u32)?;
                for (i, val) in data.into_iter().enumerate() {
                    arr.set(i as u32, env.create_string(&val)?)?;
                }
                Ok(arr)
            },
        )
    }

    // =========================================================================
    //  MÉTODOS DE REDE - REGISTRAR DID (COM SUPORTE A TAA)
    // =========================================================================
    #[napi]
    pub fn register_did_on_ledger(
        &self,
        env: Env,
        _genesis_path: String, // Mantido para compatibilidade, mas não usado (usamos o pool conectado)
        submitter_did: String,
        target_did: String,
        target_verkey: String,
        role: Option<String>,
    ) -> Result<JsObject> {
        // 1. Validar Store (Wallet)
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        // 2. Validar Pool (Rede) - Usamos a conexão persistente (Arc)
        let pool = match &self.pool {
            Some(p) => p.clone(), // Clone barato do Arc
            None => {
                return Err(Error::from_reason(
                    "Não conectado à rede. Execute connect_network antes.",
                ))
            }
        };

        env.execute_tokio_future(
        async move {
            let rb = indy_vdr::ledger::RequestBuilder::new(indy_vdr::pool::ProtocolVersion::Node1_4);

            // Guardar cópias para a fase de update local
            let target_did_s = target_did.clone();
            let target_verkey_s = target_verkey.clone();

            // Normalizar role para reuso (ledger + record)
            let role_up = role.as_ref().map(|s| s.trim().to_uppercase());
            let role_tag = match role_up.as_deref() {
                Some("ENDORSER") | Some("TRUSTEE") | Some("STEWARD") => role_up.clone().unwrap(),
                _ => "none".to_string(),
            };

            // =================================================================
            // A. TAA (TRANSACTION AUTHOR AGREEMENT)
            // =================================================================
            let taa_req = rb
                .build_get_txn_author_agreement_request(None, None)
                .map_err(|e| napi::Error::from_reason(format!("Erro build TAA req: {}", e)))?;

            let taa_resp = send_request_async(&pool, taa_req).await?;
            let taa_val: serde_json::Value = serde_json::from_str(&taa_resp).map_err(|e| {
                napi::Error::from_reason(format!("Erro parse TAA response: {}", e))
            })?;

            let taa_acceptance = if !taa_val["result"]["data"].is_null() {
                let text = taa_val["result"]["data"]["text"].as_str();
                let version = taa_val["result"]["data"]["version"].as_str();
                let digest = taa_val["result"]["data"]["digest"].as_str();

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
                    .map_err(|e| napi::Error::from_reason(format!("Erro prepare TAA data: {}", e)))?,
                )
            } else {
                None
            };

            // =================================================================
            // B. CONSTRUÇÃO DA TRANSAÇÃO NYM
            // =================================================================

            let role_enum = match role_up.as_deref() {
                Some("ENDORSER") => Some(indy_vdr::ledger::constants::UpdateRole::Set(
                    indy_vdr::ledger::constants::LedgerRole::Endorser,
                )),
                Some("TRUSTEE") => Some(indy_vdr::ledger::constants::UpdateRole::Set(
                    indy_vdr::ledger::constants::LedgerRole::Trustee,
                )),
                Some("STEWARD") => Some(indy_vdr::ledger::constants::UpdateRole::Set(
                    indy_vdr::ledger::constants::LedgerRole::Steward,
                )),
                _ => None,
            };

            let submitter = indy_vdr::utils::did::DidValue(submitter_did.clone());
            let target = indy_vdr::utils::did::DidValue(target_did);

            let mut req = rb
                .build_nym_request(
                    &submitter,
                    &target,
                    Some(target_verkey),
                    None,
                    role_enum,
                    None,
                    None,
                )
                .map_err(|e| napi::Error::from_reason(format!("Erro build NYM: {}", e)))?;

            if let Some(taa) = taa_acceptance {
                req.set_txn_author_agreement_acceptance(&taa)
                    .map_err(|e| napi::Error::from_reason(format!("Erro anexando TAA: {}", e)))?;
            }

            // =================================================================
            // C. ASSINATURA
            // =================================================================
            let mut session = store
                .session(None)
                .await
                .map_err(|e| napi::Error::from_reason(format!("Erro sessão wallet: {}", e)))?;

            let did_entry = session
                .fetch("did", &submitter_did, false)
                .await
                .map_err(|e| napi::Error::from_reason(format!("Erro DB fetch: {}", e)))?
                .ok_or_else(|| {
                    napi::Error::from_reason(format!("DID Submitter {} não encontrado", submitter_did))
                })?;

            let did_json: serde_json::Value = serde_json::from_slice(&did_entry.value)
                .map_err(|e| napi::Error::from_reason(format!("JSON inválido: {}", e)))?;

            let submitter_verkey_ref = did_json["verkey"]
                .as_str()
                .ok_or_else(|| napi::Error::from_reason("Campo verkey ausente no registro"))?;

            let key_entry = session
                .fetch_key(submitter_verkey_ref, false)
                .await
                .map_err(|e| napi::Error::from_reason(format!("Erro fetch key: {}", e)))?
                .ok_or_else(|| napi::Error::from_reason("Chave privada não encontrada"))?;

            let local_key = key_entry
                .load_local_key()
                .map_err(|e| napi::Error::from_reason(format!("Erro load key: {}", e)))?;

            let signature_input = req
                .get_signature_input()
                .map_err(|e| napi::Error::from_reason(format!("Erro sig input: {}", e)))?;

            let signature = local_key
                .sign_message(signature_input.as_bytes(), None)
                .map_err(|e| napi::Error::from_reason(format!("Erro assinando: {}", e)))?;

            req.set_signature(&signature)
                .map_err(|e| napi::Error::from_reason(format!("Erro set sig: {}", e)))?;

            // =================================================================
            // D. ENVIO
            // =================================================================
            let response = send_request_async(&pool, req).await?;

            // =================================================================
            // E. UPDATE LOCAL (PR-01) - se sucesso e target existir
            // =================================================================
            let is_reply = serde_json::from_str::<serde_json::Value>(&response)
                .ok()
                .and_then(|v| v.get("op").and_then(|x| x.as_str()).map(|s| s == "REPLY"))
                .unwrap_or(false);

            if is_reply {
                let mut session_upd = store
                    .session(None)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro sessão wallet (update): {}", e)))?;

                let target_entry_opt = session_upd
                    .fetch("did", &target_did_s, false)
                    .await
                    .map_err(|e| napi::Error::from_reason(format!("Erro fetch target DID: {}", e)))?;

                if let Some(target_entry) = target_entry_opt {
                    // Parse do record (fallback se legado/ruim)
                    let mut rec: serde_json::Value = serde_json::from_slice(&target_entry.value).unwrap_or_else(|_| {
                        serde_json::json!({
                            "did": target_did_s,
                            "verkey": target_verkey_s,
                            "method": "sov",
                            "alias": "Meu DID",
                            "type": "own",
                            "origin": "legacy",
                            "createdAt": 0,
                            "isPublic": false,
                            "role": serde_json::Value::Null
                        })
                    });

                    // Hardening: garantir objeto
                    if !rec.is_object() {
                        rec = serde_json::json!({
                            "did": target_did_s,
                            "verkey": target_verkey_s,
                            "method": "sov",
                            "alias": "Meu DID",
                            "type": "own",
                            "origin": "legacy",
                            "createdAt": 0,
                            "isPublic": false,
                            "role": serde_json::Value::Null
                        });
                    }

                    // Validar conflito de verkey (se existir no record)
                    let existing_vk = rec.get("verkey").and_then(|x| x.as_str()).unwrap_or("");
                    if !existing_vk.is_empty() && existing_vk != target_verkey_s {
                        return Err(napi::Error::from_reason(format!(
                            "Conflito: target DID já existe com verkey diferente. did={} existing_verkey={} new_verkey={}",
                            target_did_s, existing_vk, target_verkey_s
                        )));
                    }

                    // Normalização mínima PR-01
                    let created_at = rec.get("createdAt").and_then(|x| x.as_u64()).unwrap_or(0);
                    let alias = rec.get("alias").and_then(|x| x.as_str()).unwrap_or("Meu DID").to_string();
                    let origin = rec.get("origin").and_then(|x| x.as_str()).unwrap_or("legacy").to_string();
                    let type_field = rec.get("type").and_then(|x| x.as_str()).unwrap_or("own").to_string();

                    // Atualizar campos de “publicação”
                    if let Some(obj) = rec.as_object_mut() {
                        obj.insert("did".to_string(), serde_json::Value::String(target_did_s.clone()));
                        obj.insert("verkey".to_string(), serde_json::Value::String(target_verkey_s.clone()));
                        if obj.get("method").is_none() {
                            obj.insert("method".to_string(), serde_json::Value::String("sov".to_string()));
                        }

                        obj.insert("isPublic".to_string(), serde_json::Value::Bool(true));

                        // role no record: String somente se for uma das conhecidas
                        match role_up.as_deref() {
                            Some("ENDORSER") | Some("TRUSTEE") | Some("STEWARD") => {
                                obj.insert("role".to_string(), serde_json::Value::String(role_up.clone().unwrap()));
                            }
                            _ => {
                                obj.insert("role".to_string(), serde_json::Value::Null);
                            }
                        }

                        let registered_at = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();

                        obj.insert("ledger".to_string(), serde_json::json!({
                            "registeredAt": registered_at,
                            "submitterDid": submitter_did
                        }));

                        // hardening: nunca deixar seed/segredos aqui
                        obj.remove("seed");
                        obj.remove("seedHex");
                        obj.remove("seedB64");
                        obj.remove("privateKey");
                        obj.remove("secret");
                    }

                    // Recriar tags PR-01
                    let tags = vec![
                        EntryTag::Encrypted("type".to_string(), type_field),
                        EntryTag::Encrypted("verkey".to_string(), target_verkey_s.clone()),
                        EntryTag::Encrypted("alias".to_string(), alias),
                        EntryTag::Encrypted("createdAt".to_string(), created_at.to_string()),
                        EntryTag::Encrypted("isPublic".to_string(), "true".to_string()),
                        EntryTag::Encrypted("origin".to_string(), origin),
                        EntryTag::Encrypted("role".to_string(), role_tag),
                    ];

                    // Atualização atômica (remove+insert no mesmo commit)
                    session_upd
                        .remove("did", &target_did_s)
                        .await
                        .map_err(|e| napi::Error::from_reason(format!("Erro remove target DID: {}", e)))?;

                    session_upd
                        .insert("did", &target_did_s, rec.to_string().as_bytes(), Some(&tags), None)
                        .await
                        .map_err(|e| napi::Error::from_reason(format!("Erro insert target DID atualizado: {}", e)))?;

                    session_upd
                        .commit()
                        .await
                        .map_err(|e| napi::Error::from_reason(format!("Erro commit update target DID: {}", e)))?;
                }
            }

            Ok(response)
        },
        |&mut env, data| env.create_string(&data),
    )
    }

    // ------------------------------------------------------------------------
    // Novo método para resolver um DID no ledger com resposta enriquecida
    #[napi]
    pub async unsafe fn resolve_did_on_ledger_v2(&self, did_to_fetch: String) -> Result<String> {
        let pool = match &self.pool {
            Some(p) => p.clone(), // Arc clone (barato) para ficar estável no await
            None => {
                let out = json!({
                    "ok": false,
                    "code": "PoolNotConnected",
                    "message": "Pool não conectado. Execute connectNetwork antes.",
                    "did": did_to_fetch
                });
                return Ok(out.to_string());
            }
        };

        let did = did_to_fetch.trim().to_string();
        if did.is_empty() {
            let out = json!({
                "ok": false,
                "code": "InvalidDid",
                "message": "did_to_fetch vazio",
                "did": did_to_fetch
            });
            return Ok(out.to_string());
        }

        // Defaults via env (útil para testes e ambientes diferentes)
        let tries: u32 = std::env::var("SSI_RESOLVE_TRIES")
            .ok()
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(10);

        let delay_ms: u64 = std::env::var("SSI_RESOLVE_DELAY_MS")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(400);

        // --- Helpers locais ---
        fn role_name_from(role: Option<&str>) -> Option<&'static str> {
            // Indy costuma devolver:
            // "0" trustee, "2" steward, "101" endorser, null para "NONE"
            match role {
                Some("0") => Some("TRUSTEE"),
                Some("2") => Some("STEWARD"),
                Some("101") => Some("ENDORSER"),
                Some(s) if s.eq_ignore_ascii_case("TRUSTEE") => Some("TRUSTEE"),
                Some(s) if s.eq_ignore_ascii_case("STEWARD") => Some("STEWARD"),
                Some(s) if s.eq_ignore_ascii_case("ENDORSER") => Some("ENDORSER"),
                _ => None,
            }
        }

        // Tenta extrair rawData (objeto) e campos comuns verkey/role
        fn extract_nym_fields(
            ledger_json: &serde_json::Value,
        ) -> (
            bool,
            Option<String>,
            Option<String>,
            Option<serde_json::Value>,
        ) {
            let data = ledger_json.get("result").and_then(|r| r.get("data"));
            let data = match data {
                Some(v) => v,
                None => return (false, None, None, None),
            };

            // "data" pode vir como string JSON (caso mais comum) ou como objeto
            let data_obj: serde_json::Value = if data.is_string() {
                let s = data.as_str().unwrap_or("").trim();
                if s.is_empty() || s == "null" {
                    return (false, None, None, None);
                }
                match serde_json::from_str::<serde_json::Value>(s) {
                    Ok(v) => v,
                    Err(_) => return (false, None, None, None),
                }
            } else if data.is_object() {
                data.clone()
            } else if data.is_null() {
                return (false, None, None, None);
            } else {
                return (false, None, None, None);
            };

            let verkey = data_obj
                .get("verkey")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            // role pode ser string ou number em alguns ledgers
            let role = match data_obj.get("role") {
                Some(serde_json::Value::String(s)) => Some(s.to_string()),
                Some(serde_json::Value::Number(n)) => n.as_i64().map(|x| x.to_string()),
                Some(serde_json::Value::Null) | None => None,
                _ => None,
            };

            (true, verkey, role, Some(data_obj))
        }

        let start = Instant::now();
        let mut last_ledger_str: Option<String> = None;
        let mut last_ledger_val: Option<serde_json::Value> = None;

        for attempt in 1..=tries {
            let ledger_str = match ledger::get_nym(&pool, &did).await {
                Ok(s) => s,
                Err(e) => {
                    let out = json!({
                        "ok": false,
                        "code": "LedgerGetNymFailed",
                        "message": e,
                        "did": did,
                        "attempts": attempt,
                        "elapsedMs": start.elapsed().as_millis()
                    });
                    return Ok(out.to_string());
                }
            };

            last_ledger_str = Some(ledger_str.clone());

            let ledger_val: serde_json::Value = match serde_json::from_str(&ledger_str) {
                Ok(v) => v,
                Err(_) => {
                    // Se vier algo não-JSON, mantém compatibilidade retornando wrapper ok=false
                    let out = json!({
                        "ok": false,
                        "code": "LedgerResponseNotJson",
                        "message": "Resposta do ledger não é JSON válido",
                        "did": did,
                        "ledgerRaw": ledger_str,
                        "attempts": attempt,
                        "elapsedMs": start.elapsed().as_millis()
                    });
                    return Ok(out.to_string());
                }
            };

            last_ledger_val = Some(ledger_val.clone());

            let (found, verkey, role, raw_data) = extract_nym_fields(&ledger_val);

            if found {
                let role_name = role_name_from(role.as_deref()).map(|s| s.to_string());

                let out = json!({
                    "ok": true,
                    "did": did,
                    "found": true,
                    "verkey": verkey,
                    "role": role,
                    "roleName": role_name,
                    "rawData": raw_data,      // objeto do "data"
                    "ledger": ledger_val,     // resposta completa do ledger
                    "attempts": attempt,
                    "elapsedMs": start.elapsed().as_millis()
                });

                return Ok(out.to_string());
            }

            // não achou ainda (data null/vazio): retry
            if attempt < tries {
                sleep(Duration::from_millis(delay_ms)).await;
            }
        }

        // Não encontrado após retries: retorna found=false + última resposta do ledger
        let out = json!({
            "ok": true,
            "did": did,
            "found": false,
            "ledger": last_ledger_val.unwrap_or_else(|| json!(null)),
            "ledgerRaw": last_ledger_str.unwrap_or_else(|| "".to_string()),
            "attempts": tries,
            "elapsedMs": start.elapsed().as_millis()
        });

        Ok(out.to_string())
    }

    // =========================================================
    //  DID PRINCIPAL (ponteiro em settings)
    // =========================================================

    #[napi]
    pub async unsafe fn set_primary_did(&mut self, did: String) -> Result<String> {
        // 1) Wallet aberta?
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        let did_trim = did.trim().to_string();
        if did_trim.is_empty() {
            return Err(Error::from_reason("did vazio"));
        }

        // 2) Timestamp
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // 3) Abrir sessão
        let mut session = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro sessão: {}", e)))?;

        // 4) Validar que esse DID existe na wallet (own ou external)
        let did_exists = session
            .fetch("did", &did_trim, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro fetch DID: {}", e)))?
            .is_some();

        if !did_exists {
            return Err(Error::from_reason(format!(
                "DID não existe na wallet: {}",
                did_trim
            )));
        }

        // 5) Montar registro settings/primary_did
        let rec = json!({
            "did": did_trim,
            "setAt": ts
        })
        .to_string();

        let tags = vec![
            EntryTag::Encrypted("key".to_string(), "primaryDid".to_string()),
            EntryTag::Encrypted("did".to_string(), did_trim.clone()),
            EntryTag::Encrypted("setAt".to_string(), ts.to_string()),
        ];

        // 6) Upsert via remove+insert (porque não há update)
        let existing = session
            .fetch("settings", "primary_did", false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro fetch settings: {}", e)))?;

        if existing.is_some() {
            session
                .remove("settings", "primary_did")
                .await
                .map_err(|e| Error::from_reason(format!("Erro remove primary_did: {}", e)))?;
        }

        session
            .insert("settings", "primary_did", rec.as_bytes(), Some(&tags), None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro insert primary_did: {}", e)))?;

        // 7) Commit
        session
            .commit()
            .await
            .map_err(|e| Error::from_reason(format!("Erro commit set_primary_did: {}", e)))?;

        // 8) Retorno
        let out = json!({
            "ok": true,
            "did": did_trim,
            "setAt": ts
        });

        serde_json::to_string(&out)
            .map_err(|e| Error::from_reason(format!("Erro serializar set_primary_did: {}", e)))
    }

    #[napi]
    pub async unsafe fn get_primary_did(&self) -> Result<String> {
        // 1) Wallet aberta?
        let store = match &self.store {
            Some(s) => s.clone(),
            None => return Err(Error::from_reason("Wallet fechada!")),
        };

        // 2) Sessão
        let mut session = store
            .session(None)
            .await
            .map_err(|e| Error::from_reason(format!("Erro sessão: {}", e)))?;

        // 3) Buscar settings/primary_did
        let entry_opt = session
            .fetch("settings", "primary_did", false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro fetch primary_did: {}", e)))?;

        let entry = match entry_opt {
            Some(e) => e,
            None => return Err(Error::from_reason("Primary DID não definido.")),
        };

        let s = String::from_utf8(entry.value.to_vec())
            .map_err(|e| Error::from_reason(format!("Erro UTF-8 primary_did: {}", e)))?;

        // 4) Parse + validação mínima
        let v: serde_json::Value = serde_json::from_str(&s)
            .map_err(|e| Error::from_reason(format!("primary_did corrompido: {}", e)))?;

        let did = v.get("did").and_then(|x| x.as_str()).unwrap_or("").trim();
        if did.is_empty() {
            return Err(Error::from_reason(
                "primary_did inválido: campo did ausente",
            ));
        }

        // 5) (Opcional, mas recomendado) validar que DID ainda existe na wallet
        let did_exists = session
            .fetch("did", did, false)
            .await
            .map_err(|e| Error::from_reason(format!("Erro fetch DID do primary: {}", e)))?
            .is_some();

        if !did_exists {
            return Err(Error::from_reason(format!(
                "Primary DID aponta para um DID que não existe mais na wallet: {}",
                did
            )));
        }

        let out = json!({
            "ok": true,
            "did": did,
            "setAt": v.get("setAt").and_then(|x| x.as_u64()).unwrap_or(0)
        });

        serde_json::to_string(&out)
            .map_err(|e| Error::from_reason(format!("Erro serializar get_primary_did: {}", e)))
    }

}
