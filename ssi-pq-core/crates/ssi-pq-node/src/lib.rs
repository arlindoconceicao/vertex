use chrono::{SecondsFormat, Utc};
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use serde_json::Value;
use std::{collections::BTreeMap, str::FromStr};

use ssi_pq_core::{
    canonical_json,
    credential::{self, CredentialIssueOptions},
    crypto::{aes_gcm, mldsa, mlkem},
    did, encoding, hash, pdf, pdf_sign,
    profiles::{MlDsaProfile, MlKemProfile},
    random,
    schema::{self, SchemaCreateOptions},
    wallet,
};

/// Converte erros internos do core para erros JavaScript da N-API.
fn to_napi_error(error: impl std::error::Error) -> napi::Error {
    napi::Error::from_reason(error.to_string())
}

/// Retorna o timestamp UTC atual em RFC 3339 com precisão de segundos.
fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn pdf_signature_visibility_from_node(
    options: Option<NodeVisualSignatureOptions>,
) -> napi::Result<pdf_sign::PdfSignatureVisibility> {
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
                    return Err(napi::Error::from_reason(format!(
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
        mode => Err(napi::Error::from_reason(format!(
            "unsupported PDF signature visibility mode: {mode}"
        ))),
    }
}

fn pdf_render_options_from_node(options: Option<Value>) -> napi::Result<pdf::PdfRenderOptions> {
    let Some(options) = options else {
        return Ok(pdf::PdfRenderOptions::default());
    };
    let Some(labels_value) = options.get("labels") else {
        return Ok(pdf::PdfRenderOptions::default());
    };
    let Some(labels_object) = labels_value.as_object() else {
        return Err(napi::Error::from_reason(
            "signedCredentialToPdf options.labels must be an object",
        ));
    };
    let mut labels = BTreeMap::new();

    for (path, label_value) in labels_object {
        let Some(label) = label_value.as_str() else {
            return Err(napi::Error::from_reason(format!(
                "signedCredentialToPdf label for path '{path}' must be a string"
            )));
        };

        labels.insert(path.clone(), label.to_string());
    }

    Ok(pdf::PdfRenderOptions { labels })
}

/// Retorna a representação canônica de uma string JSON.
///
/// Esta função é exposta ao Node.js para permitir que os testes validem a mesma
/// canonicalização usada internamente pelo core Rust.
#[napi(js_name = "canonicalJson")]
pub fn canonical_json_for_node(json: String) -> napi::Result<String> {
    canonical_json::canonical_json_string_from_str(&json).map_err(to_napi_error)
}

/// Retorna a representação canônica RFC 8785/JCS de um arquivo JSON UTF-8.
#[napi(js_name = "canonicalJsonFile")]
pub fn canonical_json_file_for_node(path: String) -> napi::Result<String> {
    canonical_json::canonical_json_string_from_file(path).map_err(to_napi_error)
}

/// Calcula o SHA3-256 de um JSON canônico e retorna o resultado em base64url.
///
/// A entrada pode ter chaves em qualquer ordem, pois a canonicalização ocorre
/// antes do hash.
#[napi(js_name = "canonicalJsonHashBase64url")]
pub fn canonical_json_hash_base64url_for_node(json: String) -> napi::Result<String> {
    let digest = hash::canonical_json_sha3_256(&json).map_err(to_napi_error)?;
    Ok(encoding::base64url_encode(&digest))
}

/// Calcula o hash SHA3-256/Base64 da definição lógica de um Schema.
#[napi(js_name = "schemaHashBase64")]
pub fn schema_hash_base64_for_node(schema: Value) -> napi::Result<String> {
    let schema = schema::schema_from_json(schema).map_err(to_napi_error)?;
    schema::schema_hash_base64(&schema).map_err(to_napi_error)
}

/// Calcula o identificador SHA3-256/Base64 do emissor a partir do DID Document.
#[napi(js_name = "issuerIdentifierBase64")]
pub fn issuer_identifier_base64_for_node(did_document: Value) -> napi::Result<String> {
    let did_document = did::did_document_from_json(did_document).map_err(to_napi_error)?;
    did::issuer_identifier_base64(&did_document).map_err(to_napi_error)
}

/// Calcula o SHA3-256 dos bytes recebidos e retorna o digest em base64url.
#[napi(js_name = "sha3_256Base64url")]
pub fn sha3_256_base64url_for_node(bytes: Buffer) -> String {
    let digest = hash::sha3_256(bytes.as_ref());
    encoding::base64url_encode(&digest)
}

/// Calcula o SHA3-256 dos bytes recebidos e retorna o digest em hexadecimal.
#[napi(js_name = "sha3_256Hex")]
pub fn sha3_256_hex_for_node(bytes: Buffer) -> String {
    hex::encode(hash::sha3_256(bytes.as_ref()))
}

/// Codifica bytes em base64url sem padding para uso em JavaScript.
#[napi(js_name = "base64urlEncode")]
pub fn base64url_encode_for_node(bytes: Buffer) -> String {
    encoding::base64url_encode(bytes.as_ref())
}

/// Decodifica base64url sem padding e retorna um `Buffer` para JavaScript.
#[napi(js_name = "base64urlDecode")]
pub fn base64url_decode_for_node(value: String) -> napi::Result<Buffer> {
    let decoded = encoding::base64url_decode(&value).map_err(to_napi_error)?;
    Ok(decoded.into())
}

/// Gera material de chave aleatório seguro com o tamanho solicitado.
#[napi(js_name = "secureRandomKey")]
pub fn secure_random_key_for_node(length: u32) -> napi::Result<Buffer> {
    let key = random::secure_random_key(length as usize).map_err(to_napi_error)?;
    Ok(key.to_vec().into())
}

/// Lista os perfis pós-quânticos suportados pela API pública atual.
#[napi(js_name = "supportedProfiles")]
pub fn supported_profiles_for_node() -> Vec<String> {
    vec![
        "ML-DSA-44".to_string(),
        "ML-DSA-65".to_string(),
        "ML-DSA-87".to_string(),
        "ML-KEM-512".to_string(),
        "ML-KEM-768".to_string(),
        "ML-KEM-1024".to_string(),
    ]
}

/// Par de chaves serializado para consumo por Node.js.
#[napi(object)]
pub struct NodeKeyPair {
    /// Perfil criptográfico usado para gerar as chaves.
    pub profile: String,
    /// Chave pública em base64url sem padding.
    pub public_key: String,
    /// Chave privada em base64url sem padding.
    pub private_key: String,
}

/// Resultado de encapsulamento ML-KEM serializado para Node.js.
#[napi(object)]
pub struct NodeMlkemEncapsulation {
    /// Perfil ML-KEM usado no encapsulamento.
    pub profile: String,
    /// Ciphertext em base64url sem padding.
    pub ciphertext: String,
    /// Segredo compartilhado em base64url sem padding.
    pub shared_secret: String,
}

/// Resultado de cifragem AES-256-GCM serializado para Node.js.
#[napi(object)]
pub struct NodeAes256GcmEncryption {
    /// Bytes cifrados sem o tag de autenticação.
    pub ciphertext: Buffer,
    /// Nonce de 96 bits em bytes.
    pub nonce: Buffer,
    /// Tag de autenticação GCM de 128 bits.
    pub auth_tag: Buffer,
}

/// Opções recebidas do Node.js para gerar um DID SSI-PQ.
#[napi(object)]
pub struct NodeDidCreateOptions {
    /// Perfil ML-DSA desejado. Quando omitido, usa `ML-DSA-65`.
    pub mldsa: Option<String>,
    /// Perfil ML-KEM desejado. Quando omitido, usa `ML-KEM-768`.
    pub mlkem: Option<String>,
    /// Timestamp de criação. Quando omitido, usa o horário UTC atual.
    pub created_at: Option<String>,
}

/// Resultado de criação de DID retornado para Node.js.
#[napi(object)]
pub struct NodeDidCreationResult {
    /// DID final no formato `did:ssipq:z...`.
    pub did: String,
    /// Fingerprint multibase/base58btc usado no DID.
    pub fingerprint: String,
    /// DID Document público assinado.
    pub did_document: Value,
    /// Chaves privadas retornadas temporariamente para testes em memória.
    pub private_keys: Value,
}

/// Opções recebidas do Node.js para gerar um Schema SSI-PQ.
#[napi(object)]
pub struct NodeSchemaCreateOptions {
    /// Versão textual do Schema. Quando omitida, usa `1`.
    pub version: Option<String>,
    /// Timestamp de criação. Quando omitido, usa o horário UTC atual.
    pub created_at: Option<String>,
}

/// Opções recebidas do Node.js para emitir uma credencial SSI-PQ.
#[napi(object)]
pub struct NodeCredentialIssueOptions {
    /// Identificador opcional da credencial.
    pub credential_id: Option<String>,
    /// Timestamp de emissão. Quando omitido, usa o horário UTC atual.
    pub issued_at: Option<String>,
    /// Timestamp opcional de expiração.
    pub expires_at: Option<String>,
    /// Referência opcional de status/revogação.
    pub status_ref: Option<Value>,
    /// Caminhos de atributos que serão revelados no pacote assinado.
    pub visible_paths: Option<Vec<String>>,
    /// Versão do pacote assinado (`v2` por padrão, `v1` para compatibilidade).
    pub credential_version: Option<String>,
}

/// Opções recebidas do Node.js para vincular uma credencial a um PDF-base.
#[napi(object)]
pub struct NodePdfBindingOptions {
    /// Timestamp de criação do vínculo. Quando omitido, usa o horário UTC atual.
    pub created_at: Option<String>,
    /// CID opcional do DID Document público quando publicado.
    pub did_doc_cid: Option<String>,
}

/// Opções para a marca visual da assinatura no PDF.
#[napi(object)]
pub struct NodeVisualSignatureOptions {
    pub mode: Option<String>,
    pub placement: Option<String>,
    pub text: Option<String>,
}

/// Opções recebidas do Node.js para assinar um PDF genérico.
#[napi(object)]
pub struct NodePdfSignOptions {
    /// Timestamp de criação da assinatura genérica do PDF.
    pub created_at: Option<String>,
    /// CID opcional do DID Document público quando publicado.
    pub did_doc_cid: Option<String>,
    /// Configuração opcional para assinatura visual.
    pub visual_signature: Option<NodeVisualSignatureOptions>,
}

/// Opções recebidas do Node.js para criar uma wallet.
#[napi(object)]
pub struct NodeWalletCreateOptions {
    /// Timestamp de criação. Quando omitido, usa o horário UTC atual.
    pub created_at: Option<String>,
}

/// Opções recebidas do Node.js para criar um DID dentro da wallet.
#[napi(object)]
pub struct NodeWalletDidCreateOptions {
    /// Rótulo local opcional do DID.
    pub label: Option<String>,
    /// Perfil ML-DSA desejado. Quando omitido, usa `ML-DSA-65`.
    pub mldsa: Option<String>,
    /// Perfil ML-KEM desejado. Quando omitido, usa `ML-KEM-768`.
    pub mlkem: Option<String>,
    /// Timestamp de criação. Quando omitido, usa o horário UTC atual.
    pub created_at: Option<String>,
    /// CID opcional do DID Document público quando publicado.
    pub did_doc_cid: Option<String>,
}

/// Gera um par de chaves ML-DSA e retorna as chaves em base64url.
#[napi(js_name = "mldsaGenerateKeypair")]
pub fn mldsa_generate_keypair_for_node(profile: String) -> napi::Result<NodeKeyPair> {
    let profile = MlDsaProfile::from_str(&profile).map_err(to_napi_error)?;
    let key_pair = mldsa::keygen(profile).map_err(to_napi_error)?;

    Ok(NodeKeyPair {
        profile: key_pair.profile.as_str().to_string(),
        public_key: encoding::base64url_encode(&key_pair.public_key),
        private_key: encoding::base64url_encode(&key_pair.private_key),
    })
}

/// Assina uma mensagem com ML-DSA usando chave privada em base64url.
///
/// O `context` deve identificar o domínio criptográfico da assinatura.
#[napi(js_name = "mldsaSign")]
pub fn mldsa_sign_for_node(
    profile: String,
    private_key: String,
    message: Buffer,
    context: String,
) -> napi::Result<String> {
    let profile = MlDsaProfile::from_str(&profile).map_err(to_napi_error)?;
    let private_key = encoding::base64url_decode(&private_key).map_err(to_napi_error)?;
    let signature = mldsa::sign(profile, &private_key, message.as_ref(), context.as_bytes())
        .map_err(to_napi_error)?;

    Ok(encoding::base64url_encode(&signature.signature))
}

/// Verifica uma assinatura ML-DSA usando chave pública e assinatura em base64url.
#[napi(js_name = "mldsaVerify")]
pub fn mldsa_verify_for_node(
    profile: String,
    public_key: String,
    message: Buffer,
    context: String,
    signature: String,
) -> napi::Result<bool> {
    let profile = MlDsaProfile::from_str(&profile).map_err(to_napi_error)?;
    let public_key = encoding::base64url_decode(&public_key).map_err(to_napi_error)?;
    let signature = encoding::base64url_decode(&signature).map_err(to_napi_error)?;

    mldsa::verify(
        profile,
        &public_key,
        message.as_ref(),
        context.as_bytes(),
        &signature,
    )
    .map_err(to_napi_error)
}

/// Gera um par de chaves ML-KEM e retorna as chaves em base64url.
#[napi(js_name = "mlkemGenerateKeypair")]
pub fn mlkem_generate_keypair_for_node(profile: String) -> napi::Result<NodeKeyPair> {
    let profile = MlKemProfile::from_str(&profile).map_err(to_napi_error)?;
    let key_pair = mlkem::keygen(profile).map_err(to_napi_error)?;

    Ok(NodeKeyPair {
        profile: key_pair.profile.as_str().to_string(),
        public_key: encoding::base64url_encode(&key_pair.public_key),
        private_key: encoding::base64url_encode(&key_pair.private_key),
    })
}

/// Encapsula um segredo compartilhado para uma chave pública ML-KEM.
#[napi(js_name = "mlkemEncapsulate")]
pub fn mlkem_encapsulate_for_node(
    profile: String,
    public_key: String,
) -> napi::Result<NodeMlkemEncapsulation> {
    let profile = MlKemProfile::from_str(&profile).map_err(to_napi_error)?;
    let public_key = encoding::base64url_decode(&public_key).map_err(to_napi_error)?;
    let encapsulation = mlkem::encapsulate(profile, &public_key).map_err(to_napi_error)?;

    Ok(NodeMlkemEncapsulation {
        profile: encapsulation.profile.as_str().to_string(),
        ciphertext: encoding::base64url_encode(&encapsulation.ciphertext),
        shared_secret: encoding::base64url_encode(&encapsulation.shared_secret),
    })
}

/// Decapsula um segredo compartilhado a partir de chave privada e ciphertext.
#[napi(js_name = "mlkemDecapsulate")]
pub fn mlkem_decapsulate_for_node(
    profile: String,
    private_key: String,
    ciphertext: String,
) -> napi::Result<String> {
    let profile = MlKemProfile::from_str(&profile).map_err(to_napi_error)?;
    let private_key = encoding::base64url_decode(&private_key).map_err(to_napi_error)?;
    let ciphertext = encoding::base64url_decode(&ciphertext).map_err(to_napi_error)?;
    let shared_secret =
        mlkem::decapsulate(profile, &private_key, &ciphertext).map_err(to_napi_error)?;

    Ok(encoding::base64url_encode(&shared_secret))
}

/// Cifra bytes usando AES-256-GCM implementado no core Rust.
#[napi(js_name = "aes256GcmEncrypt")]
pub fn aes256_gcm_encrypt_for_node(
    key: Buffer,
    plaintext: Buffer,
    aad: Option<Buffer>,
) -> napi::Result<NodeAes256GcmEncryption> {
    let aad = aad.as_ref().map(|buffer| buffer.as_ref()).unwrap_or(&[]);
    let encrypted =
        aes_gcm::encrypt(key.as_ref(), plaintext.as_ref(), aad).map_err(to_napi_error)?;

    Ok(NodeAes256GcmEncryption {
        ciphertext: encrypted.ciphertext.into(),
        nonce: encrypted.nonce.to_vec().into(),
        auth_tag: encrypted.auth_tag.to_vec().into(),
    })
}

/// Decifra bytes usando AES-256-GCM implementado no core Rust.
#[napi(js_name = "aes256GcmDecrypt")]
pub fn aes256_gcm_decrypt_for_node(
    key: Buffer,
    ciphertext: Buffer,
    nonce: Buffer,
    auth_tag: Buffer,
    aad: Option<Buffer>,
) -> napi::Result<Buffer> {
    let aad = aad.as_ref().map(|buffer| buffer.as_ref()).unwrap_or(&[]);
    let plaintext = aes_gcm::decrypt(
        key.as_ref(),
        ciphertext.as_ref(),
        nonce.as_ref(),
        auth_tag.as_ref(),
        aad,
    )
    .map_err(to_napi_error)?;

    Ok(plaintext.into())
}

/// Gera um DID SSI-PQ com chaves públicas ML-DSA e ML-KEM.
///
/// O DID Document retornado contém somente material público. As chaves privadas
/// ficam no campo `privateKeys` apenas para testes até existir a wallet cifrada.
#[napi(js_name = "createDid")]
pub fn create_did_for_node(options: NodeDidCreateOptions) -> napi::Result<NodeDidCreationResult> {
    let mldsa_profile = options
        .mldsa
        .as_deref()
        .unwrap_or("ML-DSA-65")
        .parse::<MlDsaProfile>()
        .map_err(to_napi_error)?;
    let mlkem_profile = options
        .mlkem
        .as_deref()
        .unwrap_or("ML-KEM-768")
        .parse::<MlKemProfile>()
        .map_err(to_napi_error)?;
    let created_at = options.created_at.unwrap_or_else(now_rfc3339);
    let result = did::create_did(did::DidCreateOptions {
        mldsa_profile,
        mlkem_profile,
        created_at,
    })
    .map_err(to_napi_error)?;

    Ok(NodeDidCreationResult {
        did: result.did.clone(),
        fingerprint: result.fingerprint.clone(),
        did_document: did::did_document_to_json(&result.did_document).map_err(to_napi_error)?,
        private_keys: did::private_keys_to_json(&result),
    })
}

/// Verifica a assinatura e a coerência de fingerprint de um DID Document.
#[napi(js_name = "didVerify")]
pub fn did_verify_for_node(did_document: Value) -> napi::Result<bool> {
    let did_document = did::did_document_from_json(did_document).map_err(to_napi_error)?;
    did::verify_did_document(&did_document).map_err(to_napi_error)
}

/// Verifica se o DID corresponde ao fingerprint das chaves públicas declaradas.
#[napi(js_name = "didFingerprintMatchesKeys")]
pub fn did_fingerprint_matches_keys_for_node(did_document: Value) -> napi::Result<bool> {
    let did_document = did::did_document_from_json(did_document).map_err(to_napi_error)?;
    did::fingerprint_matches_keys(&did_document).map_err(to_napi_error)
}

/// Cria um Schema SSI-PQ padronizado a partir de um JSON simples.
#[napi(js_name = "createSchemaFromAttributes")]
pub fn create_schema_from_attributes_for_node(
    attributes: Value,
    options: Option<NodeSchemaCreateOptions>,
) -> napi::Result<Value> {
    let options = options.unwrap_or(NodeSchemaCreateOptions {
        version: None,
        created_at: None,
    });
    let schema = schema::create_schema_from_attributes(
        &attributes,
        SchemaCreateOptions {
            version: options.version.unwrap_or_else(|| "1".to_string()),
            created_at: options.created_at.unwrap_or_else(now_rfc3339),
        },
    )
    .map_err(to_napi_error)?;

    schema::schema_to_json(&schema).map_err(to_napi_error)
}

/// Emite uma credencial assinada a partir de Schema, atributos e DID do emissor.
#[napi(js_name = "issueCredentialFromSchema")]
pub fn issue_credential_from_schema_for_node(
    schema: Value,
    attributes: Value,
    issuer_did_document: Value,
    issuer_private_key: String,
    options: Option<NodeCredentialIssueOptions>,
) -> napi::Result<Value> {
    let schema = schema::schema_from_json(schema).map_err(to_napi_error)?;
    let issuer_did_document =
        did::did_document_from_json(issuer_did_document).map_err(to_napi_error)?;
    let issuer_private_key =
        encoding::base64url_decode(&issuer_private_key).map_err(to_napi_error)?;
    let options = options.unwrap_or(NodeCredentialIssueOptions {
        credential_id: None,
        issued_at: None,
        expires_at: None,
        status_ref: None,
        visible_paths: None,
        credential_version: None,
    });
    let credential_version =
        credential::SignedCredentialVersion::from_option(options.credential_version)
            .map_err(to_napi_error)?;
    let signed_credential = credential::issue_credential_from_schema(
        &schema,
        &attributes,
        &issuer_did_document,
        &issuer_private_key,
        CredentialIssueOptions {
            credential_id: options.credential_id,
            issued_at: options.issued_at.unwrap_or_else(now_rfc3339),
            expires_at: options.expires_at,
            status_ref: options.status_ref,
            visible_paths: options.visible_paths,
            credential_version,
        },
    )
    .map_err(to_napi_error)?;

    credential::signed_credential_to_json(&signed_credential).map_err(to_napi_error)
}

/// Verifica criptograficamente uma credencial assinada.
#[napi(js_name = "verifySignedCredential")]
pub fn verify_signed_credential_for_node(
    signed_credential: Value,
    issuer_did_document: Value,
) -> napi::Result<bool> {
    let signed_credential =
        credential::signed_credential_from_json(signed_credential).map_err(to_napi_error)?;
    let issuer_did_document =
        did::did_document_from_json(issuer_did_document).map_err(to_napi_error)?;
    credential::verify_signed_credential(&signed_credential, &issuer_did_document)
        .map_err(to_napi_error)
}

/// Gera um PDF visual simples a partir de uma credencial assinada.
///
/// O PDF mostra a credencial em linguagem de usuário, com atributos revelados,
/// emissor e informações básicas de assinatura.
#[napi(js_name = "signedCredentialToPdf")]
pub fn signed_credential_to_pdf_for_node(
    signed_credential: Value,
    options: Option<Value>,
) -> napi::Result<Buffer> {
    let signed_credential =
        credential::signed_credential_from_json(signed_credential).map_err(to_napi_error)?;
    let options = pdf_render_options_from_node(options)?;
    let pdf_bytes = pdf::signed_credential_to_pdf_with_options(&signed_credential, options)
        .map_err(to_napi_error)?;

    Ok(pdf_bytes.into())
}

/// Embute a credencial assinada em um PDF-base e assina o vínculo PDF↔JSON.
///
/// O retorno é o PDF final com um manifesto SSI em JSON anexado como arquivo
/// embutido e validável programaticamente.
#[napi(js_name = "embedSignedCredentialInPdf")]
pub fn embed_signed_credential_in_pdf_for_node(
    pdf_base: Buffer,
    signed_credential: Value,
    issuer_did_document: Value,
    issuer_private_key: String,
    options: Option<NodePdfBindingOptions>,
) -> napi::Result<Buffer> {
    let signed_credential =
        credential::signed_credential_from_json(signed_credential).map_err(to_napi_error)?;
    let issuer_did_document =
        did::did_document_from_json(issuer_did_document).map_err(to_napi_error)?;
    let issuer_private_key =
        encoding::base64url_decode(&issuer_private_key).map_err(to_napi_error)?;
    let options = options.unwrap_or(NodePdfBindingOptions {
        created_at: None,
        did_doc_cid: None,
    });
    let final_pdf = pdf::embed_signed_credential_in_pdf(
        pdf_base.as_ref(),
        &signed_credential,
        &issuer_did_document,
        &issuer_private_key,
        pdf::PdfBindingOptions {
            created_at: options.created_at.unwrap_or_else(now_rfc3339),
            did_doc_cid: options.did_doc_cid,
        },
    )
    .map_err(to_napi_error)?;

    Ok(final_pdf.into())
}

/// Extrai o manifesto SSI embutido em um PDF-credencial.
///
/// Esta função não substitui a verificação criptográfica completa; ela existe
/// para inspeção e depuração do JSON embutido.
#[napi(js_name = "extractCredentialManifestFromPdf")]
pub fn extract_credential_manifest_from_pdf_for_node(pdf_bytes: Buffer) -> napi::Result<Value> {
    let manifest = pdf::extract_pdf_manifest(pdf_bytes.as_ref()).map_err(to_napi_error)?;
    pdf::pdf_manifest_to_json(&manifest).map_err(to_napi_error)
}

/// Verifica um PDF-credencial e retorna diagnóstico criptográfico completo.
#[napi(js_name = "verifySignedCredentialPdf")]
pub fn verify_signed_credential_pdf_for_node(
    pdf_bytes: Buffer,
    issuer_did_document: Value,
) -> napi::Result<Value> {
    let issuer_did_document =
        did::did_document_from_json(issuer_did_document).map_err(to_napi_error)?;
    let result = pdf::verify_signed_credential_pdf(pdf_bytes.as_ref(), &issuer_did_document)
        .map_err(to_napi_error)?;

    pdf::pdf_verification_result_to_json(&result).map_err(to_napi_error)
}

/// Extrai o manifesto de assinatura genérica embutido em um PDF.
#[napi(js_name = "extractGenericSignatureManifestFromPdf")]
pub fn extract_generic_signature_manifest_from_pdf_for_node(
    pdf_bytes: Buffer,
) -> napi::Result<Value> {
    let manifest =
        pdf_sign::extract_generic_signature_manifest(pdf_bytes.as_ref()).map_err(to_napi_error)?;
    pdf_sign::pdf_generic_manifest_to_json(&manifest).map_err(to_napi_error)
}

/// Verifica um PDF assinado genericamente e retorna o diagnóstico.
#[napi(js_name = "verifySignedGenericPdf")]
pub fn verify_signed_generic_pdf_for_node(
    pdf_bytes: Buffer,
    signer_did_document: Value,
) -> napi::Result<Value> {
    let signer_did_document =
        did::did_document_from_json(signer_did_document).map_err(to_napi_error)?;
    let result = pdf_sign::verify_generic_pdf(pdf_bytes.as_ref(), &signer_did_document)
        .map_err(to_napi_error)?;

    pdf_sign::generic_pdf_verification_result_to_json(&result).map_err(to_napi_error)
}

/// Cria uma wallet SQLite cifrada por SQLCipher.
///
/// A wallet armazena DID Documents públicos e chaves privadas cifradas por
/// linha, derivadas da senha por Argon2id.
#[napi(js_name = "walletCreate")]
pub fn wallet_create_for_node(
    path: String,
    password: String,
    options: Option<NodeWalletCreateOptions>,
) -> napi::Result<Value> {
    let options = options.unwrap_or(NodeWalletCreateOptions { created_at: None });
    let info = wallet::create_wallet(
        path,
        &password,
        wallet::WalletCreateOptions {
            created_at: options.created_at.unwrap_or_else(now_rfc3339),
        },
    )
    .map_err(to_napi_error)?;

    serde_json::to_value(info).map_err(to_napi_error)
}

/// Abre uma wallet cifrada e retorna metadados públicos.
#[napi(js_name = "walletOpen")]
pub fn wallet_open_for_node(path: String, password: String) -> napi::Result<Value> {
    let info = wallet::open_wallet(path, &password).map_err(to_napi_error)?;
    serde_json::to_value(info).map_err(to_napi_error)
}

/// Troca a senha da wallet e recifra o banco e as chaves privadas por linha.
#[napi(js_name = "walletChangePassword")]
pub fn wallet_change_password_for_node(
    path: String,
    old_password: String,
    new_password: String,
) -> napi::Result<Value> {
    let info = wallet::change_wallet_password(path, &old_password, &new_password)
        .map_err(to_napi_error)?;
    serde_json::to_value(info).map_err(to_napi_error)
}

/// Cria um DID dentro da wallet sem exportar as chaves privadas.
#[napi(js_name = "walletCreateDid")]
pub fn wallet_create_did_for_node(
    path: String,
    password: String,
    options: NodeWalletDidCreateOptions,
) -> napi::Result<Value> {
    let mldsa_profile = options
        .mldsa
        .as_deref()
        .unwrap_or("ML-DSA-65")
        .parse::<MlDsaProfile>()
        .map_err(to_napi_error)?;
    let mlkem_profile = options
        .mlkem
        .as_deref()
        .unwrap_or("ML-KEM-768")
        .parse::<MlKemProfile>()
        .map_err(to_napi_error)?;
    let result = wallet::wallet_create_did(
        path,
        &password,
        wallet::WalletDidCreateOptions {
            label: options.label,
            mldsa_profile,
            mlkem_profile,
            created_at: options.created_at.unwrap_or_else(now_rfc3339),
            did_doc_cid: options.did_doc_cid,
        },
    )
    .map_err(to_napi_error)?;

    serde_json::to_value(result).map_err(to_napi_error)
}

/// Lista os DIDs armazenados na wallet.
#[napi(js_name = "walletListDids")]
pub fn wallet_list_dids_for_node(path: String, password: String) -> napi::Result<Value> {
    let dids = wallet::wallet_list_dids(path, &password).map_err(to_napi_error)?;
    serde_json::to_value(dids).map_err(to_napi_error)
}

/// Recupera o DID Document público armazenado na wallet.
#[napi(js_name = "walletGetDidDocument")]
pub fn wallet_get_did_document_for_node(
    path: String,
    password: String,
    did: String,
) -> napi::Result<Value> {
    let did_document =
        wallet::wallet_get_did_document(path, &password, &did).map_err(to_napi_error)?;
    did::did_document_to_json(&did_document).map_err(to_napi_error)
}

/// Emite uma credencial usando a chave ML-DSA guardada na wallet.
#[napi(js_name = "walletIssueCredentialFromSchema")]
pub fn wallet_issue_credential_from_schema_for_node(
    path: String,
    password: String,
    did: String,
    schema: Value,
    attributes: Value,
    options: Option<NodeCredentialIssueOptions>,
) -> napi::Result<Value> {
    let schema = schema::schema_from_json(schema).map_err(to_napi_error)?;
    let options = options.unwrap_or(NodeCredentialIssueOptions {
        credential_id: None,
        issued_at: None,
        expires_at: None,
        status_ref: None,
        visible_paths: None,
        credential_version: None,
    });
    let credential_version =
        credential::SignedCredentialVersion::from_option(options.credential_version)
            .map_err(to_napi_error)?;
    let signed_credential = wallet::wallet_issue_credential_from_schema(
        path,
        &password,
        &did,
        &schema,
        &attributes,
        CredentialIssueOptions {
            credential_id: options.credential_id,
            issued_at: options.issued_at.unwrap_or_else(now_rfc3339),
            expires_at: options.expires_at,
            status_ref: options.status_ref,
            visible_paths: options.visible_paths,
            credential_version,
        },
    )
    .map_err(to_napi_error)?;

    credential::signed_credential_to_json(&signed_credential).map_err(to_napi_error)
}

/// Embute uma credencial assinada em PDF usando a chave ML-DSA da wallet.
#[napi(js_name = "walletEmbedSignedCredentialInPdf")]
pub fn wallet_embed_signed_credential_in_pdf_for_node(
    path: String,
    password: String,
    did: String,
    pdf_base: Buffer,
    signed_credential: Value,
    options: Option<NodePdfBindingOptions>,
) -> napi::Result<Buffer> {
    let signed_credential =
        credential::signed_credential_from_json(signed_credential).map_err(to_napi_error)?;
    let options = options.unwrap_or(NodePdfBindingOptions {
        created_at: None,
        did_doc_cid: None,
    });
    let final_pdf = wallet::wallet_embed_signed_credential_in_pdf(
        path,
        &password,
        &did,
        pdf_base.as_ref(),
        &signed_credential,
        pdf::PdfBindingOptions {
            created_at: options.created_at.unwrap_or_else(now_rfc3339),
            did_doc_cid: options.did_doc_cid,
        },
    )
    .map_err(to_napi_error)?;

    Ok(final_pdf.into())
}

/// Assina um PDF genérico usando a chave ML-DSA da wallet.
#[napi(js_name = "walletSignGenericPdf")]
pub fn wallet_sign_generic_pdf_for_node(
    path: String,
    password: String,
    did: String,
    pdf_base: Buffer,
    options: Option<NodePdfSignOptions>,
) -> napi::Result<Buffer> {
    let options = options.unwrap_or(NodePdfSignOptions {
        created_at: None,
        did_doc_cid: None,
        visual_signature: None,
    });
    let visibility = pdf_signature_visibility_from_node(options.visual_signature)?;
    let final_pdf = wallet::wallet_sign_generic_pdf(
        path,
        &password,
        &did,
        pdf_base.as_ref(),
        pdf_sign::PdfSignOptions {
            created_at: options.created_at.unwrap_or_else(now_rfc3339),
            did_doc_cid: options.did_doc_cid,
            visibility,
        },
    )
    .map_err(to_napi_error)?;

    Ok(final_pdf.into())
}

/// Decapsula um segredo ML-KEM usando a chave privada guardada na wallet.
#[napi(js_name = "walletMlkemDecapsulate")]
pub fn wallet_mlkem_decapsulate_for_node(
    path: String,
    password: String,
    did: String,
    ciphertext: String,
) -> napi::Result<String> {
    let ciphertext = encoding::base64url_decode(&ciphertext).map_err(to_napi_error)?;
    let decapsulation = wallet::wallet_mlkem_decapsulate(path, &password, &did, &ciphertext)
        .map_err(to_napi_error)?;

    Ok(encoding::base64url_encode(&decapsulation.shared_secret))
}
