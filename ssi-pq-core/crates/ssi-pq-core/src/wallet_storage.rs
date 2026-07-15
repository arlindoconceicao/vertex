use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use crate::{
    Result, SsiError, canonical_json,
    credential::{self, CredentialIssueOptions, SignedCredential},
    crypto::mlkem,
    did::{self, DidDocument},
    encoding::{base64url_decode, base64url_encode},
    pdf::{self, PdfBindingOptions},
    pdf_sign::{self, PdfSignOptions},
    ports::Storage,
    profiles::{MlDsaProfile, MlKemProfile},
    random::random_array,
    schema::SchemaDocument,
    wallet_core::{
        PreparedWalletDid, RowKey, StoredPrivateKey, WalletCoreDidCreateOptions, WalletMetadata,
        decrypt_private_key, derive_row_key, encrypt_private_key, new_wallet_metadata,
        prepare_wallet_did, rekey_wallet_metadata, validate_password,
    },
};

const STORAGE_PREFIX: &str = "ssi-pq-wallet-storage/v1";
const STATE_NONCE_SIZE: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageWalletCreateOptions {
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageWalletDidCreateOptions {
    pub label: Option<String>,
    pub mldsa_profile: MlDsaProfile,
    pub mlkem_profile: MlKemProfile,
    pub created_at: String,
    pub did_doc_cid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StorageWalletInfo {
    pub wallet_id: String,
    pub version: u32,
    pub created_at: String,
    pub did_count: u32,
    pub backend: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StorageWalletDidSummary {
    pub did: String,
    pub label: Option<String>,
    pub mldsa_alg: String,
    pub mlkem_alg: String,
    pub status: String,
    pub created_at: String,
    pub did_doc_cid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StorageWalletDidCreationResult {
    pub did: String,
    pub fingerprint: String,
    pub did_document: DidDocument,
    pub label: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageWalletMlkemDecapsulation {
    pub profile: MlKemProfile,
    pub shared_secret: Zeroizing<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct StorageDidRecord {
    did: String,
    label: Option<String>,
    mldsa_alg: String,
    mlkem_alg: String,
    mldsa_public_key: String,
    mlkem_public_key: String,
    did_doc_json: String,
    did_doc_cid: Option<String>,
    status: String,
    created_at: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct StorageWalletState {
    dids: Vec<StorageDidRecord>,
    private_keys: Vec<StoredPrivateKey>,
    signing_history: Vec<StorageSigningHistoryRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct StorageSigningHistoryRecord {
    did: String,
    credential_id: String,
    credential_hash: String,
    signed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct EncryptedState {
    nonce: String,
    ciphertext: String,
}

struct UnlockedStorageWallet<'a, S: Storage + ?Sized> {
    storage: &'a S,
    namespace: String,
    metadata: WalletMetadata,
    row_key: RowKey,
    state: StorageWalletState,
}

impl<S: Storage + ?Sized> Drop for UnlockedStorageWallet<'_, S> {
    fn drop(&mut self) {
        self.row_key.zeroize();
    }
}

pub fn create_wallet(
    storage: &(impl Storage + ?Sized),
    namespace: &str,
    password: &str,
    options: StorageWalletCreateOptions,
) -> Result<StorageWalletInfo> {
    validate_namespace(namespace)?;
    validate_password(password)?;
    if storage.get(&metadata_key(namespace))?.is_some() {
        return Err(SsiError::InvalidWallet(format!(
            "wallet already exists: {namespace}"
        )));
    }

    let metadata = new_wallet_metadata(options.created_at)?;
    let row_key = derive_row_key(password, &metadata.kdf_params)?;
    let state = StorageWalletState::default();
    storage.put(&metadata_key(namespace), &serde_json::to_vec(&metadata)?)?;
    put_state(storage, namespace, &metadata, &row_key, &state)?;

    Ok(wallet_info(&metadata, &state))
}

pub fn open_wallet(
    storage: &(impl Storage + ?Sized),
    namespace: &str,
    password: &str,
) -> Result<StorageWalletInfo> {
    let wallet = unlock_wallet(storage, namespace, password)?;
    Ok(wallet_info(&wallet.metadata, &wallet.state))
}

pub fn change_wallet_password(
    storage: &(impl Storage + ?Sized),
    namespace: &str,
    old_password: &str,
    new_password: &str,
) -> Result<StorageWalletInfo> {
    validate_password(new_password)?;
    let mut wallet = unlock_wallet(storage, namespace, old_password)?;
    let mut plain_private_keys = Vec::new();

    for private_key in &wallet.state.private_keys {
        plain_private_keys.push((
            private_key.did.clone(),
            private_key.key_id.clone(),
            private_key.key_type.clone(),
            decrypt_private_key(&wallet.row_key, &wallet.metadata.wallet_id, private_key)?,
        ));
    }

    let new_metadata = rekey_wallet_metadata(&wallet.metadata)?;
    let new_row_key = derive_row_key(new_password, &new_metadata.kdf_params)?;
    let mut new_private_keys = Vec::new();

    for (did, key_id, key_type, private_key) in plain_private_keys {
        new_private_keys.push(encrypt_private_key(
            &new_row_key,
            &new_metadata.wallet_id,
            &did,
            &key_id,
            &key_type,
            &private_key,
        )?);
    }

    wallet.metadata = new_metadata;
    wallet.row_key.zeroize();
    wallet.row_key = new_row_key;
    wallet.state.private_keys = new_private_keys;
    put_metadata(wallet.storage, &wallet.namespace, &wallet.metadata)?;
    put_state(
        wallet.storage,
        &wallet.namespace,
        &wallet.metadata,
        &wallet.row_key,
        &wallet.state,
    )?;

    Ok(wallet_info(&wallet.metadata, &wallet.state))
}

pub fn wallet_create_did(
    storage: &(impl Storage + ?Sized),
    namespace: &str,
    password: &str,
    options: StorageWalletDidCreateOptions,
) -> Result<StorageWalletDidCreationResult> {
    let mut wallet = unlock_wallet(storage, namespace, password)?;
    let prepared = prepare_wallet_did(
        &wallet.row_key,
        &wallet.metadata,
        WalletCoreDidCreateOptions {
            label: options.label,
            mldsa_profile: options.mldsa_profile,
            mlkem_profile: options.mlkem_profile,
            created_at: options.created_at,
            did_doc_cid: options.did_doc_cid,
        },
    )?;

    if wallet
        .state
        .dids
        .iter()
        .any(|record| record.did == prepared.did)
    {
        return Err(SsiError::InvalidWallet(format!(
            "DID already exists in wallet: {}",
            prepared.did
        )));
    }

    wallet.state.dids.push(storage_did_record(&prepared));
    wallet.state.private_keys.push(prepared.mldsa_private_key);
    wallet.state.private_keys.push(prepared.mlkem_private_key);
    put_state(
        wallet.storage,
        &wallet.namespace,
        &wallet.metadata,
        &wallet.row_key,
        &wallet.state,
    )?;

    Ok(StorageWalletDidCreationResult {
        did: prepared.did,
        fingerprint: prepared.fingerprint,
        did_document: prepared.did_document,
        label: prepared.label,
        created_at: prepared.created_at,
    })
}

pub fn wallet_list_dids(
    storage: &(impl Storage + ?Sized),
    namespace: &str,
    password: &str,
) -> Result<Vec<StorageWalletDidSummary>> {
    let wallet = unlock_wallet(storage, namespace, password)?;
    let mut dids = wallet
        .state
        .dids
        .iter()
        .map(|record| StorageWalletDidSummary {
            did: record.did.clone(),
            label: record.label.clone(),
            mldsa_alg: record.mldsa_alg.clone(),
            mlkem_alg: record.mlkem_alg.clone(),
            status: record.status.clone(),
            created_at: record.created_at.clone(),
            did_doc_cid: record.did_doc_cid.clone(),
        })
        .collect::<Vec<_>>();

    dids.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.did.cmp(&right.did))
    });
    Ok(dids)
}

pub fn wallet_get_did_document(
    storage: &(impl Storage + ?Sized),
    namespace: &str,
    password: &str,
    did: &str,
) -> Result<DidDocument> {
    let wallet = unlock_wallet(storage, namespace, password)?;
    did_document_from_state(&wallet.state, did)
}

pub fn wallet_issue_credential_from_schema(
    storage: &(impl Storage + ?Sized),
    namespace: &str,
    password: &str,
    did: &str,
    schema: &SchemaDocument,
    attributes: &serde_json::Value,
    options: CredentialIssueOptions,
) -> Result<SignedCredential> {
    let wallet = unlock_wallet(storage, namespace, password)?;
    let did_document = did_document_from_state(&wallet.state, did)?;
    let private_key = private_key_from_state(&wallet, did, "#mldsa-1")?;

    credential::issue_credential_from_schema(
        schema,
        attributes,
        &did_document,
        &private_key,
        options,
    )
}

pub fn wallet_embed_signed_credential_in_pdf(
    storage: &(impl Storage + ?Sized),
    namespace: &str,
    password: &str,
    did: &str,
    pdf_base_bytes: &[u8],
    signed_credential: &SignedCredential,
    options: PdfBindingOptions,
) -> Result<Vec<u8>> {
    let mut wallet = unlock_wallet(storage, namespace, password)?;
    let did_document = did_document_from_state(&wallet.state, did)?;
    let private_key = private_key_from_state(&wallet, did, "#mldsa-1")?;
    let final_pdf = pdf::embed_signed_credential_in_pdf(
        pdf_base_bytes,
        signed_credential,
        &did_document,
        &private_key,
        options,
    )?;

    record_signing_history(&mut wallet, did, signed_credential)?;
    put_state(
        wallet.storage,
        &wallet.namespace,
        &wallet.metadata,
        &wallet.row_key,
        &wallet.state,
    )?;

    Ok(final_pdf)
}

pub fn wallet_sign_generic_pdf(
    storage: &(impl Storage + ?Sized),
    namespace: &str,
    password: &str,
    did: &str,
    pdf_base_bytes: &[u8],
    options: PdfSignOptions,
) -> Result<Vec<u8>> {
    let wallet = unlock_wallet(storage, namespace, password)?;
    let did_document = did_document_from_state(&wallet.state, did)?;
    let private_key = private_key_from_state(&wallet, did, "#mldsa-1")?;

    pdf_sign::sign_generic_pdf(
        pdf_base_bytes,
        &did_document,
        &private_key,
        "#mldsa-1",
        options,
    )
}

pub fn wallet_mlkem_decapsulate(
    storage: &(impl Storage + ?Sized),
    namespace: &str,
    password: &str,
    did: &str,
    ciphertext: &[u8],
) -> Result<StorageWalletMlkemDecapsulation> {
    let wallet = unlock_wallet(storage, namespace, password)?;
    let did_document = did_document_from_state(&wallet.state, did)?;
    let key = did_document
        .keys
        .iter()
        .find(|key| key.id == "#mlkem-1")
        .ok_or_else(|| SsiError::MissingDidKey("#mlkem-1".to_string()))?;
    let profile = key.key_type.parse::<MlKemProfile>()?;
    let private_key = private_key_from_state(&wallet, did, "#mlkem-1")?;
    let shared_secret = mlkem::decapsulate(profile, &private_key, ciphertext)?;

    Ok(StorageWalletMlkemDecapsulation {
        profile,
        shared_secret,
    })
}

fn unlock_wallet<'a, S: Storage + ?Sized>(
    storage: &'a S,
    namespace: &str,
    password: &str,
) -> Result<UnlockedStorageWallet<'a, S>> {
    validate_namespace(namespace)?;
    validate_password(password)?;
    let metadata = load_metadata(storage, namespace)?;
    let row_key = derive_row_key(password, &metadata.kdf_params)?;
    let state = load_state(storage, namespace, &metadata, &row_key)?;

    Ok(UnlockedStorageWallet {
        storage,
        namespace: namespace.to_string(),
        metadata,
        row_key,
        state,
    })
}

fn put_metadata(
    storage: &(impl Storage + ?Sized),
    namespace: &str,
    metadata: &WalletMetadata,
) -> Result<()> {
    storage.put(&metadata_key(namespace), &serde_json::to_vec(metadata)?)
}

fn load_metadata(storage: &(impl Storage + ?Sized), namespace: &str) -> Result<WalletMetadata> {
    let bytes = storage
        .get(&metadata_key(namespace))?
        .ok_or_else(|| SsiError::InvalidWallet(format!("wallet not found: {namespace}")))?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn put_state(
    storage: &(impl Storage + ?Sized),
    namespace: &str,
    metadata: &WalletMetadata,
    row_key: &RowKey,
    state: &StorageWalletState,
) -> Result<()> {
    storage.put(
        &state_key(namespace),
        &encrypt_state(namespace, metadata, row_key, state)?,
    )
}

fn load_state(
    storage: &(impl Storage + ?Sized),
    namespace: &str,
    metadata: &WalletMetadata,
    row_key: &RowKey,
) -> Result<StorageWalletState> {
    let bytes = storage
        .get(&state_key(namespace))?
        .ok_or_else(|| SsiError::InvalidWallet("wallet state not found".to_string()))?;
    decrypt_state(namespace, metadata, row_key, &bytes)
}

fn encrypt_state(
    namespace: &str,
    metadata: &WalletMetadata,
    row_key: &RowKey,
    state: &StorageWalletState,
) -> Result<Vec<u8>> {
    let nonce = random_array::<STATE_NONCE_SIZE>()?;
    let cipher = Aes256Gcm::new_from_slice(row_key)
        .map_err(|error| SsiError::Crypto(format!("AES-256-GCM key failed: {error}")))?;
    let plaintext = serde_json::to_vec(state)?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: state_aad(namespace, &metadata.wallet_id).as_bytes(),
            },
        )
        .map_err(|_| SsiError::Crypto("wallet state encryption failed".to_string()))?;
    let encrypted = EncryptedState {
        nonce: base64url_encode(&nonce),
        ciphertext: base64url_encode(&ciphertext),
    };

    Ok(serde_json::to_vec(&encrypted)?)
}

fn decrypt_state(
    namespace: &str,
    metadata: &WalletMetadata,
    row_key: &RowKey,
    bytes: &[u8],
) -> Result<StorageWalletState> {
    let encrypted: EncryptedState = serde_json::from_slice(bytes)?;
    let nonce = base64url_decode(&encrypted.nonce)?;
    let ciphertext = base64url_decode(&encrypted.ciphertext)?;
    if nonce.len() != STATE_NONCE_SIZE {
        return Err(SsiError::InvalidWallet(
            "invalid wallet state nonce size".to_string(),
        ));
    }
    let cipher = Aes256Gcm::new_from_slice(row_key)
        .map_err(|error| SsiError::Crypto(format!("AES-256-GCM key failed: {error}")))?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: state_aad(namespace, &metadata.wallet_id).as_bytes(),
            },
        )
        .map_err(|_| SsiError::InvalidWallet("wallet password is invalid".to_string()))?;
    let plaintext = Zeroizing::new(plaintext);

    Ok(serde_json::from_slice(plaintext.as_slice())?)
}

fn wallet_info(metadata: &WalletMetadata, state: &StorageWalletState) -> StorageWalletInfo {
    StorageWalletInfo {
        wallet_id: metadata.wallet_id.clone(),
        version: metadata.version,
        created_at: metadata.created_at.clone(),
        did_count: state.dids.len() as u32,
        backend: "storage".to_string(),
    }
}

fn storage_did_record(prepared: &PreparedWalletDid) -> StorageDidRecord {
    StorageDidRecord {
        did: prepared.did.clone(),
        label: prepared.label.clone(),
        mldsa_alg: prepared.mldsa_alg.clone(),
        mlkem_alg: prepared.mlkem_alg.clone(),
        mldsa_public_key: prepared.mldsa_public_key.clone(),
        mlkem_public_key: prepared.mlkem_public_key.clone(),
        did_doc_json: prepared.did_doc_json.clone(),
        did_doc_cid: prepared.did_doc_cid.clone(),
        status: "active".to_string(),
        created_at: prepared.created_at.clone(),
    }
}

fn did_document_from_state(state: &StorageWalletState, did: &str) -> Result<DidDocument> {
    let record = state
        .dids
        .iter()
        .find(|record| record.did == did)
        .ok_or_else(|| SsiError::InvalidWallet(format!("DID not found in wallet: {did}")))?;
    did::did_document_from_json(serde_json::from_str(&record.did_doc_json)?)
}

fn private_key_from_state(
    wallet: &UnlockedStorageWallet<'_, impl Storage + ?Sized>,
    did: &str,
    key_id: &str,
) -> Result<Zeroizing<Vec<u8>>> {
    let stored = wallet
        .state
        .private_keys
        .iter()
        .find(|private_key| private_key.did == did && private_key.key_id == key_id)
        .ok_or_else(|| SsiError::MissingDidKey(key_id.to_string()))?;
    decrypt_private_key(&wallet.row_key, &wallet.metadata.wallet_id, stored)
}

fn record_signing_history(
    wallet: &mut UnlockedStorageWallet<'_, impl Storage + ?Sized>,
    did: &str,
    signed_credential: &SignedCredential,
) -> Result<()> {
    let signed_value = serde_json::to_value(signed_credential)?;
    let credential_hash = base64url_encode(&crate::hash::sha3_256(
        &canonical_json::canonical_json_bytes(&signed_value),
    ));
    wallet
        .state
        .signing_history
        .push(StorageSigningHistoryRecord {
            did: did.to_string(),
            credential_id: signed_credential.credential.credential_id.clone(),
            credential_hash,
            signed_at: signed_credential.credential.issued_at.clone(),
        });
    Ok(())
}

fn metadata_key(namespace: &str) -> String {
    format!(
        "{}/{}/metadata",
        STORAGE_PREFIX,
        storage_namespace(namespace)
    )
}

fn state_key(namespace: &str) -> String {
    format!("{}/{}/state", STORAGE_PREFIX, storage_namespace(namespace))
}

fn storage_namespace(namespace: &str) -> String {
    base64url_encode(namespace.as_bytes())
}

fn state_aad(namespace: &str, wallet_id: &str) -> String {
    format!("SSI_STORAGE_WALLET_STATE_V1|{namespace}|{wallet_id}")
}

fn validate_namespace(namespace: &str) -> Result<()> {
    if namespace.is_empty() {
        return Err(SsiError::InvalidWallet(
            "wallet namespace cannot be empty".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        credential::{SignedCredentialVersion, verify_signed_credential},
        ports::Storage,
        schema::{SchemaCreateOptions, create_schema_from_attributes},
    };
    use std::{
        collections::BTreeMap,
        sync::{Arc, Mutex},
    };

    #[derive(Debug, Default, Clone)]
    struct MemoryStorage {
        entries: Arc<Mutex<BTreeMap<String, Vec<u8>>>>,
    }

    impl Storage for MemoryStorage {
        fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
            Ok(self.entries.lock().unwrap().get(key).cloned())
        }

        fn put(&self, key: &str, value: &[u8]) -> Result<()> {
            self.entries
                .lock()
                .unwrap()
                .insert(key.to_string(), value.to_vec());
            Ok(())
        }

        fn delete(&self, key: &str) -> Result<()> {
            self.entries.lock().unwrap().remove(key);
            Ok(())
        }
    }

    #[test]
    fn storage_wallet_uses_encrypted_state_and_keeps_private_keys_internal() {
        let storage = MemoryStorage::default();
        let password = "senha storage forte";
        let namespace = "issuer";

        let created = create_wallet(
            &storage,
            namespace,
            password,
            StorageWalletCreateOptions {
                created_at: "2026-05-27T00:00:00Z".to_string(),
            },
        )
        .unwrap();
        assert_eq!(created.did_count, 0);
        assert_eq!(created.backend, "storage");

        let did_result = wallet_create_did(
            &storage,
            namespace,
            password,
            StorageWalletDidCreateOptions {
                label: Some("issuer".to_string()),
                mldsa_profile: MlDsaProfile::MlDsa65,
                mlkem_profile: MlKemProfile::MlKem768,
                created_at: "2026-05-27T00:00:00Z".to_string(),
                did_doc_cid: None,
            },
        )
        .unwrap();
        let opened = open_wallet(&storage, namespace, password).unwrap();
        let dids = wallet_list_dids(&storage, namespace, password).unwrap();

        assert_eq!(opened.did_count, 1);
        assert_eq!(dids.len(), 1);
        assert_eq!(dids[0].did, did_result.did);
        assert!(open_wallet(&storage, namespace, "senha errada").is_err());

        let state = storage.get(&state_key(namespace)).unwrap().unwrap();
        assert!(
            !state
                .windows(did_result.did.len())
                .any(|window| { window == did_result.did.as_bytes() })
        );

        let schema = create_schema_from_attributes(
            &serde_json::json!({"nome": "Ana Silva", "curso": "Criptografia Aplicada"}),
            SchemaCreateOptions {
                version: "1".to_string(),
                created_at: "2026-05-27T00:00:00Z".to_string(),
            },
        )
        .unwrap();
        let signed = wallet_issue_credential_from_schema(
            &storage,
            namespace,
            password,
            &did_result.did,
            &schema,
            &serde_json::json!({"nome": "Ana Silva", "curso": "Criptografia Aplicada"}),
            CredentialIssueOptions {
                credential_id: Some("cred_storage_wallet_test".to_string()),
                issued_at: "2026-05-27T00:00:00Z".to_string(),
                expires_at: None,
                status_ref: None,
                visible_paths: None,
                credential_version: SignedCredentialVersion::V2,
            },
        )
        .unwrap();

        assert!(verify_signed_credential(&signed, &did_result.did_document).unwrap());
    }
}
