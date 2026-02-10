// cargo build --release
// cp target/release/libssi_native_lib.so index.node
// node ./teste_indicio.js

use once_cell::sync::Lazy;
use std::sync::{Arc, Mutex}; // <--- Adicione Arc aqui

// MUDANÇA: Agora o cache guarda um Arc<LinkSecret>, não o LinkSecret direto.
static LINK_SECRET_CACHE: Lazy<Mutex<Option<Arc<LinkSecret>>>> = Lazy::new(|| Mutex::new(None));

// =============================================================================
// IMPORTS CORRIGIDOS (ANONCREDS & INDY-DATA-TYPES)
// =============================================================================
// Usamos 'types' em vez de 'data_types' para a versão 0.4.0
// Imports do Anoncreds
// use anoncreds::data_types::issuer_id::IssuerId;
// use anoncreds::data_types::schema::{AttributeNames, Schema};
use anoncreds::data_types::schema::Schema;
// Renomeamos para evitar conflito com o SchemaId do VDR
use anoncreds::data_types::schema::SchemaId as AnonSchemaId;
// use anoncreds::issuer::create_credential_definition;
// use anoncreds::types::{CredentialDefinitionConfig, CredentialKeyCorrectnessProof, SignatureType};

use anoncreds::types::CredentialKeyCorrectnessProof;

// use anoncreds::data_types::schema::SchemaId as AnonSchemaId; // Correção aqui!

use indy_data_types::SchemaId as LedgerSchemaId;
use std::time::{SystemTime, UNIX_EPOCH};

use aries_askar::{
    entry::{EntryTag, TagFilter},
    kms::{KeyAlg, LocalKey},
    PassKey, Store, StoreKeyMethod,
};

use bs58;
// use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
// use std::time::{SystemTime, UNIX_EPOCH};

// IMPORTS DE REDE
use indy_vdr::pool::PoolRunner; // Precisamos disso para o tipo do campo 'pool'
mod ledger; // <--- AQUI DECLARAMOS O NOVO MÓDULO
            // use napi::bindgen_prelude::*; // Importante para o execute_tokio_future
use napi::{Env, JsObject, Result}; // Adicione estes imports no topo

// =============================================================================
// 1. IMPORTS DO INDY VDR (CORRIGIDO)
// =============================================================================
use indy_vdr::config::PoolConfig;
// use indy_vdr::ledger::constants::UpdateRole;
use indy_vdr::ledger::RequestBuilder;
use indy_vdr::pool::{PoolBuilder, PoolTransactions, ProtocolVersion};
use indy_vdr::utils::did::DidValue;

use indy_data_types::CredentialDefinitionId;

// Adicionar aos imports do anoncreds::types para oferecer credencial
// Adicionar aos imports do anoncreds::data_types::cred_def
use anoncreds::data_types::cred_def::CredentialDefinitionId as AnonCredDefId; // <--- NOVO
use anoncreds::types::LinkSecret;

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
use anoncreds::data_types::cred_def::CredentialDefinition;
// use anoncreds::data_types::cred_offer::CredentialOffer;

// use anoncreds::types::{
//     AttributeValues, CredentialDefinitionPrivate, CredentialRequest, CredentialRequestMetadata,
//     CredentialValues,
// };

use std::collections::HashMap; // <--- ADICIONAR

// use anoncreds::prover::create_presentation;
use anoncreds::types::{Presentation, PresentationRequest};
use anoncreds::verifier::verify_presentation;

// use anoncreds::types::{
//     PresentCredentials, // <--- SUBSTIUIR RequestedCredentials por ISSO
// };

// Imports Corrigidos
// use aries_askar::kms::{crypto_box, crypto_box_open}; // KMS tem as funções!
// use rand::RngCore; // Para gerar o nonce via rand

// KdfMethod is used via aries_askar::kms::KdfMethod below
use napi::Error;
use sha3::Sha3_256;

// Wallet/KDF + backup
use aes_gcm::{aead::Aead, aead::KeyInit, Aes256Gcm};
use argon2::{Algorithm, Argon2, Params, Version};
// use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use base64::engine::general_purpose::STANDARD as B64;
use rand::rngs::OsRng;
use rand::RngCore;
use std::fs;
use std::path::Path;

// Imports do Askar & Criptografia
// use aries_askar::crypto::encrypt; // <--- NECESSÁRIO para encrypt::crypto_box
// use indy_vdr::pool::PreparedRequest;
// use indy_vdr::pool::RequestResult;

use base64::engine::general_purpose;
use base64::Engine;
use std::time::Instant;
use tokio::time::{sleep, Duration};

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

// =============================================================================
// WALLET KDF (Fase 1): Argon2id + sidecar + compatibilidade legado
// =============================================================================

fn napi_err(code: &str, message: impl Into<String>) -> napi::Error {
    napi::Error::from_reason(
        serde_json::json!({
            "ok": false,
            "code": code,
            "message": message.into()
        })
        .to_string(),
    )
}

fn is_wallet_auth_error(msg: &str) -> bool {
    // Erros típicos quando a chave derivada não bate (senha errada / KDF errado)
    msg.contains("AEAD decryption error")
        || msg.contains("Error decrypting profile key")
        || msg.contains("decrypting profile key")
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

/// Best-effort: remove artefatos de wallet para evitar "wallet órfã"
/// (db criada, mas sidecar não escrito).
fn cleanup_wallet_files(wallet_path: &str, sidecar_path: &str) {
    // db principal
    let _ = std::fs::remove_file(wallet_path);
    // sidecar
    let _ = std::fs::remove_file(sidecar_path);
    // sqlite journaling (quando aplicável)
    let _ = std::fs::remove_file(format!("{}-wal", wallet_path));
    let _ = std::fs::remove_file(format!("{}-shm", wallet_path));
    // temporários possíveis
    let _ = std::fs::remove_file(format!("{}.tmp", sidecar_path));
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WalletKdfSidecar {
    version: u32,
    kdf: String,

    // Argon2id
    salt_b64: Option<String>,
    m_cost_kib: Option<u32>,
    t_cost: Option<u32>,
    p_cost: Option<u32>,
    dk_len: Option<u32>,

    // Legado
    rounds: Option<u32>,
}

fn sidecar_path_for(wallet_path: &str) -> String {
    format!("{}.kdf.json", wallet_path)
}

fn write_sidecar(path: &str, sc: &WalletKdfSidecar) -> napi::Result<()> {
    let tmp = format!("{}.tmp", path);
    let content = serde_json::to_vec_pretty(sc)
        .map_err(|e| napi_err("SidecarSerializeFailed", e.to_string()))?;
    fs::write(&tmp, content).map_err(|e| napi_err("SidecarWriteFailed", e.to_string()))?;
    fs::rename(&tmp, path).map_err(|e| napi_err("SidecarRenameFailed", e.to_string()))?;
    Ok(())
}

fn read_sidecar(path: &str) -> napi::Result<WalletKdfSidecar> {
    let content = fs::read(path).map_err(|e| napi_err("SidecarReadFailed", e.to_string()))?;
    serde_json::from_slice(&content).map_err(|e| napi_err("SidecarParseFailed", e.to_string()))
}

// KDF legado (SHA256 + SHA3 em loop) — usado apenas para abrir wallets antigas.
fn derive_raw_key_legacy(password: &str, rounds: u32) -> String {
    let mut current_bytes = password.as_bytes().to_vec();
    for _ in 0..rounds {
        let mut hasher2 = Sha256::new();
        hasher2.update(&current_bytes);
        current_bytes = hasher2.finalize().to_vec();

        let mut hasher3 = Sha3_256::new();
        hasher3.update(&current_bytes);
        current_bytes = hasher3.finalize().to_vec();
    }
    bs58::encode(current_bytes).into_string()
}

fn derive_raw_key_argon2id(
    password: &str,
    salt: &[u8],
    m_cost_kib: u32,
    t_cost: u32,
    p_cost: u32,
) -> napi::Result<String> {
    let params = Params::new(m_cost_kib, t_cost, p_cost, Some(32))
        .map_err(|e| napi_err("Argon2ParamsInvalid", e.to_string()))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut out = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| napi_err("Argon2DeriveFailed", e.to_string()))?;

    Ok(bs58::encode(out).into_string())
}

fn derive_raw_key_from_sidecar(password: &str, sc: &WalletKdfSidecar) -> napi::Result<String> {
    match sc.kdf.as_str() {
        "argon2id" => {
            let salt_b64 = sc
                .salt_b64
                .as_ref()
                .ok_or_else(|| napi_err("KdfParamsMissing", "salt_b64 ausente"))?;
            let salt = B64
                .decode(salt_b64)
                .map_err(|e| napi_err("KdfParamsInvalid", e.to_string()))?;
            let m = sc.m_cost_kib.unwrap_or(65536);
            let t = sc.t_cost.unwrap_or(3);
            let p = sc.p_cost.unwrap_or(1);
            derive_raw_key_argon2id(password, &salt, m, t, p)
        }
        "legacy_sha256_sha3" => {
            let rounds = sc.rounds.unwrap_or(128);
            Ok(derive_raw_key_legacy(password, rounds))
        }
        other => Err(napi_err(
            "KdfUnknown",
            format!("KDF não suportado: {other}"),
        )),
    }
}

fn default_argon2_sidecar() -> (WalletKdfSidecar, [u8; 16]) {
    // Defaults conservadores (desktop): 64 MiB, 3 iterações, 1 thread.
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let sc = WalletKdfSidecar {
        version: 1,
        kdf: "argon2id".to_string(),
        salt_b64: Some(B64.encode(salt)),
        m_cost_kib: Some(65536),
        t_cost: Some(3),
        p_cost: Some(1),
        dk_len: Some(32),
        rounds: None,
    };
    (sc, salt)
}

#[derive(Debug, Deserialize, Default)]
struct DidSearchFilter {
    #[serde(rename = "type")]
    type_field: Option<String>, // "own" | "external" | "all"
    query: Option<String>,    // substring
    createdFrom: Option<u64>, // epoch seconds
    createdTo: Option<u64>,   // epoch seconds
    isPublic: Option<bool>,   // default false
    role: Option<String>,     // "ENDORSER" | "TRUSTEE" | "STEWARD" | "none"
    origin: Option<String>,   // "generated" | "imported_seed" | "manual" | "legacy"
    limit: Option<usize>,     // default 50
    offset: Option<usize>,    // default 0
}

#[derive(Debug, Deserialize, Default)]
struct CreateDidPolicy {
    requireTrusteeForEndorser: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
struct CreateDidOpts {
    alias: Option<String>,
    #[serde(rename = "public")]
    public_: Option<bool>,
    role: Option<String>,         // "ENDORSER|TRUSTEE|STEWARD|none"
    submitterDid: Option<String>, // obrigatório se public=true
    policy: Option<CreateDidPolicy>,
}

// Helpers Schemas >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

const CONTROL_ATTRS: [&str; 5] = [
    "seed",
    "start_time",
    "unit_of_time",
    "time_window",
    "root_merkle_L",
];

fn is_reserved_control_attr(a: &str) -> bool {
    CONTROL_ATTRS.iter().any(|x| x.eq_ignore_ascii_case(a))
}

fn build_final_attr_names(mut user_attrs: Vec<String>, revocable: bool) -> Result<Vec<String>> {
    use std::collections::HashSet;

    let mut seen = HashSet::<String>::new();
    for a in &user_attrs {
        let k = a.trim().to_string();
        if k.is_empty() {
            return Err(Error::from_reason("Atributo vazio não é permitido"));
        }
        if is_reserved_control_attr(&k) {
            return Err(Error::from_reason(format!(
                "Atributo reservado de controle não pode ser definido manualmente: {}",
                k
            )));
        }
        let norm = k.to_lowercase();
        if !seen.insert(norm) {
            return Err(Error::from_reason(format!("Atributo duplicado: {}", k)));
        }
    }

    if revocable {
        for c in CONTROL_ATTRS {
            user_attrs.push(c.to_string());
        }
    }
    Ok(user_attrs)
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn make_schema_local_id() -> String {
    let mut buf = [0u8; 16];
    OsRng.fill_bytes(&mut buf);
    format!("local:{}", bs58::encode(buf).into_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SchemaRecord {
    pub id_local: String,
    pub name: String,
    pub version: String,
    pub attr_names: Vec<String>,       // atributos da credencial
    pub revocable: bool,               // se usa controle do holder
    pub final_attr_names: Vec<String>, // attr_names + CONTROL_ATTRS (se revocable)
    pub on_ledger: bool,
    pub schema_id: Option<String>, // quando on_ledger=true
    pub issuer_did: Option<String>,
    pub env: String, // "prod" | "test" | "template"
    pub created_at: i64,
    pub updated_at: i64,
}

const CONFIG_CATEGORY: &str = "config";
const KEY_DEFAULT_SCHEMA_ISSUER_DID: &str = "default_schema_issuer_did";

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

    // --- MÉTODOS DE WALLET (Askar) ---
    #[napi]
    pub async unsafe fn wallet_create(&mut self, path: String, pass: String) -> Result<String> {
        // 1) Validação básica
        if path.trim().is_empty() {
            return Err(napi_err("WalletPathInvalid", "wallet path vazio"));
        }

        let wallet_db_path = Path::new(&path);
        let sidecar_path = sidecar_path_for(&path);

        // Garante que o diretório existe
        if let Some(parent) = wallet_db_path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)
                    .map_err(|e| napi_err("WalletPathCreateDirFailed", e.to_string()))?;
            }
        }

        // Evita sobrescrever wallet existente
        if wallet_db_path.exists() || Path::new(&sidecar_path).exists() {
            return Err(napi_err(
                "WalletAlreadyExists",
                "wallet já existe (db e/ou sidecar já presentes)",
            ));
        }

        // 2) Gera KDF (Argon2id) + raw key
        let (sc, salt) = default_argon2_sidecar();
        let raw_key_string = derive_raw_key_argon2id(
            &pass,
            &salt,
            sc.m_cost_kib.unwrap_or(65536),
            sc.t_cost.unwrap_or(3),
            sc.p_cost.unwrap_or(1),
        )?;

        // 3) Cria o SQLite cifrado (Askar)
        let config_uri = format!("sqlite://{}", path);
        Store::provision(
            &config_uri,
            StoreKeyMethod::RawKey,
            PassKey::from(raw_key_string),
            None,
            false, // não recriar por cima
        )
        .await
        .map_err(|e| napi_err("WalletCreateFailed", e.to_string()))?;

        // 4) Persiste sidecar (salt + params)
        if let Err(e) = write_sidecar(&sidecar_path, &sc) {
            // Evita ficar com DB criada sem sidecar (inconsistência)
            cleanup_wallet_files(&path, &sidecar_path);
            return Err(e);
        }

        Ok("Carteira criada com sucesso!".to_string())
    }

    #[napi]
    pub async unsafe fn wallet_open(&mut self, path: String, pass: String) -> Result<String> {
        if path.trim().is_empty() {
            return Err(napi_err("WalletPathInvalid", "wallet path vazio"));
        }

        // Se o DB não existe, não faz sentido cair em KdfParamsMissing.
        // Retorna um erro claro de "wallet não encontrada".
        let wallet_db_path = std::path::Path::new(&path);
        if !wallet_db_path.exists() {
            return Err(napi_err(
                "WalletNotFound",
                format!("wallet db não encontrada ({})", path),
            ));
        }

        let config_uri = format!("sqlite://{}", path);
        self.connection_uri = config_uri.clone();

        let sidecar_path = sidecar_path_for(&path);
        let sc = if Path::new(&sidecar_path).exists() {
            Some(read_sidecar(&sidecar_path)?)
        } else {
            None
        };

        // 1) Deriva raw key a partir do sidecar (ou tenta modo legado para migração)
        let (raw_key_string, opened_with_legacy) = if let Some(sc) = &sc {
            (derive_raw_key_from_sidecar(&pass, sc)?, false)
        } else {
            // Compatibilidade: tenta abrir como legacy (wallets antigas)
            (derive_raw_key_legacy(&pass, 128), true)
        };

        // 2) Abre store
        let store_res = Store::open(
            &config_uri,
            Some(StoreKeyMethod::RawKey),
            PassKey::from(raw_key_string),
            None,
        )
        .await;

        let store = match store_res {
            Ok(s) => s,
            Err(e) => {
                let emsg = e.to_string();

                // Se NÃO há sidecar, a política principal é: sidecar obrigatório.
                // Não misture com "detalhe de decrypt", porque isso só confunde.
                if sc.is_none() {
                    return Err(napi_err(
                        "KdfParamsMissing",
                        format!(
        "sidecar ausente ({}). Para wallets criadas nesta versão, o sidecar é obrigatório.",
        sidecar_path
      ),
                    ));
                }

                // Se HÁ sidecar e deu AEAD decryption error => senha errada (ou chave derivada errada)
                if is_wallet_auth_error(&emsg) {
                    return Err(napi_err(
                        "WalletAuthFailed",
                        "Senha incorreta (falha na decifragem da chave da wallet).",
                    ));
                }

                // Outros erros reais de abertura
                return Err(napi_err("WalletOpenFailed", emsg));
            }
        };

        // 3) Migração automática: se abriu como legacy e sidecar não existia, cria sidecar legacy
        if opened_with_legacy && sc.is_none() {
            let legacy_sc = WalletKdfSidecar {
                version: 1,
                kdf: "legacy_sha256_sha3".to_string(),
                salt_b64: None,
                m_cost_kib: None,
                t_cost: None,
                p_cost: None,
                dk_len: None,
                rounds: Some(128),
            };
            // Best-effort: se falhar, não impede a abertura
            let _ = write_sidecar(&sidecar_path, &legacy_sc);
        }

        // Sessão global removida corretamente aqui
        self.store = Some(store);

        Ok("Conectado ao SQLite nativo com sucesso!".to_string())
    }

    #[napi]
    pub async unsafe fn wallet_close(&mut self) -> Result<bool> {
        // REMOVIDO: self.session = None; (Campo não existe mais)

        // Fecha o Store (libera o handle do arquivo SQLite)
        self.store = None;

        // Libera o Pool de conexão com o Ledger
        self.pool = None;

        Ok(true)
    }

    // ---------------------------------------------------------------------
    // BACKUP DE SENHA DA WALLET (arquivo separado cifrado com AES-256-GCM)
    // ---------------------------------------------------------------------
    #[napi]
    pub fn wallet_backup_create(
        &self,
        wallet_pass: String,
        backup_pass: String,
        backup_file_path: String,
    ) -> Result<bool> {
        if backup_file_path.trim().is_empty() {
            return Err(napi_err("BackupPathInvalid", "backup_file_path vazio"));
        }

        // 1) KDF (Argon2id) para chave de backup
        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);
        let key_b58 = derive_raw_key_argon2id(&backup_pass, &salt, 65536, 3, 1)?;

        // key_b58 é base58 de 32 bytes; decodificamos para bytes
        let key_bytes = bs58::decode(key_b58)
            .into_vec()
            .map_err(|e| napi_err("BackupKeyDecodeFailed", e.to_string()))?;
        if key_bytes.len() != 32 {
            return Err(napi_err(
                "BackupKeyInvalid",
                "chave derivada não tem 32 bytes",
            ));
        }

        // 2) AES-256-GCM
        let cipher = Aes256Gcm::new_from_slice(&key_bytes)
            .map_err(|e| napi_err("BackupCipherInitFailed", e.to_string()))?;
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);

        let ciphertext = cipher
            .encrypt((&nonce).into(), wallet_pass.as_bytes())
            .map_err(|e| napi_err("BackupEncryptFailed", e.to_string()))?;

        // 3) Persistência (JSON)
        let payload = serde_json::json!({
            "version": 1,
            "kdf": "argon2id",
            "salt_b64": B64.encode(salt),
            "m_cost_kib": 65536,
            "t_cost": 3,
            "p_cost": 1,
            "nonce_b64": B64.encode(nonce),
            "ct_b64": B64.encode(ciphertext),
        });

        let tmp = format!("{}.tmp", backup_file_path);
        let bytes = serde_json::to_vec_pretty(&payload)
            .map_err(|e| napi_err("BackupSerializeFailed", e.to_string()))?;
        fs::write(&tmp, bytes).map_err(|e| napi_err("BackupWriteFailed", e.to_string()))?;
        fs::rename(&tmp, &backup_file_path)
            .map_err(|e| napi_err("BackupRenameFailed", e.to_string()))?;

        Ok(true)
    }

    #[napi]
    pub fn wallet_backup_recover(
        &self,
        backup_pass: String,
        backup_file_path: String,
    ) -> Result<String> {
        let content =
            fs::read(&backup_file_path).map_err(|e| napi_err("BackupReadFailed", e.to_string()))?;
        let v: serde_json::Value = serde_json::from_slice(&content)
            .map_err(|e| napi_err("BackupParseFailed", e.to_string()))?;

        let salt_b64 = v["salt_b64"]
            .as_str()
            .ok_or_else(|| napi_err("BackupFormatInvalid", "salt_b64 ausente"))?;
        let nonce_b64 = v["nonce_b64"]
            .as_str()
            .ok_or_else(|| napi_err("BackupFormatInvalid", "nonce_b64 ausente"))?;
        let ct_b64 = v["ct_b64"]
            .as_str()
            .ok_or_else(|| napi_err("BackupFormatInvalid", "ct_b64 ausente"))?;

        let salt = B64
            .decode(salt_b64)
            .map_err(|e| napi_err("BackupFormatInvalid", e.to_string()))?;
        let nonce = B64
            .decode(nonce_b64)
            .map_err(|e| napi_err("BackupFormatInvalid", e.to_string()))?;
        let ct = B64
            .decode(ct_b64)
            .map_err(|e| napi_err("BackupFormatInvalid", e.to_string()))?;

        if nonce.len() != 12 {
            return Err(napi_err("BackupNonceInvalid", "nonce deve ter 12 bytes"));
        }

        // Deriva key e decripta
        let key_b58 = derive_raw_key_argon2id(&backup_pass, &salt, 65536, 3, 1)?;
        let key_bytes = bs58::decode(key_b58)
            .into_vec()
            .map_err(|e| napi_err("BackupKeyDecodeFailed", e.to_string()))?;
        if key_bytes.len() != 32 {
            return Err(napi_err(
                "BackupKeyInvalid",
                "chave derivada não tem 32 bytes",
            ));
        }
        let cipher = Aes256Gcm::new_from_slice(&key_bytes)
            .map_err(|e| napi_err("BackupCipherInitFailed", e.to_string()))?;

        let pt = cipher
            .decrypt((&nonce[..]).into(), ct.as_ref())
            .map_err(|e| napi_err("BackupDecryptFailed", e.to_string()))?;

        String::from_utf8(pt).map_err(|e| napi_err("BackupPlaintextInvalid", e.to_string()))
    }

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

    // ----------------------------------------------------------------------------------------------
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
    //  ESCRITA DE ATRIBUTO (ATTRIB)
    // =========================================================================
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
    //  VERIFICAR EXISTÊNCIA DE ATRIBUTO (CHECK) - CORRIGIDO
    // =========================================================================
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

    // =========================================================================
    //  8. COMUNICAÇÃO SEGURA (CORREÇÃO: RESOLVER DID -> VERKEY)
    // =========================================================================
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

// =============================================================================
// 1. HELPER (CORRIGIDO) - Coloque fora do "impl IndyAgent"
// =============================================================================
async fn send_request_async(
    client: &indy_vdr::pool::PoolRunner,
    req: indy_vdr::pool::PreparedRequest,
) -> napi::Result<String> {
    // CORREÇÃO: Usamos um canal OneShot do Tokio (Async) em vez de MPSC (Sync)
    let (tx, rx) = tokio::sync::oneshot::channel();

    // O callback do Indy-VDR é chamado quando a resposta chega.
    // Enviamos o resultado para o canal.
    client
        .send_request(
            req,
            Box::new(move |res| {
                // Se o receptor (rx) já tiver sido dropado (timeout/cancelamento),
                // o send falha, mas aqui ignoramos o erro (let _).
                let _ = tx.send(res);
            }),
        )
        .map_err(|e| napi::Error::from_reason(format!("Erro interno VDR (Send): {}", e)))?;

    // AGUARDAR RESPOSTA (AWAIT)
    // Aqui está a mágica: o .await libera a thread do Tokio para fazer outras coisas
    // enquanto o Ledger não responde. Não há bloqueio de CPU.
    let vdr_return_result = rx.await.map_err(|_| {
        napi::Error::from_reason("Erro: Canal de resposta fechado inesperadamente (Dropped)")
    })?;

    // Processar o resultado do VDR
    let (res, _meta) = vdr_return_result
        .map_err(|e| napi::Error::from_reason(format!("Erro retornado pelo Ledger/VDR: {}", e)))?;

    match res {
        indy_vdr::pool::RequestResult::Reply(body) => Ok(body),
        indy_vdr::pool::RequestResult::Failed(e) => Err(napi::Error::from_reason(format!(
            "Transação rejeitada pelo Ledger: {:?}",
            e
        ))),
    }
}
