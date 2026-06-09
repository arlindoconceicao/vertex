use std::path::Path;

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use argon2::{Algorithm, Argon2, Params, Version};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use crate::{
    Result, SsiError, canonical_json,
    credential::{self, CredentialIssueOptions, SignedCredential},
    crypto::mlkem,
    did::{self, DidDocument},
    encoding::{base64url_decode, base64url_encode, multibase_base58btc_encode},
    pdf::{self, PdfBindingOptions},
    pdf_sign::{self, PdfSignOptions},
    profiles::{MlDsaProfile, MlKemProfile},
    random::random_array,
    schema::SchemaDocument,
};

const WALLET_METADATA_ID: &str = "default";
const WALLET_VERSION: u32 = 2;
const ARGON2_MEMORY_KIB: u32 = 19 * 1024;
const ARGON2_TIME_COST: u32 = 2;
const ARGON2_PARALLELISM: u32 = 1;
const ROW_KEY_SIZE: usize = 32;
const ROW_KEY_SALT_SIZE: usize = 32;
const PRIVATE_KEY_NONCE_SIZE: usize = 12;

/// Opções usadas para criar uma wallet cifrada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalletCreateOptions {
    /// Timestamp de criação gravado nos metadados da wallet.
    pub created_at: String,
}

/// Opções usadas para criar um DID dentro da wallet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalletDidCreateOptions {
    /// Rótulo local opcional para exibição ao usuário.
    pub label: Option<String>,
    /// Perfil ML-DSA usado para a chave de assinatura.
    pub mldsa_profile: MlDsaProfile,
    /// Perfil ML-KEM usado para a chave de encapsulamento/decapsulamento.
    pub mlkem_profile: MlKemProfile,
    /// Timestamp de criação gravado no DID Document.
    pub created_at: String,
    /// CID opcional do DID Document quando ele for publicado.
    pub did_doc_cid: Option<String>,
}

/// Informações públicas sobre uma wallet aberta com sucesso.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WalletInfo {
    /// Identificador interno da wallet.
    pub wallet_id: String,
    /// Versão do schema local.
    pub version: u32,
    /// Timestamp de criação da wallet.
    pub created_at: String,
    /// Quantidade de DIDs armazenados.
    pub did_count: u32,
    /// Versão do SQLCipher em uso.
    pub sqlcipher_version: String,
}

/// Resumo público de um DID armazenado na wallet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WalletDidSummary {
    /// DID armazenado.
    pub did: String,
    /// Rótulo local opcional.
    pub label: Option<String>,
    /// Perfil ML-DSA declarado.
    pub mldsa_alg: String,
    /// Perfil ML-KEM declarado.
    pub mlkem_alg: String,
    /// Estado local do DID.
    pub status: String,
    /// Timestamp de criação do DID.
    pub created_at: String,
    /// CID opcional do DID Document publicado.
    pub did_doc_cid: Option<String>,
}

/// Resultado público da criação de um DID dentro da wallet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WalletDidCreationResult {
    /// DID final no formato `did:ssipq:z...`.
    pub did: String,
    /// Fingerprint multibase/base58btc usado no DID.
    pub fingerprint: String,
    /// DID Document público assinado.
    pub did_document: DidDocument,
    /// Rótulo local opcional.
    pub label: Option<String>,
    /// Timestamp de criação do DID.
    pub created_at: String,
}

/// Resultado de decapsulamento ML-KEM feito com chave privada da wallet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalletMlkemDecapsulation {
    /// Perfil ML-KEM usado.
    pub profile: MlKemProfile,
    /// Segredo compartilhado decapsulado.
    pub shared_secret: Zeroizing<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WalletMetadata {
    wallet_id: String,
    version: u32,
    kdf_alg: String,
    kdf_params: KdfParamsJson,
    created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct KdfParamsJson {
    salt: String,
    memory_kib: u32,
    time_cost: u32,
    parallelism: u32,
    output_len: usize,
}

#[derive(Debug)]
struct UnlockedWallet {
    conn: Connection,
    metadata: WalletMetadata,
    row_key: [u8; ROW_KEY_SIZE],
    sqlcipher_version: String,
}

impl Drop for UnlockedWallet {
    fn drop(&mut self) {
        self.row_key.zeroize();
    }
}

#[derive(Debug)]
struct StoredPrivateKey {
    did: String,
    key_id: String,
    key_type: String,
    encrypted_private_key: Vec<u8>,
    nonce: Vec<u8>,
}

#[derive(Debug)]
struct PlainPrivateKey {
    did: String,
    key_id: String,
    key_type: String,
    private_key: Zeroizing<Vec<u8>>,
}

/// Cria uma nova wallet SQLite cifrada com SQLCipher.
///
/// A senha abre o banco SQLCipher e também deriva, via Argon2id, uma chave de
/// linha usada para cifrar as chaves privadas antes de gravá-las na tabela.
pub fn create_wallet(
    path: impl AsRef<Path>,
    password: &str,
    options: WalletCreateOptions,
) -> Result<WalletInfo> {
    validate_password(password)?;
    crate::time::validate_rfc3339_timestamp("created_at", &options.created_at)
        .map_err(SsiError::InvalidWallet)?;
    let path = path.as_ref();
    if path.exists() {
        return Err(SsiError::InvalidWallet(format!(
            "wallet already exists: {}",
            path.display()
        )));
    }
    ensure_parent_dir(path)?;

    let conn = open_sqlcipher_connection(path, password, true)?;
    initialize_schema(&conn)?;

    let metadata = WalletMetadata {
        wallet_id: random_wallet_id()?,
        version: WALLET_VERSION,
        kdf_alg: "Argon2id".to_string(),
        kdf_params: new_kdf_params()?,
        created_at: options.created_at,
    };
    insert_metadata(&conn, &metadata)?;
    let sqlcipher_version = sqlcipher_version(&conn)?;

    wallet_info(&conn, &metadata, sqlcipher_version)
}

/// Abre uma wallet cifrada e retorna metadados públicos.
///
/// A função valida a senha ao ler os metadados e derivar a chave usada para as
/// chaves privadas cifradas por linha.
pub fn open_wallet(path: impl AsRef<Path>, password: &str) -> Result<WalletInfo> {
    let wallet = unlock_wallet(path, password)?;
    wallet_info(
        &wallet.conn,
        &wallet.metadata,
        wallet.sqlcipher_version.clone(),
    )
}

/// Troca a senha SQLCipher da wallet e recifra as chaves privadas por linha.
///
/// O banco inteiro é recifrado via `PRAGMA rekey`, e cada chave privada recebe
/// novo nonce e nova chave derivada por Argon2id a partir da nova senha.
pub fn change_wallet_password(
    path: impl AsRef<Path>,
    old_password: &str,
    new_password: &str,
) -> Result<WalletInfo> {
    validate_password(new_password)?;
    let mut wallet = unlock_wallet(path, old_password)?;
    let private_keys = load_plain_private_keys(&wallet)?;

    wallet.conn.pragma_update(None, "rekey", new_password)?;
    let new_metadata = WalletMetadata {
        wallet_id: wallet.metadata.wallet_id.clone(),
        version: wallet.metadata.version,
        kdf_alg: wallet.metadata.kdf_alg.clone(),
        kdf_params: new_kdf_params()?,
        created_at: wallet.metadata.created_at.clone(),
    };
    let new_row_key = derive_row_key(new_password, &new_metadata.kdf_params)?;

    {
        let tx = wallet.conn.transaction()?;
        tx.execute(
            "UPDATE wallet_metadata SET kdf_params = ?1 WHERE id = ?2",
            params![
                serde_json::to_string(&new_metadata.kdf_params)?,
                WALLET_METADATA_ID
            ],
        )?;

        for private_key in private_keys {
            let encrypted = encrypt_private_key(
                &new_row_key,
                &new_metadata.wallet_id,
                &private_key.did,
                &private_key.key_id,
                &private_key.key_type,
                &private_key.private_key,
            )?;
            tx.execute(
                "UPDATE private_keys
                 SET encrypted_private_key = ?1, nonce = ?2
                 WHERE did = ?3 AND key_id = ?4",
                params![
                    encrypted.encrypted_private_key,
                    encrypted.nonce,
                    private_key.did,
                    private_key.key_id
                ],
            )?;
        }

        tx.commit()?;
    }

    wallet.metadata = new_metadata;
    wallet.row_key.zeroize();
    wallet.row_key = new_row_key;
    wallet_info(
        &wallet.conn,
        &wallet.metadata,
        wallet.sqlcipher_version.clone(),
    )
}

/// Cria um novo DID SSI-PQ e armazena suas chaves privadas na wallet.
///
/// O DID Document público fica gravado em JSON canônico. As chaves privadas são
/// cifradas por linha antes de serem inseridas em `private_keys`.
pub fn wallet_create_did(
    path: impl AsRef<Path>,
    password: &str,
    options: WalletDidCreateOptions,
) -> Result<WalletDidCreationResult> {
    let mut wallet = unlock_wallet(path, password)?;
    let created_at = options.created_at.clone();
    let did_result = did::create_did(did::DidCreateOptions {
        mldsa_profile: options.mldsa_profile,
        mlkem_profile: options.mlkem_profile,
        created_at: options.created_at,
    })?;
    let did_document_value = did::did_document_to_json(&did_result.did_document)?;
    let did_doc_json = canonical_json::canonical_json_string(&did_document_value);
    let mldsa_public_key = did_key_multibase(&did_result.did_document, "#mldsa-1")?;
    let mlkem_public_key = did_key_multibase(&did_result.did_document, "#mlkem-1")?;
    let mldsa_private = encrypt_private_key(
        &wallet.row_key,
        &wallet.metadata.wallet_id,
        &did_result.did,
        "#mldsa-1",
        options.mldsa_profile.as_str(),
        &did_result.mldsa_private_key,
    )?;
    let mlkem_private = encrypt_private_key(
        &wallet.row_key,
        &wallet.metadata.wallet_id,
        &did_result.did,
        "#mlkem-1",
        options.mlkem_profile.as_str(),
        &did_result.mlkem_private_key,
    )?;

    {
        let tx = wallet.conn.transaction()?;
        tx.execute(
            "INSERT INTO dids (
                did, label, mldsa_alg, mlkem_alg, mldsa_public_key,
                mlkem_public_key, did_doc_json, did_doc_cid, status, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', ?9)",
            params![
                &did_result.did,
                options.label.as_deref(),
                options.mldsa_profile.as_str(),
                options.mlkem_profile.as_str(),
                mldsa_public_key,
                mlkem_public_key,
                did_doc_json,
                options.did_doc_cid.as_deref(),
                &created_at
            ],
        )?;
        tx.execute(
            "INSERT INTO private_keys (
                did, key_id, key_type, encrypted_private_key, nonce, created_at
             ) VALUES (?1, '#mldsa-1', ?2, ?3, ?4, ?5)",
            params![
                &did_result.did,
                options.mldsa_profile.as_str(),
                mldsa_private.encrypted_private_key,
                mldsa_private.nonce,
                &created_at
            ],
        )?;
        tx.execute(
            "INSERT INTO private_keys (
                did, key_id, key_type, encrypted_private_key, nonce, created_at
             ) VALUES (?1, '#mlkem-1', ?2, ?3, ?4, ?5)",
            params![
                &did_result.did,
                options.mlkem_profile.as_str(),
                mlkem_private.encrypted_private_key,
                mlkem_private.nonce,
                &created_at
            ],
        )?;
        tx.commit()?;
    }

    Ok(WalletDidCreationResult {
        did: did_result.did,
        fingerprint: did_result.fingerprint,
        did_document: did_result.did_document,
        label: options.label,
        created_at,
    })
}

/// Lista os DIDs públicos armazenados em uma wallet.
pub fn wallet_list_dids(path: impl AsRef<Path>, password: &str) -> Result<Vec<WalletDidSummary>> {
    let wallet = unlock_wallet(path, password)?;
    let mut statement = wallet.conn.prepare(
        "SELECT did, label, mldsa_alg, mlkem_alg, status, created_at, did_doc_cid
         FROM dids
         ORDER BY created_at ASC, did ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(WalletDidSummary {
            did: row.get(0)?,
            label: row.get(1)?,
            mldsa_alg: row.get(2)?,
            mlkem_alg: row.get(3)?,
            status: row.get(4)?,
            created_at: row.get(5)?,
            did_doc_cid: row.get(6)?,
        })
    })?;

    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

/// Recupera o DID Document público de um DID armazenado na wallet.
pub fn wallet_get_did_document(
    path: impl AsRef<Path>,
    password: &str,
    did: &str,
) -> Result<DidDocument> {
    let wallet = unlock_wallet(path, password)?;
    wallet_get_did_document_from_unlocked(&wallet, did)
}

/// Emite uma credencial usando a chave privada ML-DSA guardada na wallet.
pub fn wallet_issue_credential_from_schema(
    path: impl AsRef<Path>,
    password: &str,
    did: &str,
    schema: &SchemaDocument,
    attributes: &serde_json::Value,
    options: CredentialIssueOptions,
) -> Result<SignedCredential> {
    let wallet = unlock_wallet(path, password)?;
    let did_document = wallet_get_did_document_from_unlocked(&wallet, did)?;
    let private_key = wallet_private_key_from_unlocked(&wallet, did, "#mldsa-1")?;

    credential::issue_credential_from_schema(
        schema,
        attributes,
        &did_document,
        &private_key,
        options,
    )
}

/// Embute uma credencial em um PDF usando a chave ML-DSA guardada na wallet.
pub fn wallet_embed_signed_credential_in_pdf(
    path: impl AsRef<Path>,
    password: &str,
    did: &str,
    pdf_base_bytes: &[u8],
    signed_credential: &SignedCredential,
    options: PdfBindingOptions,
) -> Result<Vec<u8>> {
    let wallet = unlock_wallet(path, password)?;
    let did_document = wallet_get_did_document_from_unlocked(&wallet, did)?;
    let private_key = wallet_private_key_from_unlocked(&wallet, did, "#mldsa-1")?;
    let final_pdf = pdf::embed_signed_credential_in_pdf(
        pdf_base_bytes,
        signed_credential,
        &did_document,
        &private_key,
        options,
    )?;
    record_signing_history(&wallet, did, signed_credential)?;

    Ok(final_pdf)
}

/// Assina um PDF genérico usando a chave ML-DSA guardada na wallet.
pub fn wallet_sign_generic_pdf(
    path: impl AsRef<Path>,
    password: &str,
    did: &str,
    pdf_base_bytes: &[u8],
    options: PdfSignOptions,
) -> Result<Vec<u8>> {
    let wallet = unlock_wallet(path, password)?;
    let did_document = wallet_get_did_document_from_unlocked(&wallet, did)?;
    let private_key = wallet_private_key_from_unlocked(&wallet, did, "#mldsa-1")?;

    pdf_sign::sign_generic_pdf(
        pdf_base_bytes,
        &did_document,
        &private_key,
        "#mldsa-1",
        options,
    )
}

/// Decapsula um segredo ML-KEM usando a chave privada guardada na wallet.
pub fn wallet_mlkem_decapsulate(
    path: impl AsRef<Path>,
    password: &str,
    did: &str,
    ciphertext: &[u8],
) -> Result<WalletMlkemDecapsulation> {
    let wallet = unlock_wallet(path, password)?;
    let did_document = wallet_get_did_document_from_unlocked(&wallet, did)?;
    let key = did_document
        .keys
        .iter()
        .find(|key| key.id == "#mlkem-1")
        .ok_or_else(|| SsiError::MissingDidKey("#mlkem-1".to_string()))?;
    let profile = key.key_type.parse::<MlKemProfile>()?;
    let private_key = wallet_private_key_from_unlocked(&wallet, did, "#mlkem-1")?;
    let shared_secret = mlkem::decapsulate(profile, &private_key, ciphertext)?;

    Ok(WalletMlkemDecapsulation {
        profile,
        shared_secret,
    })
}

fn unlock_wallet(path: impl AsRef<Path>, password: &str) -> Result<UnlockedWallet> {
    validate_password(password)?;
    let conn = open_sqlcipher_connection(path.as_ref(), password, false)?;
    let sqlcipher_version = sqlcipher_version(&conn)?;
    let metadata = load_metadata(&conn)?;
    let row_key = derive_row_key(password, &metadata.kdf_params)?;

    Ok(UnlockedWallet {
        conn,
        metadata,
        row_key,
        sqlcipher_version,
    })
}

fn open_sqlcipher_connection(path: &Path, password: &str, create: bool) -> Result<Connection> {
    let flags = if create {
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE
    } else {
        OpenFlags::SQLITE_OPEN_READ_WRITE
    };
    let conn = Connection::open_with_flags(path, flags)?;
    conn.pragma_update(None, "key", password)?;
    conn.execute_batch("PRAGMA temp_store = MEMORY;")?;
    let _ = conn.pragma_update(None, "cipher_memory_security", "ON");
    conn.pragma_update(None, "foreign_keys", "ON")?;
    ensure_sqlcipher_available(&conn)?;
    Ok(conn)
}

fn ensure_sqlcipher_available(conn: &Connection) -> Result<()> {
    let version = sqlcipher_version(conn)?;
    if version.is_empty() {
        return Err(SsiError::InvalidWallet(
            "SQLCipher support is not available".to_string(),
        ));
    }
    Ok(())
}

fn sqlcipher_version(conn: &Connection) -> Result<String> {
    let version = conn
        .query_row("PRAGMA cipher_version", [], |row| row.get::<_, String>(0))
        .optional()?
        .unwrap_or_default();
    Ok(version)
}

fn initialize_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE wallet_metadata (
            id TEXT PRIMARY KEY,
            version INTEGER NOT NULL,
            kdf_alg TEXT NOT NULL,
            kdf_params TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE dids (
            did TEXT PRIMARY KEY,
            label TEXT,
            mldsa_alg TEXT NOT NULL,
            mlkem_alg TEXT NOT NULL,
            mldsa_public_key TEXT NOT NULL,
            mlkem_public_key TEXT NOT NULL,
            did_doc_json TEXT NOT NULL,
            did_doc_cid TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE private_keys (
            did TEXT NOT NULL,
            key_id TEXT NOT NULL,
            key_type TEXT NOT NULL,
            encrypted_private_key BLOB NOT NULL,
            nonce BLOB NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (did, key_id),
            FOREIGN KEY (did) REFERENCES dids(did) ON DELETE CASCADE
        );

        CREATE TABLE signing_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            did TEXT NOT NULL,
            credential_id TEXT,
            pdf_base_hash TEXT,
            credential_hash TEXT,
            signed_at TEXT NOT NULL,
            FOREIGN KEY (did) REFERENCES dids(did) ON DELETE CASCADE
        );
        ",
    )?;
    Ok(())
}

fn insert_metadata(conn: &Connection, metadata: &WalletMetadata) -> Result<()> {
    conn.execute(
        "INSERT INTO wallet_metadata (id, version, kdf_alg, kdf_params, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            WALLET_METADATA_ID,
            metadata.version,
            metadata.kdf_alg,
            serde_json::to_string(&metadata.kdf_params)?,
            metadata.created_at
        ],
    )?;
    Ok(())
}

fn load_metadata(conn: &Connection) -> Result<WalletMetadata> {
    let row = conn
        .query_row(
            "SELECT id, version, kdf_alg, kdf_params, created_at
             FROM wallet_metadata
             WHERE id = ?1",
            params![WALLET_METADATA_ID],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u32>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(map_wallet_sqlite_error)?;
    let kdf_params = serde_json::from_str(&row.3)?;

    Ok(WalletMetadata {
        wallet_id: row.0,
        version: row.1,
        kdf_alg: row.2,
        kdf_params,
        created_at: row.4,
    })
}

fn wallet_info(
    conn: &Connection,
    metadata: &WalletMetadata,
    sqlcipher_version: String,
) -> Result<WalletInfo> {
    let did_count = conn.query_row("SELECT COUNT(*) FROM dids", [], |row| row.get::<_, u32>(0))?;
    Ok(WalletInfo {
        wallet_id: metadata.wallet_id.clone(),
        version: metadata.version,
        created_at: metadata.created_at.clone(),
        did_count,
        sqlcipher_version,
    })
}

fn new_kdf_params() -> Result<KdfParamsJson> {
    Ok(KdfParamsJson {
        salt: base64url_encode(&random_array::<ROW_KEY_SALT_SIZE>()?),
        memory_kib: ARGON2_MEMORY_KIB,
        time_cost: ARGON2_TIME_COST,
        parallelism: ARGON2_PARALLELISM,
        output_len: ROW_KEY_SIZE,
    })
}

fn derive_row_key(password: &str, params_json: &KdfParamsJson) -> Result<[u8; ROW_KEY_SIZE]> {
    if params_json.output_len != ROW_KEY_SIZE {
        return Err(SsiError::InvalidWallet(
            "unsupported wallet row key size".to_string(),
        ));
    }
    let salt = base64url_decode(&params_json.salt)?;
    let params = Params::new(
        params_json.memory_kib,
        params_json.time_cost,
        params_json.parallelism,
        Some(ROW_KEY_SIZE),
    )
    .map_err(|error| SsiError::Crypto(format!("argon2 params failed: {error}")))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; ROW_KEY_SIZE];
    argon2
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|error| SsiError::Crypto(format!("argon2 key derivation failed: {error}")))?;
    Ok(key)
}

fn encrypt_private_key(
    row_key: &[u8; ROW_KEY_SIZE],
    wallet_id: &str,
    did: &str,
    key_id: &str,
    key_type: &str,
    private_key: &[u8],
) -> Result<StoredPrivateKey> {
    let nonce = random_array::<PRIVATE_KEY_NONCE_SIZE>()?;
    let cipher = Aes256Gcm::new_from_slice(row_key)
        .map_err(|error| SsiError::Crypto(format!("AES-256-GCM key failed: {error}")))?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: private_key,
                aad: private_key_aad(wallet_id, did, key_id, key_type).as_bytes(),
            },
        )
        .map_err(|_| SsiError::Crypto("private key encryption failed".to_string()))?;

    Ok(StoredPrivateKey {
        did: did.to_string(),
        key_id: key_id.to_string(),
        key_type: key_type.to_string(),
        encrypted_private_key: ciphertext,
        nonce: nonce.to_vec(),
    })
}

fn decrypt_private_key(
    row_key: &[u8; ROW_KEY_SIZE],
    wallet_id: &str,
    private_key: &StoredPrivateKey,
) -> Result<Zeroizing<Vec<u8>>> {
    if private_key.nonce.len() != PRIVATE_KEY_NONCE_SIZE {
        return Err(SsiError::InvalidWallet(
            "invalid private key nonce size".to_string(),
        ));
    }
    let cipher = Aes256Gcm::new_from_slice(row_key)
        .map_err(|error| SsiError::Crypto(format!("AES-256-GCM key failed: {error}")))?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&private_key.nonce),
            Payload {
                msg: &private_key.encrypted_private_key,
                aad: private_key_aad(
                    wallet_id,
                    &private_key.did,
                    &private_key.key_id,
                    &private_key.key_type,
                )
                .as_bytes(),
            },
        )
        .map_err(|_| SsiError::InvalidWallet("private key decryption failed".to_string()))?;

    Ok(Zeroizing::new(plaintext))
}

fn private_key_aad(wallet_id: &str, did: &str, key_id: &str, key_type: &str) -> String {
    format!("SSI_WALLET_PRIVATE_KEY_V2|{wallet_id}|{did}|{key_id}|{key_type}")
}

fn load_plain_private_keys(wallet: &UnlockedWallet) -> Result<Vec<PlainPrivateKey>> {
    let mut statement = wallet.conn.prepare(
        "SELECT did, key_id, key_type, encrypted_private_key, nonce
         FROM private_keys",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(StoredPrivateKey {
            did: row.get(0)?,
            key_id: row.get(1)?,
            key_type: row.get(2)?,
            encrypted_private_key: row.get(3)?,
            nonce: row.get(4)?,
        })
    })?;
    let mut output = Vec::new();
    for row in rows {
        let stored = row?;
        output.push(PlainPrivateKey {
            did: stored.did.clone(),
            key_id: stored.key_id.clone(),
            key_type: stored.key_type.clone(),
            private_key: decrypt_private_key(&wallet.row_key, &wallet.metadata.wallet_id, &stored)?,
        });
    }
    Ok(output)
}

fn wallet_private_key_from_unlocked(
    wallet: &UnlockedWallet,
    did: &str,
    key_id: &str,
) -> Result<Zeroizing<Vec<u8>>> {
    let stored = wallet.conn.query_row(
        "SELECT did, key_id, key_type, encrypted_private_key, nonce
         FROM private_keys
         WHERE did = ?1 AND key_id = ?2",
        params![did, key_id],
        |row| {
            Ok(StoredPrivateKey {
                did: row.get(0)?,
                key_id: row.get(1)?,
                key_type: row.get(2)?,
                encrypted_private_key: row.get(3)?,
                nonce: row.get(4)?,
            })
        },
    )?;
    decrypt_private_key(&wallet.row_key, &wallet.metadata.wallet_id, &stored)
}

fn wallet_get_did_document_from_unlocked(
    wallet: &UnlockedWallet,
    did: &str,
) -> Result<DidDocument> {
    let did_doc_json = wallet.conn.query_row(
        "SELECT did_doc_json FROM dids WHERE did = ?1",
        params![did],
        |row| row.get::<_, String>(0),
    )?;
    did::did_document_from_json(serde_json::from_str(&did_doc_json)?)
}

fn record_signing_history(
    wallet: &UnlockedWallet,
    did: &str,
    signed_credential: &SignedCredential,
) -> Result<()> {
    let signed_value = serde_json::to_value(signed_credential)?;
    let credential_hash = base64url_encode(&crate::hash::sha3_256(
        &canonical_json::canonical_json_bytes(&signed_value),
    ));
    wallet.conn.execute(
        "INSERT INTO signing_history (
            did, credential_id, pdf_base_hash, credential_hash, signed_at
         ) VALUES (?1, ?2, NULL, ?3, ?4)",
        params![
            did,
            signed_credential.credential.credential_id,
            credential_hash,
            signed_credential.credential.issued_at
        ],
    )?;
    Ok(())
}

fn did_key_multibase(did_document: &DidDocument, key_id: &str) -> Result<String> {
    did_document
        .keys
        .iter()
        .find(|key| key.id == key_id)
        .map(|key| key.public_key_multibase.clone())
        .ok_or_else(|| SsiError::MissingDidKey(key_id.to_string()))
}

fn validate_password(password: &str) -> Result<()> {
    if password.is_empty() {
        return Err(SsiError::InvalidWallet(
            "wallet password cannot be empty".to_string(),
        ));
    }
    Ok(())
}

fn ensure_parent_dir(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)
            .map_err(|error| SsiError::InvalidWallet(error.to_string()))?;
    }
    Ok(())
}

fn random_wallet_id() -> Result<String> {
    Ok(format!(
        "wallet_{}",
        multibase_base58btc_encode(&random_array::<16>()?)
    ))
}

fn map_wallet_sqlite_error(error: rusqlite::Error) -> SsiError {
    let message = error.to_string();
    if message.contains("file is not a database")
        || message.contains("database disk image is malformed")
        || message.contains("hmac check failed")
    {
        SsiError::InvalidWallet("wallet password is invalid or database is corrupted".to_string())
    } else {
        SsiError::Sqlite(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        credential::{SignedCredentialVersion, verify_signed_credential},
        schema::{SchemaCreateOptions, create_schema_from_attributes},
    };
    use serde_json::json;
    use std::path::PathBuf;

    fn wallet_path(name: &str) -> PathBuf {
        let suffix = multibase_base58btc_encode(&random_array::<8>().unwrap());
        std::env::temp_dir().join(format!("ssi_pq_core_{name}_{suffix}.db"))
    }

    #[test]
    fn wallet_stores_did_and_uses_private_key_without_exporting_it() {
        let path = wallet_path("did_roundtrip");
        let password = "correct horse battery staple";

        let created = create_wallet(
            &path,
            password,
            WalletCreateOptions {
                created_at: "2026-05-27T00:00:00Z".to_string(),
            },
        )
        .unwrap();
        assert_eq!(created.did_count, 0);
        assert!(!created.sqlcipher_version.is_empty());

        let did_result = wallet_create_did(
            &path,
            password,
            WalletDidCreateOptions {
                label: Some("issuer".to_string()),
                mldsa_profile: MlDsaProfile::MlDsa65,
                mlkem_profile: MlKemProfile::MlKem768,
                created_at: "2026-05-27T00:00:00Z".to_string(),
                did_doc_cid: None,
            },
        )
        .unwrap();
        let dids = wallet_list_dids(&path, password).unwrap();

        assert_eq!(dids.len(), 1);
        assert_eq!(dids[0].did, did_result.did);
        assert!(did::verify_did_document(&did_result.did_document).unwrap());

        let schema = create_schema_from_attributes(
            &json!({"nome": "Ana Silva", "curso": "Criptografia Aplicada"}),
            SchemaCreateOptions {
                version: "1".to_string(),
                created_at: "2026-05-27T00:00:00Z".to_string(),
            },
        )
        .unwrap();
        let signed = wallet_issue_credential_from_schema(
            &path,
            password,
            &did_result.did,
            &schema,
            &json!({"nome": "Ana Silva", "curso": "Criptografia Aplicada"}),
            CredentialIssueOptions {
                credential_id: Some("cred_wallet_test".to_string()),
                issued_at: "2026-05-27T00:00:00Z".to_string(),
                expires_at: None,
                status_ref: None,
                visible_paths: None,
                credential_version: SignedCredentialVersion::V2,
            },
        )
        .unwrap();

        assert!(verify_signed_credential(&signed, &did_result.did_document).unwrap());
        assert!(open_wallet(&path, "wrong password").is_err());

        let raw_file = std::fs::read(&path).unwrap();
        assert!(
            !raw_file
                .windows(did_result.did.len())
                .any(|window| window == did_result.did.as_bytes())
        );
        assert!(
            !raw_file
                .windows(b"SQLite format 3".len())
                .any(|window| window == b"SQLite format 3")
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn wallet_password_change_keeps_private_keys_usable() {
        let path = wallet_path("password_change");
        let old_password = "old secure password";
        let new_password = "new secure password";

        create_wallet(
            &path,
            old_password,
            WalletCreateOptions {
                created_at: "2026-05-27T00:00:00Z".to_string(),
            },
        )
        .unwrap();
        let did_result = wallet_create_did(
            &path,
            old_password,
            WalletDidCreateOptions {
                label: None,
                mldsa_profile: MlDsaProfile::MlDsa65,
                mlkem_profile: MlKemProfile::MlKem768,
                created_at: "2026-05-27T00:00:00Z".to_string(),
                did_doc_cid: None,
            },
        )
        .unwrap();
        change_wallet_password(&path, old_password, new_password).unwrap();

        assert!(open_wallet(&path, old_password).is_err());
        assert_eq!(open_wallet(&path, new_password).unwrap().did_count, 1);
        assert_eq!(
            wallet_get_did_document(&path, new_password, &did_result.did)
                .unwrap()
                .id,
            did_result.did
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn wallet_connection_keeps_temp_store_in_memory() {
        let path = wallet_path("temp_store");
        let password = "secure temp store password";

        create_wallet(
            &path,
            password,
            WalletCreateOptions {
                created_at: "2026-05-27T00:00:00Z".to_string(),
            },
        )
        .unwrap();

        let conn = open_sqlcipher_connection(&path, password, false).unwrap();
        let temp_store = conn
            .query_row("PRAGMA temp_store", [], |row| row.get::<_, u32>(0))
            .unwrap();

        assert_eq!(temp_store, 2);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn private_key_aad_binds_ciphertext_to_wallet_id() {
        let row_key = random_array::<ROW_KEY_SIZE>().unwrap();
        let stored = encrypt_private_key(
            &row_key,
            "wallet_one",
            "did:ssipq:zabc",
            "#mldsa-1",
            "ML-DSA-65",
            b"private key bytes",
        )
        .unwrap();

        let plaintext = decrypt_private_key(&row_key, "wallet_one", &stored).unwrap();
        assert_eq!(plaintext.as_slice(), b"private key bytes");
        assert!(decrypt_private_key(&row_key, "wallet_two", &stored).is_err());
    }
}
