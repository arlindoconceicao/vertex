use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::{
    Result, SsiError, canonical_json,
    did::{self, DidDocument},
    encoding::{base64url_decode, base64url_encode, multibase_base58btc_encode},
    profiles::{MlDsaProfile, MlKemProfile},
    random::random_array,
};

pub const WALLET_METADATA_ID: &str = "default";
pub const WALLET_VERSION: u32 = 2;
pub const ROW_KEY_SIZE: usize = 32;

const ARGON2_MEMORY_KIB: u32 = 19 * 1024;
const ARGON2_TIME_COST: u32 = 2;
const ARGON2_PARALLELISM: u32 = 1;
const ROW_KEY_SALT_SIZE: usize = 32;
const PRIVATE_KEY_NONCE_SIZE: usize = 12;

pub type RowKey = [u8; ROW_KEY_SIZE];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WalletMetadata {
    pub wallet_id: String,
    pub version: u32,
    pub kdf_alg: String,
    pub kdf_params: KdfParamsJson,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfParamsJson {
    pub salt: String,
    pub memory_kib: u32,
    pub time_cost: u32,
    pub parallelism: u32,
    pub output_len: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredPrivateKey {
    pub did: String,
    pub key_id: String,
    pub key_type: String,
    pub encrypted_private_key: Vec<u8>,
    pub nonce: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlainPrivateKey {
    pub did: String,
    pub key_id: String,
    pub key_type: String,
    pub private_key: Zeroizing<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalletCoreDidCreateOptions {
    pub label: Option<String>,
    pub mldsa_profile: MlDsaProfile,
    pub mlkem_profile: MlKemProfile,
    pub created_at: String,
    pub did_doc_cid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedWalletDid {
    pub did: String,
    pub fingerprint: String,
    pub did_document: DidDocument,
    pub did_doc_json: String,
    pub label: Option<String>,
    pub mldsa_alg: String,
    pub mlkem_alg: String,
    pub mldsa_public_key: String,
    pub mlkem_public_key: String,
    pub mldsa_private_key: StoredPrivateKey,
    pub mlkem_private_key: StoredPrivateKey,
    pub created_at: String,
    pub did_doc_cid: Option<String>,
}

pub fn validate_password(password: &str) -> Result<()> {
    if password.is_empty() {
        return Err(SsiError::InvalidWallet(
            "wallet password cannot be empty".to_string(),
        ));
    }
    Ok(())
}

pub fn new_wallet_metadata(created_at: String) -> Result<WalletMetadata> {
    crate::time::validate_rfc3339_timestamp("created_at", &created_at)
        .map_err(SsiError::InvalidWallet)?;

    Ok(WalletMetadata {
        wallet_id: random_wallet_id()?,
        version: WALLET_VERSION,
        kdf_alg: "Argon2id".to_string(),
        kdf_params: new_kdf_params()?,
        created_at,
    })
}

pub fn rekey_wallet_metadata(metadata: &WalletMetadata) -> Result<WalletMetadata> {
    Ok(WalletMetadata {
        wallet_id: metadata.wallet_id.clone(),
        version: metadata.version,
        kdf_alg: metadata.kdf_alg.clone(),
        kdf_params: new_kdf_params()?,
        created_at: metadata.created_at.clone(),
    })
}

pub fn new_kdf_params() -> Result<KdfParamsJson> {
    Ok(KdfParamsJson {
        salt: base64url_encode(&random_array::<ROW_KEY_SALT_SIZE>()?),
        memory_kib: ARGON2_MEMORY_KIB,
        time_cost: ARGON2_TIME_COST,
        parallelism: ARGON2_PARALLELISM,
        output_len: ROW_KEY_SIZE,
    })
}

pub fn derive_row_key(password: &str, params_json: &KdfParamsJson) -> Result<RowKey> {
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

pub fn prepare_wallet_did(
    row_key: &RowKey,
    metadata: &WalletMetadata,
    options: WalletCoreDidCreateOptions,
) -> Result<PreparedWalletDid> {
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
    let mldsa_alg = options.mldsa_profile.as_str().to_string();
    let mlkem_alg = options.mlkem_profile.as_str().to_string();
    let mldsa_private_key = encrypt_private_key(
        row_key,
        &metadata.wallet_id,
        &did_result.did,
        "#mldsa-1",
        &mldsa_alg,
        &did_result.mldsa_private_key,
    )?;
    let mlkem_private_key = encrypt_private_key(
        row_key,
        &metadata.wallet_id,
        &did_result.did,
        "#mlkem-1",
        &mlkem_alg,
        &did_result.mlkem_private_key,
    )?;

    Ok(PreparedWalletDid {
        did: did_result.did,
        fingerprint: did_result.fingerprint,
        did_document: did_result.did_document,
        did_doc_json,
        label: options.label,
        mldsa_alg,
        mlkem_alg,
        mldsa_public_key,
        mlkem_public_key,
        mldsa_private_key,
        mlkem_private_key,
        created_at,
        did_doc_cid: options.did_doc_cid,
    })
}

pub fn encrypt_private_key(
    row_key: &RowKey,
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

pub fn decrypt_private_key(
    row_key: &RowKey,
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

pub fn private_key_aad(wallet_id: &str, did: &str, key_id: &str, key_type: &str) -> String {
    format!("SSI_WALLET_PRIVATE_KEY_V2|{wallet_id}|{did}|{key_id}|{key_type}")
}

pub fn random_wallet_id() -> Result<String> {
    Ok(format!(
        "wallet_{}",
        multibase_base58btc_encode(&random_array::<16>()?)
    ))
}

fn did_key_multibase(did_document: &DidDocument, key_id: &str) -> Result<String> {
    did_document
        .keys
        .iter()
        .find(|key| key.id == key_id)
        .map(|key| key.public_key_multibase.clone())
        .ok_or_else(|| SsiError::MissingDidKey(key_id.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_key_derivation_is_stable_for_same_params() {
        let params = KdfParamsJson {
            salt: base64url_encode(&[7u8; ROW_KEY_SALT_SIZE]),
            memory_kib: 1024,
            time_cost: 1,
            parallelism: 1,
            output_len: ROW_KEY_SIZE,
        };

        let first = derive_row_key("senha forte", &params).unwrap();
        let second = derive_row_key("senha forte", &params).unwrap();
        let other = derive_row_key("outra senha", &params).unwrap();

        assert_eq!(first, second);
        assert_ne!(first, other);
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

    #[test]
    fn prepared_did_contains_public_record_and_encrypted_private_keys() {
        let metadata = WalletMetadata {
            wallet_id: "wallet_test".to_string(),
            version: WALLET_VERSION,
            kdf_alg: "Argon2id".to_string(),
            kdf_params: new_kdf_params().unwrap(),
            created_at: "2026-05-27T00:00:00Z".to_string(),
        };
        let row_key = random_array::<ROW_KEY_SIZE>().unwrap();
        let prepared = prepare_wallet_did(
            &row_key,
            &metadata,
            WalletCoreDidCreateOptions {
                label: Some("issuer".to_string()),
                mldsa_profile: MlDsaProfile::MlDsa65,
                mlkem_profile: MlKemProfile::MlKem768,
                created_at: "2026-05-27T00:00:00Z".to_string(),
                did_doc_cid: None,
            },
        )
        .unwrap();

        assert!(prepared.did.starts_with("did:ssipq:z"));
        assert_eq!(prepared.did_document.id, prepared.did);
        assert_eq!(prepared.mldsa_alg, "ML-DSA-65");
        assert_eq!(prepared.mlkem_alg, "ML-KEM-768");
        assert!(did::verify_did_document(&prepared.did_document).unwrap());
        assert!(
            decrypt_private_key(&row_key, &metadata.wallet_id, &prepared.mldsa_private_key).is_ok()
        );
        assert!(
            decrypt_private_key(&row_key, &metadata.wallet_id, &prepared.mlkem_private_key).is_ok()
        );
    }
}
