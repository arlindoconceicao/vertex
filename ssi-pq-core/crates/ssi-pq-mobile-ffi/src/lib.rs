uniffi::setup_scaffolding!();

use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde::Deserialize;
use ssi_pq_core::{
    SsiError,
    credential::{self, CredentialIssueOptions},
    crypto::{aes_gcm, mldsa, mlkem},
    did, encoding, hash,
    pdf::PdfBindingOptions,
    pdf_sign,
    ports::Storage,
    profiles::{MlDsaProfile, MlKemProfile},
    random, schema,
    wallet_storage::{self, StorageWalletCreateOptions, StorageWalletDidCreateOptions},
};

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum SsiPqMobileError {
    #[error("invalid input: {detail}")]
    InvalidInput { detail: String },
    #[error("cryptographic operation failed: {detail}")]
    Crypto { detail: String },
    #[error("wallet operation failed: {detail}")]
    Wallet { detail: String },
    #[error("PDF operation failed: {detail}")]
    Pdf { detail: String },
    #[error("storage operation failed: {detail}")]
    Storage { detail: String },
    #[error("file operation failed: {detail}")]
    Io { detail: String },
    #[error("capability unavailable: {detail}")]
    Unavailable { detail: String },
}

impl From<ssi_pq_core::CoreError> for SsiPqMobileError {
    fn from(error: ssi_pq_core::CoreError) -> Self {
        let detail = error.to_string();
        match error {
            SsiError::InvalidJson(_)
            | SsiError::InvalidBase64Url(_)
            | SsiError::UnsupportedProfile(_)
            | SsiError::InvalidMultibase(_)
            | SsiError::MissingDidKey(_)
            | SsiError::MissingDidSignature
            | SsiError::InvalidDidDocument(_)
            | SsiError::InvalidSchema(_)
            | SsiError::InvalidCredential(_)
            | SsiError::MissingAttribute(_)
            | SsiError::AttributeTypeMismatch { .. }
            | SsiError::InvalidLength { .. } => Self::InvalidInput { detail },
            SsiError::Io(_) => Self::Io { detail },
            SsiError::InvalidPdf(_) => Self::Pdf { detail },
            SsiError::InvalidWallet(_) => Self::Wallet { detail },
            SsiError::Randomness(_) | SsiError::Crypto(_) => Self::Crypto { detail },
            #[allow(unreachable_patterns)]
            _ => Self::Storage { detail },
        }
    }
}

impl From<serde_json::Error> for SsiPqMobileError {
    fn from(error: serde_json::Error) -> Self {
        SsiError::InvalidJson(error).into()
    }
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct KeyPair {
    pub profile: String,
    pub public_key: Vec<u8>,
    pub private_key: Vec<u8>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct MlkemEncapsulation {
    pub profile: String,
    pub ciphertext: Vec<u8>,
    pub shared_secret: Vec<u8>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct Aes256GcmEncryption {
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    pub auth_tag: Vec<u8>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FileOperationResult {
    pub output_uri: String,
    pub bytes_written: u64,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct WalletInfo {
    pub wallet_id: String,
    pub version: u32,
    pub created_at: String,
    pub did_count: u32,
    pub backend: String,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct WalletDidSummary {
    pub did: String,
    pub label: Option<String>,
    pub mldsa_alg: String,
    pub mlkem_alg: String,
    pub status: String,
    pub created_at: String,
    pub did_doc_cid: Option<String>,
}

#[derive(Debug, Clone)]
struct MobileFileStorage {
    root: PathBuf,
}

impl MobileFileStorage {
    fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn key_path(&self, key: &str) -> ssi_pq_core::Result<PathBuf> {
        if key.is_empty() {
            return Err(SsiError::InvalidWallet(
                "mobile storage key cannot be empty".to_string(),
            ));
        }

        let mut path = self.root.clone();
        for segment in key.split('/') {
            if segment.is_empty()
                || segment == "."
                || segment == ".."
                || segment.contains('\\')
                || segment.contains(std::path::MAIN_SEPARATOR)
            {
                return Err(SsiError::InvalidWallet(format!(
                    "invalid mobile storage key segment: {segment}"
                )));
            }
            path.push(segment);
        }

        Ok(path)
    }

    fn list_prefix(&self, prefix: &str) -> ssi_pq_core::Result<Vec<String>> {
        let mut keys = Vec::new();
        if !self.root.exists() {
            return Ok(keys);
        }

        self.collect_keys(&self.root, String::new(), prefix, &mut keys)?;
        keys.sort();
        Ok(keys)
    }

    fn collect_keys(
        &self,
        dir: &Path,
        current_prefix: String,
        requested_prefix: &str,
        keys: &mut Vec<String>,
    ) -> ssi_pq_core::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let key = if current_prefix.is_empty() {
                name
            } else {
                format!("{current_prefix}/{name}")
            };

            if file_type.is_dir() {
                self.collect_keys(&entry.path(), key, requested_prefix, keys)?;
            } else if file_type.is_file() && key.starts_with(requested_prefix) {
                keys.push(key);
            }
        }
        Ok(())
    }
}

impl Storage for MobileFileStorage {
    fn get(&self, key: &str) -> ssi_pq_core::Result<Option<Vec<u8>>> {
        let path = self.key_path(key)?;
        match fs::read(path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn put(&self, key: &str, value: &[u8]) -> ssi_pq_core::Result<()> {
        let path = self.key_path(key)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let tmp_path = path.with_extension("tmp");
        fs::write(&tmp_path, value)?;
        fs::rename(tmp_path, path)?;
        Ok(())
    }

    fn delete(&self, key: &str) -> ssi_pq_core::Result<()> {
        let path = self.key_path(key)?;
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileWalletCreateOptions {
    #[serde(alias = "created_at")]
    created_at: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileWalletDidCreateOptions {
    label: Option<String>,
    mldsa: Option<String>,
    mlkem: Option<String>,
    #[serde(alias = "created_at")]
    created_at: Option<String>,
    #[serde(alias = "did_doc_cid")]
    did_doc_cid: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileCredentialIssueOptions {
    #[serde(alias = "credential_id")]
    credential_id: Option<String>,
    #[serde(alias = "issued_at")]
    issued_at: Option<String>,
    #[serde(alias = "expires_at")]
    expires_at: Option<String>,
    #[serde(alias = "status_ref")]
    status_ref: Option<serde_json::Value>,
    #[serde(alias = "visible_paths")]
    visible_paths: Option<Vec<String>>,
    #[serde(alias = "credential_version")]
    credential_version: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobilePdfBindingOptions {
    #[serde(alias = "created_at")]
    created_at: Option<String>,
    #[serde(alias = "did_doc_cid")]
    did_doc_cid: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobilePdfSignOptions {
    #[serde(alias = "created_at")]
    created_at: Option<String>,
    #[serde(alias = "did_doc_cid")]
    did_doc_cid: Option<String>,
    #[serde(alias = "visual_signature")]
    visual_signature: Option<MobileVisualSignatureOptions>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileVisualSignatureOptions {
    mode: Option<String>,
    placement: Option<String>,
    text: Option<String>,
}

#[derive(uniffi::Object)]
pub struct SsiPq {
    storage: MobileFileStorage,
}

#[uniffi::export]
impl SsiPq {
    #[uniffi::constructor]
    pub fn new() -> Self {
        Self {
            storage: MobileFileStorage::new(default_mobile_storage_dir()),
        }
    }

    #[uniffi::constructor]
    pub fn new_with_storage_dir(storage_dir: String) -> Result<Self, SsiPqMobileError> {
        let storage_dir = path_from_uri(&storage_dir)?;
        fs::create_dir_all(&storage_dir).map_err(SsiError::Io)?;

        Ok(Self {
            storage: MobileFileStorage::new(storage_dir),
        })
    }

    pub fn supported_profiles(&self) -> Vec<String> {
        ssi_pq_core::api::supported_profiles()
    }

    pub fn canonical_json(&self, input: String) -> Result<String, SsiPqMobileError> {
        ssi_pq_core::api::canonical_json(&input).map_err(Into::into)
    }

    pub fn canonical_json_hash_base64url(&self, input: String) -> Result<String, SsiPqMobileError> {
        let digest = hash::canonical_json_sha3_256(&input)?;
        Ok(encoding::base64url_encode(&digest))
    }

    pub fn base64url_encode(&self, bytes: Vec<u8>) -> String {
        encoding::base64url_encode(&bytes)
    }

    pub fn base64url_decode(&self, value: String) -> Result<Vec<u8>, SsiPqMobileError> {
        encoding::base64url_decode(&value).map_err(Into::into)
    }

    pub fn sha3_256_base64url(&self, bytes: Vec<u8>) -> String {
        encoding::base64url_encode(&hash::sha3_256(&bytes))
    }

    pub fn sha3_256_hex(&self, bytes: Vec<u8>) -> String {
        bytes_to_lower_hex(&hash::sha3_256(&bytes))
    }

    pub fn secure_random_key(&self, length: u32) -> Result<Vec<u8>, SsiPqMobileError> {
        random::secure_random_key(length as usize)
            .map(|key| key.to_vec())
            .map_err(Into::into)
    }

    pub fn schema_hash_base64(&self, schema_json: String) -> Result<String, SsiPqMobileError> {
        let schema = schema::schema_from_json(parse_json_value(&schema_json)?)?;
        schema::schema_hash_base64(&schema).map_err(Into::into)
    }

    pub fn issuer_identifier_base64(
        &self,
        did_document_json: String,
    ) -> Result<String, SsiPqMobileError> {
        let did_document = did::did_document_from_json(parse_json_value(&did_document_json)?)?;
        did::issuer_identifier_base64(&did_document).map_err(Into::into)
    }

    pub fn mldsa_generate_keypair(&self, profile: String) -> Result<KeyPair, SsiPqMobileError> {
        let profile = profile.parse::<MlDsaProfile>()?;
        let key_pair = mldsa::keygen(profile)?;

        Ok(KeyPair {
            profile: key_pair.profile.as_str().to_string(),
            public_key: key_pair.public_key,
            private_key: key_pair.private_key.to_vec(),
        })
    }

    pub fn mldsa_sign(
        &self,
        profile: String,
        private_key: Vec<u8>,
        message: Vec<u8>,
        context: String,
    ) -> Result<Vec<u8>, SsiPqMobileError> {
        let profile = profile.parse::<MlDsaProfile>()?;
        let signature = mldsa::sign(profile, &private_key, &message, context.as_bytes())?;

        Ok(signature.signature)
    }

    pub fn mldsa_verify(
        &self,
        profile: String,
        public_key: Vec<u8>,
        message: Vec<u8>,
        context: String,
        signature: Vec<u8>,
    ) -> Result<bool, SsiPqMobileError> {
        let profile = profile.parse::<MlDsaProfile>()?;
        mldsa::verify(
            profile,
            &public_key,
            &message,
            context.as_bytes(),
            &signature,
        )
        .map_err(Into::into)
    }

    pub fn mlkem_generate_keypair(&self, profile: String) -> Result<KeyPair, SsiPqMobileError> {
        let profile = profile.parse::<MlKemProfile>()?;
        let key_pair = mlkem::keygen(profile)?;

        Ok(KeyPair {
            profile: key_pair.profile.as_str().to_string(),
            public_key: key_pair.public_key,
            private_key: key_pair.private_key.to_vec(),
        })
    }

    pub fn mlkem_encapsulate(
        &self,
        profile: String,
        public_key: Vec<u8>,
    ) -> Result<MlkemEncapsulation, SsiPqMobileError> {
        let profile = profile.parse::<MlKemProfile>()?;
        let encapsulation = mlkem::encapsulate(profile, &public_key)?;

        Ok(MlkemEncapsulation {
            profile: encapsulation.profile.as_str().to_string(),
            ciphertext: encapsulation.ciphertext,
            shared_secret: encapsulation.shared_secret.to_vec(),
        })
    }

    pub fn mlkem_decapsulate(
        &self,
        profile: String,
        private_key: Vec<u8>,
        ciphertext: Vec<u8>,
    ) -> Result<Vec<u8>, SsiPqMobileError> {
        let profile = profile.parse::<MlKemProfile>()?;
        mlkem::decapsulate(profile, &private_key, &ciphertext)
            .map(|shared_secret| shared_secret.to_vec())
            .map_err(Into::into)
    }

    pub fn aes256_gcm_encrypt(
        &self,
        key: Vec<u8>,
        plaintext: Vec<u8>,
        aad: Option<Vec<u8>>,
    ) -> Result<Aes256GcmEncryption, SsiPqMobileError> {
        let aad = aad.as_deref().unwrap_or(&[]);
        let encrypted = aes_gcm::encrypt(&key, &plaintext, aad)?;

        Ok(Aes256GcmEncryption {
            ciphertext: encrypted.ciphertext,
            nonce: encrypted.nonce.to_vec(),
            auth_tag: encrypted.auth_tag.to_vec(),
        })
    }

    pub fn aes256_gcm_decrypt(
        &self,
        key: Vec<u8>,
        ciphertext: Vec<u8>,
        nonce: Vec<u8>,
        auth_tag: Vec<u8>,
        aad: Option<Vec<u8>>,
    ) -> Result<Vec<u8>, SsiPqMobileError> {
        let aad = aad.as_deref().unwrap_or(&[]);
        aes_gcm::decrypt(&key, &ciphertext, &nonce, &auth_tag, aad).map_err(Into::into)
    }

    pub fn create_did_json(
        &self,
        options_json: Option<String>,
    ) -> Result<String, SsiPqMobileError> {
        ssi_pq_core::api::create_did_json(options_json.as_deref()).map_err(Into::into)
    }

    pub fn create_schema_from_attributes(
        &self,
        attributes_json: String,
        options_json: Option<String>,
    ) -> Result<String, SsiPqMobileError> {
        ssi_pq_core::api::create_schema_from_attributes_json(
            &attributes_json,
            options_json.as_deref(),
        )
        .map_err(Into::into)
    }

    pub fn verify_did_document(
        &self,
        did_document_json: String,
    ) -> Result<String, SsiPqMobileError> {
        ssi_pq_core::api::verify_did_document_json(&did_document_json).map_err(Into::into)
    }

    pub fn verify_signed_credential(
        &self,
        signed_credential_json: String,
        issuer_did_document_json: String,
    ) -> Result<String, SsiPqMobileError> {
        ssi_pq_core::api::verify_signed_credential_json(
            &signed_credential_json,
            &issuer_did_document_json,
        )
        .map_err(Into::into)
    }

    pub fn issue_credential_from_schema_json(
        &self,
        schema_json: String,
        attributes_json: String,
        issuer_did_document_json: String,
        issuer_private_key: String,
        options_json: Option<String>,
    ) -> Result<String, SsiPqMobileError> {
        ssi_pq_core::api::issue_credential_from_schema_json(
            &schema_json,
            &attributes_json,
            &issuer_did_document_json,
            &issuer_private_key,
            options_json.as_deref(),
        )
        .map_err(Into::into)
    }

    pub fn signed_credential_to_pdf(
        &self,
        signed_credential_json: String,
        render_options_json: Option<String>,
    ) -> Result<Vec<u8>, SsiPqMobileError> {
        ssi_pq_core::api::signed_credential_to_pdf_bytes(
            &signed_credential_json,
            render_options_json.as_deref(),
        )
        .map_err(Into::into)
    }

    pub fn embed_signed_credential_in_pdf(
        &self,
        pdf_base: Vec<u8>,
        signed_credential_json: String,
        issuer_did_document_json: String,
        issuer_private_key: String,
        options_json: Option<String>,
    ) -> Result<Vec<u8>, SsiPqMobileError> {
        ssi_pq_core::api::embed_signed_credential_in_pdf_bytes(
            &pdf_base,
            &signed_credential_json,
            &issuer_did_document_json,
            &issuer_private_key,
            options_json.as_deref(),
        )
        .map_err(Into::into)
    }

    pub fn extract_credential_manifest_from_pdf(
        &self,
        pdf_bytes: Vec<u8>,
    ) -> Result<String, SsiPqMobileError> {
        ssi_pq_core::api::extract_credential_manifest_from_pdf_bytes(&pdf_bytes).map_err(Into::into)
    }

    pub fn verify_signed_credential_pdf(
        &self,
        pdf_bytes: Vec<u8>,
        issuer_did_document_json: String,
    ) -> Result<String, SsiPqMobileError> {
        ssi_pq_core::api::verify_signed_credential_pdf_json(&pdf_bytes, &issuer_did_document_json)
            .map_err(Into::into)
    }

    pub fn extract_generic_signature_manifest_from_pdf(
        &self,
        pdf_bytes: Vec<u8>,
    ) -> Result<String, SsiPqMobileError> {
        let manifest = pdf_sign::extract_generic_signature_manifest(&pdf_bytes)?;
        let manifest = pdf_sign::pdf_generic_manifest_to_json(&manifest)?;
        json_value_to_string(manifest)
    }

    pub fn verify_signed_generic_pdf(
        &self,
        pdf_bytes: Vec<u8>,
        signer_did_document_json: String,
    ) -> Result<String, SsiPqMobileError> {
        let signer_did_document =
            did::did_document_from_json(parse_json_value(&signer_did_document_json)?)?;
        let result = pdf_sign::verify_generic_pdf(&pdf_bytes, &signer_did_document)?;
        let result = pdf_sign::generic_pdf_verification_result_to_json(&result)?;

        json_value_to_string(result)
    }

    pub fn wallet_create_json(
        &self,
        wallet_name: String,
        password: String,
        options_json: Option<String>,
    ) -> Result<String, SsiPqMobileError> {
        let options = parse_optional_options::<MobileWalletCreateOptions>(options_json.as_deref())?;
        let created_at = required_option(options.created_at, "createdAt")?;
        let info = wallet_storage::create_wallet(
            &self.storage,
            &wallet_name,
            &password,
            StorageWalletCreateOptions { created_at },
        )?;

        json_value_to_string(serde_json::to_value(info)?)
    }

    pub fn wallet_open_json(
        &self,
        wallet_name: String,
        password: String,
    ) -> Result<String, SsiPqMobileError> {
        let info = wallet_storage::open_wallet(&self.storage, &wallet_name, &password)?;
        json_value_to_string(serde_json::to_value(info)?)
    }

    pub fn wallet_change_password_json(
        &self,
        wallet_name: String,
        old_password: String,
        new_password: String,
    ) -> Result<String, SsiPqMobileError> {
        let info = wallet_storage::change_wallet_password(
            &self.storage,
            &wallet_name,
            &old_password,
            &new_password,
        )?;
        json_value_to_string(serde_json::to_value(info)?)
    }

    pub fn wallet_create_did_json(
        &self,
        wallet_name: String,
        password: String,
        options_json: Option<String>,
    ) -> Result<String, SsiPqMobileError> {
        let options =
            parse_optional_options::<MobileWalletDidCreateOptions>(options_json.as_deref())?;
        let created_at = required_option(options.created_at, "createdAt")?;
        let mldsa_profile = options
            .mldsa
            .as_deref()
            .unwrap_or("ML-DSA-65")
            .parse::<MlDsaProfile>()?;
        let mlkem_profile = options
            .mlkem
            .as_deref()
            .unwrap_or("ML-KEM-768")
            .parse::<MlKemProfile>()?;
        let result = wallet_storage::wallet_create_did(
            &self.storage,
            &wallet_name,
            &password,
            StorageWalletDidCreateOptions {
                label: options.label,
                mldsa_profile,
                mlkem_profile,
                created_at,
                did_doc_cid: options.did_doc_cid,
            },
        )?;

        json_value_to_string(serde_json::to_value(result)?)
    }

    pub fn wallet_list_dids_json(
        &self,
        wallet_name: String,
        password: String,
    ) -> Result<String, SsiPqMobileError> {
        let dids = wallet_storage::wallet_list_dids(&self.storage, &wallet_name, &password)?;
        json_value_to_string(serde_json::to_value(dids)?)
    }

    pub fn wallet_get_did_document_json(
        &self,
        wallet_name: String,
        password: String,
        did: String,
    ) -> Result<String, SsiPqMobileError> {
        let did_document =
            wallet_storage::wallet_get_did_document(&self.storage, &wallet_name, &password, &did)?;
        let value = did::did_document_to_json(&did_document)?;

        json_value_to_string(value)
    }

    pub fn wallet_issue_credential_from_schema_json(
        &self,
        wallet_name: String,
        password: String,
        did: String,
        schema_json: String,
        attributes_json: String,
        options_json: Option<String>,
    ) -> Result<String, SsiPqMobileError> {
        let schema = schema::schema_from_json(parse_json_value(&schema_json)?)?;
        let attributes = parse_json_value(&attributes_json)?;
        let options =
            parse_optional_options::<MobileCredentialIssueOptions>(options_json.as_deref())?;
        let issued_at = required_option(options.issued_at, "issuedAt")?;
        let signed_credential = wallet_storage::wallet_issue_credential_from_schema(
            &self.storage,
            &wallet_name,
            &password,
            &did,
            &schema,
            &attributes,
            CredentialIssueOptions {
                credential_id: options.credential_id,
                issued_at,
                expires_at: options.expires_at,
                status_ref: options.status_ref,
                visible_paths: options.visible_paths,
                credential_version: credential::SignedCredentialVersion::from_option(
                    options.credential_version,
                )?,
            },
        )?;
        let value = credential::signed_credential_to_json(&signed_credential)?;

        json_value_to_string(value)
    }

    pub fn wallet_embed_signed_credential_in_pdf_bytes(
        &self,
        wallet_name: String,
        password: String,
        did: String,
        pdf_base: Vec<u8>,
        signed_credential_json: String,
        options_json: Option<String>,
    ) -> Result<Vec<u8>, SsiPqMobileError> {
        let signed_credential =
            credential::signed_credential_from_json(parse_json_value(&signed_credential_json)?)?;
        let options = parse_optional_options::<MobilePdfBindingOptions>(options_json.as_deref())?;
        let created_at = required_option(options.created_at, "createdAt")?;

        wallet_storage::wallet_embed_signed_credential_in_pdf(
            &self.storage,
            &wallet_name,
            &password,
            &did,
            &pdf_base,
            &signed_credential,
            PdfBindingOptions {
                created_at,
                did_doc_cid: options.did_doc_cid,
            },
        )
        .map_err(Into::into)
    }

    pub fn wallet_sign_generic_pdf_bytes(
        &self,
        wallet_name: String,
        password: String,
        did: String,
        pdf_base: Vec<u8>,
        options_json: Option<String>,
    ) -> Result<Vec<u8>, SsiPqMobileError> {
        let options = parse_optional_options::<MobilePdfSignOptions>(options_json.as_deref())?;
        let created_at = required_option(options.created_at, "createdAt")?;

        wallet_storage::wallet_sign_generic_pdf(
            &self.storage,
            &wallet_name,
            &password,
            &did,
            &pdf_base,
            pdf_sign::PdfSignOptions {
                created_at,
                did_doc_cid: options.did_doc_cid,
                visibility: pdf_signature_visibility_from_options(options.visual_signature)?,
            },
        )
        .map_err(Into::into)
    }

    pub fn wallet_mlkem_decapsulate(
        &self,
        wallet_name: String,
        password: String,
        did: String,
        ciphertext: String,
    ) -> Result<String, SsiPqMobileError> {
        let ciphertext = encoding::base64url_decode(&ciphertext)?;
        let decapsulation = wallet_storage::wallet_mlkem_decapsulate(
            &self.storage,
            &wallet_name,
            &password,
            &did,
            &ciphertext,
        )?;

        Ok(encoding::base64url_encode(&decapsulation.shared_secret))
    }

    pub fn mobile_storage_get(&self, key: String) -> Result<Option<Vec<u8>>, SsiPqMobileError> {
        self.storage.get(&key).map_err(Into::into)
    }

    pub fn mobile_storage_put(&self, key: String, value: Vec<u8>) -> Result<(), SsiPqMobileError> {
        self.storage.put(&key, &value).map_err(Into::into)
    }

    pub fn mobile_storage_delete(&self, key: String) -> Result<(), SsiPqMobileError> {
        self.storage.delete(&key).map_err(Into::into)
    }

    pub fn mobile_storage_list_prefix(
        &self,
        prefix: String,
    ) -> Result<Vec<String>, SsiPqMobileError> {
        self.storage.list_prefix(&prefix).map_err(Into::into)
    }

    pub fn wallet_embed_signed_credential_in_pdf_file(
        &self,
        wallet_name: String,
        password: String,
        did: String,
        input_uri: String,
        output_uri: String,
        signed_credential_json: String,
        options_json: Option<String>,
    ) -> Result<FileOperationResult, SsiPqMobileError> {
        let pdf_base = read_file_uri(&input_uri)?;
        let final_pdf = self.wallet_embed_signed_credential_in_pdf_bytes(
            wallet_name,
            password,
            did,
            pdf_base,
            signed_credential_json,
            options_json,
        )?;
        write_file_uri_result(&output_uri, &final_pdf, None)
    }

    pub fn wallet_sign_generic_pdf_file(
        &self,
        wallet_name: String,
        password: String,
        did: String,
        input_uri: String,
        output_uri: String,
        options_json: Option<String>,
    ) -> Result<FileOperationResult, SsiPqMobileError> {
        let pdf_base = read_file_uri(&input_uri)?;
        let final_pdf =
            self.wallet_sign_generic_pdf_bytes(wallet_name, password, did, pdf_base, options_json)?;
        write_file_uri_result(&output_uri, &final_pdf, None)
    }

    pub fn verify_signed_credential_pdf_file(
        &self,
        input_uri: String,
        issuer_did_document_json: String,
    ) -> Result<String, SsiPqMobileError> {
        let pdf_bytes = read_file_uri(&input_uri)?;
        self.verify_signed_credential_pdf(pdf_bytes, issuer_did_document_json)
    }

    pub fn verify_signed_generic_pdf_file(
        &self,
        input_uri: String,
        signer_did_document_json: String,
    ) -> Result<String, SsiPqMobileError> {
        let pdf_bytes = read_file_uri(&input_uri)?;
        self.verify_signed_generic_pdf(pdf_bytes, signer_did_document_json)
    }
}

impl Default for SsiPq {
    fn default() -> Self {
        Self::new()
    }
}

fn parse_json_value(input: &str) -> Result<serde_json::Value, SsiPqMobileError> {
    serde_json::from_str(input).map_err(Into::into)
}

fn json_value_to_string(value: serde_json::Value) -> Result<String, SsiPqMobileError> {
    serde_json::to_string(&value).map_err(Into::into)
}

fn parse_optional_options<T>(input: Option<&str>) -> Result<T, SsiPqMobileError>
where
    T: Default + for<'de> Deserialize<'de>,
{
    match input {
        Some(input) => serde_json::from_str(input).map_err(Into::into),
        None => Ok(T::default()),
    }
}

fn required_option<T>(value: Option<T>, field: &str) -> Result<T, SsiPqMobileError> {
    value.ok_or_else(|| SsiPqMobileError::InvalidInput {
        detail: format!("{field} is required"),
    })
}

fn pdf_signature_visibility_from_options(
    options: Option<MobileVisualSignatureOptions>,
) -> Result<pdf_sign::PdfSignatureVisibility, SsiPqMobileError> {
    let Some(options) = options else {
        return Ok(pdf_sign::PdfSignatureVisibility::Invisible);
    };
    let mode = options
        .mode
        .unwrap_or_else(|| "invisible".to_string())
        .to_ascii_lowercase();

    match mode.as_str() {
        "invisible" => Ok(pdf_sign::PdfSignatureVisibility::Invisible),
        "visible" => {
            let placement = match options
                .placement
                .unwrap_or_else(|| "firstPageFooter".to_string())
                .as_str()
            {
                "firstPageFooter" | "footer" => {
                    pdf_sign::PdfVisibleSignaturePlacement::FirstPageFooter
                }
                "firstPageRightMargin" | "rightMargin" => {
                    pdf_sign::PdfVisibleSignaturePlacement::FirstPageRightMargin
                }
                placement => {
                    return Err(SsiPqMobileError::InvalidInput {
                        detail: format!(
                            "unsupported PDF visible signature placement: {placement}"
                        ),
                    });
                }
            };

            Ok(pdf_sign::PdfSignatureVisibility::Visible(
                pdf_sign::PdfVisibleSignatureOptions {
                    placement,
                    text: options.text,
                },
            ))
        }
        mode => Err(SsiPqMobileError::InvalidInput {
            detail: format!("unsupported PDF signature visibility mode: {mode}"),
        }),
    }
}

fn default_mobile_storage_dir() -> PathBuf {
    if let Ok(dir) = env::var("SSI_PQ_MOBILE_STORAGE_DIR") {
        return PathBuf::from(dir);
    }

    env::var("HOME")
        .map(|home| PathBuf::from(home).join(".ssi-pq-mobile-ffi"))
        .unwrap_or_else(|_| env::temp_dir().join("ssi-pq-mobile-ffi"))
}

fn path_from_uri(uri: &str) -> Result<PathBuf, SsiPqMobileError> {
    if uri.starts_with("content://") {
        return Err(SsiPqMobileError::Unavailable {
            detail: "content:// URIs must be resolved by the Android wrapper before calling Rust"
                .to_string(),
        });
    }

    if let Some(rest) = uri.strip_prefix("file://") {
        return Ok(PathBuf::from(percent_decode(rest)?));
    }

    Ok(PathBuf::from(uri))
}

fn read_file_uri(uri: &str) -> Result<Vec<u8>, SsiPqMobileError> {
    fs::read(path_from_uri(uri)?).map_err(|error| SsiError::Io(error).into())
}

fn write_file_uri_result(
    uri: &str,
    bytes: &[u8],
    metadata_json: Option<String>,
) -> Result<FileOperationResult, SsiPqMobileError> {
    let path = path_from_uri(uri)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(SsiError::Io)?;
    }
    fs::write(&path, bytes).map_err(SsiError::Io)?;

    Ok(FileOperationResult {
        output_uri: uri.to_string(),
        bytes_written: bytes.len() as u64,
        metadata_json,
    })
}

fn percent_decode(input: &str) -> Result<String, SsiPqMobileError> {
    let mut bytes = Vec::with_capacity(input.len());
    let input = input.as_bytes();
    let mut index = 0;

    while index < input.len() {
        match input[index] {
            b'%' => {
                if index + 2 >= input.len() {
                    return Err(SsiPqMobileError::InvalidInput {
                        detail: "invalid percent-encoded URI".to_string(),
                    });
                }
                let high = hex_value(input[index + 1])?;
                let low = hex_value(input[index + 2])?;
                bytes.push((high << 4) | low);
                index += 3;
            }
            byte => {
                bytes.push(byte);
                index += 1;
            }
        }
    }

    String::from_utf8(bytes).map_err(|error| SsiPqMobileError::InvalidInput {
        detail: format!("URI path is not valid UTF-8: {error}"),
    })
}

fn hex_value(byte: u8) -> Result<u8, SsiPqMobileError> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err(SsiPqMobileError::InvalidInput {
            detail: "invalid percent-encoded URI".to_string(),
        }),
    }
}

fn bytes_to_lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn mobile_wallet_storage_pdf_and_mlkem_flow_keeps_private_keys_internal() {
        let storage_dir = temp_storage_dir("wallet-flow");
        let api = SsiPq::new_with_storage_dir(storage_dir.to_string_lossy().into_owned()).unwrap();
        let wallet_name = "issuer-wallet".to_string();
        let password = "strong mobile wallet password 123".to_string();
        let new_password = "strong mobile wallet password 456".to_string();
        let created_at = "2026-05-27T00:00:00Z";
        let issued_at = "2026-05-28T00:00:00Z";

        let created = parse_json(
            api.wallet_create_json(
                wallet_name.clone(),
                password.clone(),
                Some(json_string(json!({ "createdAt": created_at }))),
            )
            .unwrap(),
        );
        assert_eq!(created["backend"], "storage");
        assert_eq!(created["did_count"], 0);

        let did_json = api
            .wallet_create_did_json(
                wallet_name.clone(),
                password.clone(),
                Some(json_string(json!({
                    "label": "Mobile Issuer",
                    "mldsa": "ML-DSA-65",
                    "mlkem": "ML-KEM-768",
                    "createdAt": created_at
                }))),
            )
            .unwrap();
        let did_result = parse_json(did_json.clone());
        let did = did_result["did"].as_str().unwrap().to_string();

        assert!(did.starts_with("did:ssipq:z"));
        assert!(did_result.get("privateKeys").is_none());
        assert!(did_result.get("private_keys").is_none());
        assert!(!did_json.to_ascii_lowercase().contains("private"));

        let did_document_json = api
            .wallet_get_did_document_json(wallet_name.clone(), password.clone(), did.clone())
            .unwrap();
        let did_document = parse_json(did_document_json.clone());
        assert_eq!(did_document["id"], did);
        assert!(!did_document_json.to_ascii_lowercase().contains("private"));

        let opened = parse_json(
            api.wallet_open_json(wallet_name.clone(), password.clone())
                .unwrap(),
        );
        assert_eq!(opened["did_count"], 1);

        let dids = parse_json(
            api.wallet_list_dids_json(wallet_name.clone(), password.clone())
                .unwrap(),
        );
        assert_eq!(dids.as_array().unwrap().len(), 1);
        assert_eq!(dids[0]["did"], did);

        let storage_keys = api
            .mobile_storage_list_prefix("ssi-pq-wallet-storage/v1".to_string())
            .unwrap();
        assert_eq!(storage_keys.len(), 2);
        let state_key = storage_keys
            .iter()
            .find(|key| key.ends_with("/state"))
            .unwrap();
        let encrypted_state = api.mobile_storage_get(state_key.clone()).unwrap().unwrap();
        assert!(!String::from_utf8_lossy(&encrypted_state).contains(&did));

        api.mobile_storage_put("maintenance/probe".to_string(), b"ok".to_vec())
            .unwrap();
        assert_eq!(
            api.mobile_storage_get("maintenance/probe".to_string())
                .unwrap()
                .unwrap(),
            b"ok"
        );
        assert_eq!(
            api.mobile_storage_list_prefix("maintenance/".to_string())
                .unwrap(),
            vec!["maintenance/probe".to_string()]
        );
        api.mobile_storage_delete("maintenance/probe".to_string())
            .unwrap();
        assert!(
            api.mobile_storage_get("maintenance/probe".to_string())
                .unwrap()
                .is_none()
        );

        let attributes_json = json_string(json!({
            "name": "Ana Silva",
            "course": "Applied Cryptography",
            "level": "advanced"
        }));
        let schema_json = api
            .create_schema_from_attributes(
                attributes_json.clone(),
                Some(json_string(json!({
                    "version": "1",
                    "createdAt": created_at
                }))),
            )
            .unwrap();
        let signed_credential_json = api
            .wallet_issue_credential_from_schema_json(
                wallet_name.clone(),
                password.clone(),
                did.clone(),
                schema_json,
                attributes_json,
                Some(json_string(json!({
                    "credentialId": "cred_mobile_wallet_test",
                    "issuedAt": issued_at,
                    "visiblePaths": ["name", "course"],
                    "credentialVersion": "v2"
                }))),
            )
            .unwrap();
        let credential_verification = parse_json(
            api.verify_signed_credential(signed_credential_json.clone(), did_document_json.clone())
                .unwrap(),
        );
        assert_eq!(credential_verification["valid"], true);

        let pdf_base = api
            .signed_credential_to_pdf(signed_credential_json.clone(), None)
            .unwrap();
        let signed_credential_pdf = api
            .wallet_embed_signed_credential_in_pdf_bytes(
                wallet_name.clone(),
                password.clone(),
                did.clone(),
                pdf_base.clone(),
                signed_credential_json.clone(),
                Some(json_string(json!({ "createdAt": created_at }))),
            )
            .unwrap();
        assert!(signed_credential_pdf.len() > pdf_base.len());
        let credential_pdf_verification = parse_json(
            api.verify_signed_credential_pdf(
                signed_credential_pdf.clone(),
                did_document_json.clone(),
            )
            .unwrap(),
        );
        assert_eq!(credential_pdf_verification["valid"], true);

        let credential_input = storage_dir.join("credential-input.pdf");
        let credential_output = storage_dir.join("credential-output.pdf");
        fs::write(&credential_input, &pdf_base).unwrap();
        let credential_file_result = api
            .wallet_embed_signed_credential_in_pdf_file(
                wallet_name.clone(),
                password.clone(),
                did.clone(),
                credential_input.to_string_lossy().into_owned(),
                credential_output.to_string_lossy().into_owned(),
                signed_credential_json,
                Some(json_string(json!({ "createdAt": created_at }))),
            )
            .unwrap();
        assert_eq!(
            credential_file_result.bytes_written,
            fs::metadata(&credential_output).unwrap().len()
        );
        let credential_file_verification = parse_json(
            api.verify_signed_credential_pdf_file(
                credential_output.to_string_lossy().into_owned(),
                did_document_json.clone(),
            )
            .unwrap(),
        );
        assert_eq!(credential_file_verification["valid"], true);

        let generic_pdf_base = minimal_pdf_base();
        let signed_generic_pdf = api
            .wallet_sign_generic_pdf_bytes(
                wallet_name.clone(),
                password.clone(),
                did.clone(),
                generic_pdf_base.clone(),
                Some(json_string(json!({ "createdAt": created_at }))),
            )
            .unwrap();
        assert!(signed_generic_pdf.len() > generic_pdf_base.len());
        let generic_verification = parse_json(
            api.verify_signed_generic_pdf(signed_generic_pdf, did_document_json.clone())
                .unwrap(),
        );
        assert_eq!(generic_verification["valid"], true);
        assert_eq!(generic_verification["signature_valid"], true);

        let generic_input = storage_dir.join("generic-input.pdf");
        let generic_output = storage_dir.join("generic-output.pdf");
        fs::write(&generic_input, generic_pdf_base).unwrap();
        let generic_file_result = api
            .wallet_sign_generic_pdf_file(
                wallet_name.clone(),
                password.clone(),
                did.clone(),
                generic_input.to_string_lossy().into_owned(),
                generic_output.to_string_lossy().into_owned(),
                Some(json_string(json!({
                    "createdAt": created_at,
                    "visualSignature": {
                        "mode": "visible",
                        "placement": "firstPageFooter",
                        "text": "SSI-PQ mobile test"
                    }
                }))),
            )
            .unwrap();
        assert_eq!(
            generic_file_result.bytes_written,
            fs::metadata(&generic_output).unwrap().len()
        );
        let generic_file_verification = parse_json(
            api.verify_signed_generic_pdf_file(
                generic_output.to_string_lossy().into_owned(),
                did_document_json.clone(),
            )
            .unwrap(),
        );
        assert_eq!(generic_file_verification["valid"], true);
        assert_eq!(generic_file_verification["did_key_match"], true);

        let mlkem_public_key = did_document["keys"]
            .as_array()
            .unwrap()
            .iter()
            .find(|key| key["id"] == "#mlkem-1")
            .and_then(|key| key["public_key_multibase"].as_str())
            .map(encoding::multibase_base58btc_decode)
            .unwrap()
            .unwrap();
        let encapsulation = api
            .mlkem_encapsulate("ML-KEM-768".to_string(), mlkem_public_key)
            .unwrap();
        let wallet_shared_secret = api
            .wallet_mlkem_decapsulate(
                wallet_name.clone(),
                password.clone(),
                did,
                api.base64url_encode(encapsulation.ciphertext),
            )
            .unwrap();
        assert_eq!(
            wallet_shared_secret,
            api.base64url_encode(encapsulation.shared_secret)
        );

        let changed = parse_json(
            api.wallet_change_password_json(
                wallet_name.clone(),
                password.clone(),
                new_password.clone(),
            )
            .unwrap(),
        );
        assert_eq!(changed["did_count"], 1);
        let wrong_password_error = api.wallet_open_json(wallet_name.clone(), password).unwrap_err();
        let wrong_password_message = wrong_password_error.to_string().to_lowercase();
        assert!(wrong_password_message.contains("wallet password is invalid"));
        assert!(!wrong_password_message.contains("corrupt"));
        assert!(!wrong_password_message.contains("sqlite"));
        assert!(!wrong_password_message.contains("sqlcipher"));
        assert!(api.wallet_open_json(wallet_name, new_password).is_ok());

        fs::remove_dir_all(storage_dir).unwrap();
    }

    fn temp_storage_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        env::temp_dir().join(format!(
            "ssi-pq-mobile-ffi-{label}-{}-{nanos}",
            std::process::id()
        ))
    }

    fn json_string(value: Value) -> String {
        serde_json::to_string(&value).unwrap()
    }

    fn parse_json(input: String) -> Value {
        serde_json::from_str(&input).unwrap()
    }

    fn minimal_pdf_base() -> Vec<u8> {
        b"%PDF-1.4\n%ABCD\n\
1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\
3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n\
xref\n0 4\n\
0000000000 65535 f \n\
0000000015 00000 n \n\
0000000064 00000 n \n\
0000000121 00000 n \n\
trailer\n<< /Size 4 /Root 1 0 R >>\n\
startxref\n192\n\
%%EOF\n"
            .to_vec()
    }
}
