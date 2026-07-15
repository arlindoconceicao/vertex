use std::{
    collections::BTreeMap,
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use ssi_pq_core::{
    Result as CoreResult, SsiError,
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

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WasmWalletCreateOptions {
    #[serde(alias = "created_at")]
    created_at: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WasmWalletDidCreateOptions {
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
struct WasmCredentialIssueOptions {
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
struct WasmPdfBindingOptions {
    #[serde(alias = "created_at")]
    created_at: Option<String>,
    #[serde(alias = "did_doc_cid")]
    did_doc_cid: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WasmPdfSignOptions {
    #[serde(alias = "created_at")]
    created_at: Option<String>,
    #[serde(alias = "did_doc_cid")]
    did_doc_cid: Option<String>,
    #[serde(alias = "visual_signature")]
    visual_signature: Option<WasmVisualSignatureOptions>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WasmVisualSignatureOptions {
    mode: Option<String>,
    placement: Option<String>,
    text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct WasmStorageEntry {
    key: String,
    value: String,
}

#[derive(Debug, Default)]
struct WasmMemoryStorage {
    entries: Mutex<BTreeMap<String, Vec<u8>>>,
}

impl Storage for WasmMemoryStorage {
    fn get(&self, key: &str) -> CoreResult<Option<Vec<u8>>> {
        Ok(self
            .entries
            .lock()
            .map_err(|_| SsiError::InvalidWallet("WASM wallet storage lock failed".to_string()))?
            .get(key)
            .cloned())
    }

    fn put(&self, key: &str, value: &[u8]) -> CoreResult<()> {
        self.entries
            .lock()
            .map_err(|_| SsiError::InvalidWallet("WASM wallet storage lock failed".to_string()))?
            .insert(key.to_string(), value.to_vec());
        Ok(())
    }

    fn delete(&self, key: &str) -> CoreResult<()> {
        self.entries
            .lock()
            .map_err(|_| SsiError::InvalidWallet("WASM wallet storage lock failed".to_string()))?
            .remove(key);
        Ok(())
    }
}

static WASM_WALLET_STORAGE: OnceLock<WasmMemoryStorage> = OnceLock::new();

fn wasm_wallet_storage() -> &'static WasmMemoryStorage {
    WASM_WALLET_STORAGE.get_or_init(WasmMemoryStorage::default)
}

#[wasm_bindgen(js_name = supportedProfiles)]
pub fn supported_profiles() -> js_sys::Array {
    let profiles = js_sys::Array::new();
    for profile in ssi_pq_core::api::supported_profiles() {
        profiles.push(&JsValue::from(profile));
    }
    profiles
}

#[wasm_bindgen(js_name = base64urlEncode)]
pub fn base64url_encode(bytes: Vec<u8>) -> String {
    encoding::base64url_encode(&bytes)
}

#[wasm_bindgen(js_name = base64urlDecode)]
pub fn base64url_decode(value: String) -> Result<Vec<u8>, JsValue> {
    encoding::base64url_decode(&value).map_err(to_js_error)
}

#[wasm_bindgen(js_name = multibaseBase58btcEncode)]
pub fn multibase_base58btc_encode(bytes: Vec<u8>) -> String {
    encoding::multibase_base58btc_encode(&bytes)
}

#[wasm_bindgen(js_name = multibaseBase58btcDecode)]
pub fn multibase_base58btc_decode(value: String) -> Result<Vec<u8>, JsValue> {
    encoding::multibase_base58btc_decode(&value).map_err(to_js_error)
}

#[wasm_bindgen(js_name = mlkemEncapsulate)]
pub fn mlkem_encapsulate(profile: String, public_key: String) -> Result<JsValue, JsValue> {
    let profile = profile.parse::<MlKemProfile>().map_err(to_js_error)?;
    let public_key = encoding::base64url_decode(&public_key).map_err(to_js_error)?;
    let encapsulation = mlkem::encapsulate(profile, &public_key).map_err(to_js_error)?;
    let result = js_sys::Object::new();

    set_object_property(
        &result,
        "profile",
        JsValue::from_str(encapsulation.profile.as_str()),
    )?;
    set_object_property(
        &result,
        "ciphertext",
        JsValue::from_str(&encoding::base64url_encode(&encapsulation.ciphertext)),
    )?;
    set_object_property(
        &result,
        "sharedSecret",
        JsValue::from_str(&encoding::base64url_encode(&encapsulation.shared_secret)),
    )?;

    Ok(result.into())
}

#[wasm_bindgen(js_name = aes256GcmEncrypt)]
pub fn aes256_gcm_encrypt(
    key: Vec<u8>,
    plaintext: Vec<u8>,
    aad: Option<Vec<u8>>,
) -> Result<JsValue, JsValue> {
    let aad = aad.as_deref().unwrap_or(&[]);
    let encrypted = aes_gcm::encrypt(&key, &plaintext, aad).map_err(to_js_error)?;
    let result = js_sys::Object::new();

    set_object_property(
        &result,
        "ciphertext",
        js_sys::Uint8Array::from(encrypted.ciphertext.as_slice()).into(),
    )?;
    set_object_property(
        &result,
        "nonce",
        js_sys::Uint8Array::from(encrypted.nonce.as_slice()).into(),
    )?;
    set_object_property(
        &result,
        "authTag",
        js_sys::Uint8Array::from(encrypted.auth_tag.as_slice()).into(),
    )?;

    Ok(result.into())
}

#[wasm_bindgen(js_name = aes256GcmDecrypt)]
pub fn aes256_gcm_decrypt(
    key: Vec<u8>,
    ciphertext: Vec<u8>,
    nonce: Vec<u8>,
    auth_tag: Vec<u8>,
    aad: Option<Vec<u8>>,
) -> Result<Vec<u8>, JsValue> {
    let aad = aad.as_deref().unwrap_or(&[]);
    aes_gcm::decrypt(&key, &ciphertext, &nonce, &auth_tag, aad).map_err(to_js_error)
}

#[wasm_bindgen(js_name = canonicalJson)]
pub fn canonical_json(input: String) -> Result<String, JsValue> {
    ssi_pq_core::api::canonical_json(&input).map_err(to_js_error)
}

#[wasm_bindgen(js_name = canonicalJsonHashBase64url)]
pub fn canonical_json_hash_base64url(input: String) -> Result<String, JsValue> {
    let digest = hash::canonical_json_sha3_256(&input).map_err(to_js_error)?;
    Ok(encoding::base64url_encode(&digest))
}

#[wasm_bindgen(js_name = schemaHashBase64)]
pub fn schema_hash_base64(schema_value: JsValue) -> Result<String, JsValue> {
    let schema =
        schema::schema_from_json(js_value_to_json_value(&schema_value)?).map_err(to_js_error)?;
    schema::schema_hash_base64(&schema).map_err(to_js_error)
}

#[wasm_bindgen(js_name = issuerIdentifierBase64)]
pub fn issuer_identifier_base64(did_document_value: JsValue) -> Result<String, JsValue> {
    let did_document = did::did_document_from_json(js_value_to_json_value(&did_document_value)?)
        .map_err(to_js_error)?;
    did::issuer_identifier_base64(&did_document).map_err(to_js_error)
}

#[wasm_bindgen(js_name = sha3_256Base64url)]
pub fn sha3_256_base64url(bytes: Vec<u8>) -> String {
    encoding::base64url_encode(&hash::sha3_256(&bytes))
}

#[wasm_bindgen(js_name = sha3_256Hex)]
pub fn sha3_256_hex(bytes: Vec<u8>) -> String {
    bytes_to_lower_hex(&hash::sha3_256(&bytes))
}

#[wasm_bindgen(js_name = secureRandomKey)]
pub fn secure_random_key(length: u32) -> Result<Vec<u8>, JsValue> {
    random::secure_random_key(length as usize)
        .map(|key| key.to_vec())
        .map_err(to_js_error)
}

#[wasm_bindgen(js_name = mldsaGenerateKeypair)]
pub fn mldsa_generate_keypair(profile: String) -> Result<JsValue, JsValue> {
    let profile = profile.parse::<MlDsaProfile>().map_err(to_js_error)?;
    let key_pair = mldsa::keygen(profile).map_err(to_js_error)?;

    key_pair_js_value(
        key_pair.profile.as_str(),
        &key_pair.public_key,
        &key_pair.private_key,
    )
}

#[wasm_bindgen(js_name = mldsaSign)]
pub fn mldsa_sign(
    profile: String,
    private_key: String,
    message: Vec<u8>,
    context: String,
) -> Result<String, JsValue> {
    let profile = profile.parse::<MlDsaProfile>().map_err(to_js_error)?;
    let private_key = encoding::base64url_decode(&private_key).map_err(to_js_error)?;
    let signature =
        mldsa::sign(profile, &private_key, &message, context.as_bytes()).map_err(to_js_error)?;

    Ok(encoding::base64url_encode(&signature.signature))
}

#[wasm_bindgen(js_name = mldsaVerify)]
pub fn mldsa_verify(
    profile: String,
    public_key: String,
    message: Vec<u8>,
    context: String,
    signature: String,
) -> Result<bool, JsValue> {
    let profile = profile.parse::<MlDsaProfile>().map_err(to_js_error)?;
    let public_key = encoding::base64url_decode(&public_key).map_err(to_js_error)?;
    let signature = encoding::base64url_decode(&signature).map_err(to_js_error)?;

    mldsa::verify(
        profile,
        &public_key,
        &message,
        context.as_bytes(),
        &signature,
    )
    .map_err(to_js_error)
}

#[wasm_bindgen(js_name = mlkemGenerateKeypair)]
pub fn mlkem_generate_keypair(profile: String) -> Result<JsValue, JsValue> {
    let profile = profile.parse::<MlKemProfile>().map_err(to_js_error)?;
    let key_pair = mlkem::keygen(profile).map_err(to_js_error)?;

    key_pair_js_value(
        key_pair.profile.as_str(),
        &key_pair.public_key,
        &key_pair.private_key,
    )
}

#[wasm_bindgen(js_name = mlkemDecapsulate)]
pub fn mlkem_decapsulate(
    profile: String,
    private_key: String,
    ciphertext: String,
) -> Result<String, JsValue> {
    let profile = profile.parse::<MlKemProfile>().map_err(to_js_error)?;
    let private_key = encoding::base64url_decode(&private_key).map_err(to_js_error)?;
    let ciphertext = encoding::base64url_decode(&ciphertext).map_err(to_js_error)?;
    let shared_secret =
        mlkem::decapsulate(profile, &private_key, &ciphertext).map_err(to_js_error)?;

    Ok(encoding::base64url_encode(&shared_secret))
}

#[wasm_bindgen(js_name = createDidJson)]
pub fn create_did_json(options_json: Option<String>) -> Result<String, JsValue> {
    ssi_pq_core::api::create_did_json(options_json.as_deref()).map_err(to_js_error)
}

#[wasm_bindgen(js_name = createSchemaFromAttributesJson)]
pub fn create_schema_from_attributes_json(
    attributes_json: String,
    options_json: Option<String>,
) -> Result<String, JsValue> {
    ssi_pq_core::api::create_schema_from_attributes_json(&attributes_json, options_json.as_deref())
        .map_err(to_js_error)
}

#[wasm_bindgen(js_name = verifyDidDocumentJson)]
pub fn verify_did_document_json(did_document_json: String) -> Result<String, JsValue> {
    ssi_pq_core::api::verify_did_document_json(&did_document_json).map_err(to_js_error)
}

#[wasm_bindgen(js_name = verifySignedCredentialJson)]
pub fn verify_signed_credential_json(
    signed_credential_json: String,
    issuer_did_document_json: String,
) -> Result<String, JsValue> {
    ssi_pq_core::api::verify_signed_credential_json(
        &signed_credential_json,
        &issuer_did_document_json,
    )
    .map_err(to_js_error)
}

#[wasm_bindgen(js_name = issueCredentialFromSchemaJson)]
pub fn issue_credential_from_schema_json(
    schema_json: String,
    attributes_json: String,
    issuer_did_document_json: String,
    issuer_private_key: String,
    options_json: Option<String>,
) -> Result<String, JsValue> {
    ssi_pq_core::api::issue_credential_from_schema_json(
        &schema_json,
        &attributes_json,
        &issuer_did_document_json,
        &issuer_private_key,
        options_json.as_deref(),
    )
    .map_err(to_js_error)
}

#[wasm_bindgen(js_name = signedCredentialToPdfBytes)]
pub fn signed_credential_to_pdf_bytes(
    signed_credential_json: String,
    render_options_json: Option<String>,
) -> Result<Vec<u8>, JsValue> {
    ssi_pq_core::api::signed_credential_to_pdf_bytes(
        &signed_credential_json,
        render_options_json.as_deref(),
    )
    .map_err(to_js_error)
}

#[wasm_bindgen(js_name = embedSignedCredentialInPdfBytes)]
pub fn embed_signed_credential_in_pdf_bytes(
    pdf_base: Vec<u8>,
    signed_credential_json: String,
    issuer_did_document_json: String,
    issuer_private_key: String,
    options_json: Option<String>,
) -> Result<Vec<u8>, JsValue> {
    ssi_pq_core::api::embed_signed_credential_in_pdf_bytes(
        &pdf_base,
        &signed_credential_json,
        &issuer_did_document_json,
        &issuer_private_key,
        options_json.as_deref(),
    )
    .map_err(to_js_error)
}

#[wasm_bindgen(js_name = extractCredentialManifestFromPdfBytes)]
pub fn extract_credential_manifest_from_pdf_bytes(pdf_bytes: Vec<u8>) -> Result<String, JsValue> {
    ssi_pq_core::api::extract_credential_manifest_from_pdf_bytes(&pdf_bytes).map_err(to_js_error)
}

#[wasm_bindgen(js_name = verifySignedCredentialPdfJson)]
pub fn verify_signed_credential_pdf_json(
    pdf_bytes: Vec<u8>,
    issuer_did_document_json: String,
) -> Result<String, JsValue> {
    ssi_pq_core::api::verify_signed_credential_pdf_json(&pdf_bytes, &issuer_did_document_json)
        .map_err(to_js_error)
}

#[wasm_bindgen(js_name = extractGenericSignatureManifestFromPdfBytes)]
pub fn extract_generic_signature_manifest_from_pdf_bytes(
    pdf_bytes: Vec<u8>,
) -> Result<String, JsValue> {
    let manifest = pdf_sign::extract_generic_signature_manifest(&pdf_bytes).map_err(to_js_error)?;
    let value = pdf_sign::pdf_generic_manifest_to_json(&manifest).map_err(to_js_error)?;

    json_string(&value)
}

#[wasm_bindgen(js_name = verifySignedGenericPdfJson)]
pub fn verify_signed_generic_pdf_json(
    pdf_bytes: Vec<u8>,
    signer_did_document_json: String,
) -> Result<String, JsValue> {
    let signer_did_document =
        did::did_document_from_json(parse_json_value(&signer_did_document_json)?)
            .map_err(to_js_error)?;
    let result =
        pdf_sign::verify_generic_pdf(&pdf_bytes, &signer_did_document).map_err(to_js_error)?;
    let value = pdf_sign::generic_pdf_verification_result_to_json(&result).map_err(to_js_error)?;

    json_string(&value)
}

#[wasm_bindgen(js_name = webWalletCreateJson)]
pub fn web_wallet_create_json(
    wallet_name: String,
    password: String,
    options_json: Option<String>,
) -> Result<String, JsValue> {
    let options = parse_optional_options::<WasmWalletCreateOptions>(options_json.as_deref())?;
    let created_at = required_option(options.created_at, "createdAt")?;
    let info = wallet_storage::create_wallet(
        wasm_wallet_storage(),
        &wallet_name,
        &password,
        StorageWalletCreateOptions { created_at },
    )
    .map_err(to_js_error)?;

    json_string(&info)
}

#[wasm_bindgen(js_name = webWalletOpenJson)]
pub fn web_wallet_open_json(wallet_name: String, password: String) -> Result<String, JsValue> {
    let info = wallet_storage::open_wallet(wasm_wallet_storage(), &wallet_name, &password)
        .map_err(to_js_error)?;

    json_string(&info)
}

#[wasm_bindgen(js_name = webWalletChangePasswordJson)]
pub fn web_wallet_change_password_json(
    wallet_name: String,
    old_password: String,
    new_password: String,
) -> Result<String, JsValue> {
    let info = wallet_storage::change_wallet_password(
        wasm_wallet_storage(),
        &wallet_name,
        &old_password,
        &new_password,
    )
    .map_err(to_js_error)?;

    json_string(&info)
}

#[wasm_bindgen(js_name = webWalletCreateDidJson)]
pub fn web_wallet_create_did_json(
    wallet_name: String,
    password: String,
    options_json: Option<String>,
) -> Result<String, JsValue> {
    let options = parse_optional_options::<WasmWalletDidCreateOptions>(options_json.as_deref())?;
    let created_at = required_option(options.created_at, "createdAt")?;
    let mldsa_profile = options
        .mldsa
        .as_deref()
        .unwrap_or("ML-DSA-65")
        .parse::<MlDsaProfile>()
        .map_err(to_js_error)?;
    let mlkem_profile = options
        .mlkem
        .as_deref()
        .unwrap_or("ML-KEM-768")
        .parse::<MlKemProfile>()
        .map_err(to_js_error)?;
    let result = wallet_storage::wallet_create_did(
        wasm_wallet_storage(),
        &wallet_name,
        &password,
        StorageWalletDidCreateOptions {
            label: options.label,
            mldsa_profile,
            mlkem_profile,
            created_at,
            did_doc_cid: options.did_doc_cid,
        },
    )
    .map_err(to_js_error)?;

    json_string(&result)
}

#[wasm_bindgen(js_name = webWalletListDidsJson)]
pub fn web_wallet_list_dids_json(wallet_name: String, password: String) -> Result<String, JsValue> {
    let dids = wallet_storage::wallet_list_dids(wasm_wallet_storage(), &wallet_name, &password)
        .map_err(to_js_error)?;

    json_string(&dids)
}

#[wasm_bindgen(js_name = webWalletGetDidDocumentJson)]
pub fn web_wallet_get_did_document_json(
    wallet_name: String,
    password: String,
    did: String,
) -> Result<String, JsValue> {
    let did_document = wallet_storage::wallet_get_did_document(
        wasm_wallet_storage(),
        &wallet_name,
        &password,
        &did,
    )
    .map_err(to_js_error)?;
    let value = did::did_document_to_json(&did_document).map_err(to_js_error)?;

    json_string(&value)
}

#[wasm_bindgen(js_name = webWalletIssueCredentialFromSchemaJson)]
pub fn web_wallet_issue_credential_from_schema_json(
    wallet_name: String,
    password: String,
    did: String,
    schema_json: String,
    attributes_json: String,
    options_json: Option<String>,
) -> Result<String, JsValue> {
    let schema = schema::schema_from_json(parse_json_value(&schema_json)?).map_err(to_js_error)?;
    let attributes = parse_json_value(&attributes_json)?;
    let options = parse_optional_options::<WasmCredentialIssueOptions>(options_json.as_deref())?;
    let issued_at = required_option(options.issued_at, "issuedAt")?;
    let signed_credential = wallet_storage::wallet_issue_credential_from_schema(
        wasm_wallet_storage(),
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
            )
            .map_err(to_js_error)?,
        },
    )
    .map_err(to_js_error)?;
    let value = credential::signed_credential_to_json(&signed_credential).map_err(to_js_error)?;

    json_string(&value)
}

#[wasm_bindgen(js_name = webWalletEmbedSignedCredentialInPdfBytes)]
pub fn web_wallet_embed_signed_credential_in_pdf_bytes(
    wallet_name: String,
    password: String,
    did: String,
    pdf_base: Vec<u8>,
    signed_credential_json: String,
    options_json: Option<String>,
) -> Result<Vec<u8>, JsValue> {
    let signed_credential =
        credential::signed_credential_from_json(parse_json_value(&signed_credential_json)?)
            .map_err(to_js_error)?;
    let options = parse_optional_options::<WasmPdfBindingOptions>(options_json.as_deref())?;
    let created_at = required_option(options.created_at, "createdAt")?;

    wallet_storage::wallet_embed_signed_credential_in_pdf(
        wasm_wallet_storage(),
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
    .map_err(to_js_error)
}

#[wasm_bindgen(js_name = webWalletSignGenericPdfBytes)]
pub fn web_wallet_sign_generic_pdf_bytes(
    wallet_name: String,
    password: String,
    did: String,
    pdf_base: Vec<u8>,
    options_json: Option<String>,
) -> Result<Vec<u8>, JsValue> {
    let options = parse_optional_options::<WasmPdfSignOptions>(options_json.as_deref())?;
    let created_at = required_option(options.created_at, "createdAt")?;

    wallet_storage::wallet_sign_generic_pdf(
        wasm_wallet_storage(),
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
    .map_err(to_js_error)
}

#[wasm_bindgen(js_name = webWalletMlkemDecapsulate)]
pub fn web_wallet_mlkem_decapsulate(
    wallet_name: String,
    password: String,
    did: String,
    ciphertext: String,
) -> Result<String, JsValue> {
    let ciphertext = encoding::base64url_decode(&ciphertext).map_err(to_js_error)?;
    let decapsulation = wallet_storage::wallet_mlkem_decapsulate(
        wasm_wallet_storage(),
        &wallet_name,
        &password,
        &did,
        &ciphertext,
    )
    .map_err(to_js_error)?;

    Ok(encoding::base64url_encode(&decapsulation.shared_secret))
}

#[wasm_bindgen(js_name = webWalletClearMemory)]
pub fn web_wallet_clear_memory() -> Result<(), JsValue> {
    wasm_wallet_storage()
        .entries
        .lock()
        .map_err(|_| JsValue::from_str("WASM wallet storage lock failed"))?
        .clear();
    Ok(())
}

#[wasm_bindgen(js_name = webWalletExportStorageJson)]
pub fn web_wallet_export_storage_json(wallet_name: String) -> Result<String, JsValue> {
    let prefix = wallet_storage_key_prefix(&wallet_name);
    let entries = wasm_wallet_storage()
        .entries
        .lock()
        .map_err(|_| JsValue::from_str("WASM wallet storage lock failed"))?
        .iter()
        .filter(|(key, _)| key.starts_with(&prefix))
        .map(|(key, value)| WasmStorageEntry {
            key: key.clone(),
            value: encoding::base64url_encode(value),
        })
        .collect::<Vec<_>>();

    json_string(&entries)
}

#[wasm_bindgen(js_name = webWalletImportStorageJson)]
pub fn web_wallet_import_storage_json(
    wallet_name: String,
    snapshot_json: String,
) -> Result<(), JsValue> {
    let prefix = wallet_storage_key_prefix(&wallet_name);
    let entries = serde_json::from_str::<Vec<WasmStorageEntry>>(&snapshot_json)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let mut storage = wasm_wallet_storage()
        .entries
        .lock()
        .map_err(|_| JsValue::from_str("WASM wallet storage lock failed"))?;

    for entry in &entries {
        if !entry.key.starts_with(&prefix) {
            return Err(JsValue::from_str(
                "wallet storage snapshot contains a key outside the requested wallet namespace",
            ));
        }
    }

    storage.retain(|key, _| !key.starts_with(&prefix));
    for entry in entries {
        storage.insert(
            entry.key,
            encoding::base64url_decode(&entry.value).map_err(to_js_error)?,
        );
    }
    Ok(())
}

#[wasm_bindgen(js_name = webWalletDeleteStorage)]
pub fn web_wallet_delete_storage(wallet_name: String) -> Result<(), JsValue> {
    let prefix = wallet_storage_key_prefix(&wallet_name);
    wasm_wallet_storage()
        .entries
        .lock()
        .map_err(|_| JsValue::from_str("WASM wallet storage lock failed"))?
        .retain(|key, _| !key.starts_with(&prefix));
    Ok(())
}

fn to_js_error(error: ssi_pq_core::CoreError) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn set_object_property(object: &js_sys::Object, key: &str, value: JsValue) -> Result<(), JsValue> {
    js_sys::Reflect::set(object, &JsValue::from_str(key), &value)?;
    Ok(())
}

fn key_pair_js_value(
    profile: &str,
    public_key: &[u8],
    private_key: &[u8],
) -> Result<JsValue, JsValue> {
    let result = js_sys::Object::new();

    set_object_property(&result, "profile", JsValue::from_str(profile))?;
    set_object_property(
        &result,
        "publicKey",
        JsValue::from_str(&encoding::base64url_encode(public_key)),
    )?;
    set_object_property(
        &result,
        "privateKey",
        JsValue::from_str(&encoding::base64url_encode(private_key)),
    )?;

    Ok(result.into())
}

fn pdf_signature_visibility_from_options(
    options: Option<WasmVisualSignatureOptions>,
) -> Result<pdf_sign::PdfSignatureVisibility, JsValue> {
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
                    return Err(JsValue::from_str(&format!(
                        "unsupported PDF visible signature placement: {placement}"
                    )));
                }
            };

            Ok(pdf_sign::PdfSignatureVisibility::Visible(
                pdf_sign::PdfVisibleSignatureOptions {
                    placement,
                    text: options.text,
                },
            ))
        }
        mode => Err(JsValue::from_str(&format!(
            "unsupported PDF signature visibility mode: {mode}"
        ))),
    }
}

fn js_value_to_json_value(value: &JsValue) -> Result<serde_json::Value, JsValue> {
    let json = js_sys::JSON::stringify(value)?
        .as_string()
        .ok_or_else(|| JsValue::from_str("value cannot be serialized to JSON"))?;

    parse_json_value(&json)
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

fn parse_json_value(input: &str) -> Result<serde_json::Value, JsValue> {
    serde_json::from_str(input).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn parse_optional_options<T>(input: Option<&str>) -> Result<T, JsValue>
where
    T: Default + for<'de> Deserialize<'de>,
{
    match input {
        Some(input) => {
            serde_json::from_str(input).map_err(|error| JsValue::from_str(&error.to_string()))
        }
        None => Ok(T::default()),
    }
}

fn required_option<T>(value: Option<T>, field: &str) -> Result<T, JsValue> {
    value.ok_or_else(|| JsValue::from_str(&format!("{field} is required")))
}

fn json_string(value: &impl serde::Serialize) -> Result<String, JsValue> {
    serde_json::to_string(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn wallet_storage_key_prefix(wallet_name: &str) -> String {
    format!(
        "ssi-pq-wallet-storage/v1/{}/",
        encoding::base64url_encode(wallet_name.as_bytes())
    )
}
