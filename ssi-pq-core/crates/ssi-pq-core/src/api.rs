use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    Result, SsiError, canonical_json as canonical_json_module, credential,
    credential::CredentialIssueOptions,
    did, encoding, pdf,
    pdf::{PdfBindingOptions, PdfRenderOptions},
    profiles::{MlDsaProfile, MlKemProfile},
    schema::{self, SchemaCreateOptions},
};

/// Lista os perfis pós-quânticos suportados pela API pública comum.
pub fn supported_profiles() -> Vec<String> {
    vec![
        "ML-DSA-44".to_string(),
        "ML-DSA-65".to_string(),
        "ML-DSA-87".to_string(),
        "ML-KEM-512".to_string(),
        "ML-KEM-768".to_string(),
        "ML-KEM-1024".to_string(),
    ]
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiDidCreateOptions {
    mldsa: Option<String>,
    mlkem: Option<String>,
    #[serde(alias = "created_at")]
    created_at: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiSchemaCreateOptions {
    version: Option<String>,
    #[serde(alias = "created_at")]
    created_at: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiCredentialIssueOptions {
    #[serde(alias = "credential_id")]
    credential_id: Option<String>,
    #[serde(alias = "issued_at")]
    issued_at: Option<String>,
    #[serde(alias = "expires_at")]
    expires_at: Option<String>,
    #[serde(alias = "status_ref")]
    status_ref: Option<Value>,
    #[serde(alias = "visible_paths")]
    visible_paths: Option<Vec<String>>,
    #[serde(alias = "credential_version")]
    credential_version: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiPdfBindingOptions {
    #[serde(alias = "created_at")]
    created_at: Option<String>,
    #[serde(alias = "did_doc_cid")]
    did_doc_cid: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiPdfRenderOptions {
    labels: Option<BTreeMap<String, String>>,
}

/// Canonicaliza uma string JSON usando o mesmo formato assinado pelo core.
pub fn canonical_json(input: &str) -> Result<String> {
    canonical_json_module::canonical_json_string_from_str(input)
}

/// Cria um DID SSI-PQ e retorna DID Document e chaves privadas como JSON textual.
pub fn create_did_json(options_json: Option<&str>) -> Result<String> {
    let options = parse_optional_options::<ApiDidCreateOptions>(options_json)?;
    let created_at = required_option(options.created_at, "createdAt", |message| {
        SsiError::InvalidDidDocument(message)
    })?;
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
    let result = did::create_did(did::DidCreateOptions {
        mldsa_profile,
        mlkem_profile,
        created_at,
    })?;

    json_value_to_string(json!({
        "did": result.did,
        "fingerprint": result.fingerprint,
        "didDocument": did::did_document_to_json(&result.did_document)?,
        "privateKeys": did::private_keys_to_json(&result),
    }))
}

/// Cria um Schema a partir de JSON textual e retorna o Schema como JSON textual.
pub fn create_schema_from_attributes_json(
    attributes_json: &str,
    options_json: Option<&str>,
) -> Result<String> {
    let attributes = parse_json_value(attributes_json)?;
    let options = parse_optional_options::<ApiSchemaCreateOptions>(options_json)?;
    let created_at = required_option(options.created_at, "createdAt", |message| {
        SsiError::InvalidSchema(message)
    })?;
    let schema = schema::create_schema_from_attributes(
        &attributes,
        SchemaCreateOptions {
            version: options.version.unwrap_or_else(|| "1".to_string()),
            created_at,
        },
    )?;

    json_value_to_string(schema::schema_to_json(&schema)?)
}

/// Verifica assinatura e fingerprint de um DID Document textual.
pub fn verify_did_document_json(did_document_json: &str) -> Result<String> {
    let did_document = did_document_from_json_str(did_document_json)?;
    json_value_to_string(json!({
        "valid": did::verify_did_document(&did_document)?,
        "fingerprintMatchesKeys": did::fingerprint_matches_keys(&did_document)?,
    }))
}

/// Verifica uma credencial assinada textual contra o DID Document do emissor.
pub fn verify_signed_credential_json(
    signed_credential_json: &str,
    issuer_did_document_json: &str,
) -> Result<String> {
    let signed_credential =
        credential::signed_credential_from_json(parse_json_value(signed_credential_json)?)?;
    let issuer_did_document = did_document_from_json_str(issuer_did_document_json)?;

    json_value_to_string(json!({
        "valid": credential::verify_signed_credential(&signed_credential, &issuer_did_document)?,
    }))
}

/// Emite uma credencial assinada a partir de documentos JSON textuais.
pub fn issue_credential_from_schema_json(
    schema_json: &str,
    attributes_json: &str,
    issuer_did_document_json: &str,
    issuer_private_key: &str,
    options_json: Option<&str>,
) -> Result<String> {
    let schema = schema::schema_from_json(parse_json_value(schema_json)?)?;
    let attributes = parse_json_value(attributes_json)?;
    let issuer_did_document = did_document_from_json_str(issuer_did_document_json)?;
    let issuer_private_key = encoding::base64url_decode(issuer_private_key)?;
    let options = parse_optional_options::<ApiCredentialIssueOptions>(options_json)?;
    let issued_at = required_option(options.issued_at, "issuedAt", |message| {
        SsiError::InvalidCredential(message)
    })?;
    let signed_credential = credential::issue_credential_from_schema(
        &schema,
        &attributes,
        &issuer_did_document,
        &issuer_private_key,
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

    json_value_to_string(credential::signed_credential_to_json(&signed_credential)?)
}

/// Renderiza uma credencial assinada textual como PDF.
pub fn signed_credential_to_pdf_bytes(
    signed_credential_json: &str,
    render_options_json: Option<&str>,
) -> Result<Vec<u8>> {
    let signed_credential =
        credential::signed_credential_from_json(parse_json_value(signed_credential_json)?)?;
    let render_options = pdf_render_options_from_json(render_options_json)?;

    pdf::signed_credential_to_pdf_with_options(&signed_credential, render_options)
}

/// Embute uma credencial assinada textual em PDF-base e assina o vínculo.
pub fn embed_signed_credential_in_pdf_bytes(
    pdf_base: &[u8],
    signed_credential_json: &str,
    issuer_did_document_json: &str,
    issuer_private_key: &str,
    options_json: Option<&str>,
) -> Result<Vec<u8>> {
    let signed_credential =
        credential::signed_credential_from_json(parse_json_value(signed_credential_json)?)?;
    let issuer_did_document = did_document_from_json_str(issuer_did_document_json)?;
    let issuer_private_key = encoding::base64url_decode(issuer_private_key)?;
    let options = parse_optional_options::<ApiPdfBindingOptions>(options_json)?;
    let created_at = required_option(options.created_at, "createdAt", |message| {
        SsiError::InvalidPdf(message)
    })?;

    pdf::embed_signed_credential_in_pdf(
        pdf_base,
        &signed_credential,
        &issuer_did_document,
        &issuer_private_key,
        PdfBindingOptions {
            created_at,
            did_doc_cid: options.did_doc_cid,
        },
    )
}

/// Extrai o manifesto SSI-PQ embutido em um PDF e retorna JSON textual.
pub fn extract_credential_manifest_from_pdf_bytes(pdf_bytes: &[u8]) -> Result<String> {
    let manifest = pdf::extract_pdf_manifest(pdf_bytes)?;
    json_value_to_string(pdf::pdf_manifest_to_json(&manifest)?)
}

/// Verifica um PDF-credencial e retorna diagnóstico como JSON textual.
pub fn verify_signed_credential_pdf_json(
    pdf_bytes: &[u8],
    issuer_did_document_json: &str,
) -> Result<String> {
    let issuer_did_document = did_document_from_json_str(issuer_did_document_json)?;
    let result = pdf::verify_signed_credential_pdf(pdf_bytes, &issuer_did_document)?;

    json_value_to_string(pdf::pdf_verification_result_to_json(&result)?)
}

fn parse_json_value(input: &str) -> Result<Value> {
    Ok(serde_json::from_str(input)?)
}

fn parse_optional_options<T>(input: Option<&str>) -> Result<T>
where
    T: Default + for<'de> Deserialize<'de>,
{
    match input {
        Some(input) => Ok(serde_json::from_str(input)?),
        None => Ok(T::default()),
    }
}

fn did_document_from_json_str(input: &str) -> Result<did::DidDocument> {
    did::did_document_from_json(parse_json_value(input)?)
}

fn pdf_render_options_from_json(input: Option<&str>) -> Result<PdfRenderOptions> {
    let options = parse_optional_options::<ApiPdfRenderOptions>(input)?;

    Ok(PdfRenderOptions {
        labels: options.labels.unwrap_or_default(),
    })
}

fn json_value_to_string(value: Value) -> Result<String> {
    Ok(serde_json::to_string(&value)?)
}

fn required_option<T, F>(value: Option<T>, field: &str, error: F) -> Result<T>
where
    F: FnOnce(String) -> SsiError,
{
    value.ok_or_else(|| error(format!("{field} is required")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        did::{self, DidCreateOptions},
        profiles::{MlDsaProfile, MlKemProfile},
    };

    #[test]
    fn common_api_canonicalizes_json_text() {
        assert_eq!(
            canonical_json(r#"{"b":2,"a":1}"#).unwrap(),
            r#"{"a":1,"b":2}"#
        );
    }

    #[test]
    fn common_api_creates_schema_from_json_text() {
        let schema = create_schema_from_attributes_json(
            r#"{"nome":"Ana","curso":"Criptografia"}"#,
            Some(r#"{"version":"1","createdAt":"2026-05-27T00:00:00Z"}"#),
        )
        .unwrap();
        let schema: Value = serde_json::from_str(&schema).unwrap();

        assert_eq!(schema["type"], "ssi_schema_v1");
        assert_eq!(schema["attributes"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn common_api_creates_did_from_json_text() {
        let did = create_did_json(Some(
            r#"{"mldsa":"ML-DSA-65","mlkem":"ML-KEM-768","createdAt":"2026-05-27T00:00:00Z"}"#,
        ))
        .unwrap();
        let did: Value = serde_json::from_str(&did).unwrap();

        assert!(did["did"].as_str().unwrap().starts_with("did:ssipq:z"));
        assert_eq!(did["didDocument"]["id"], did["did"]);
        assert!(did["privateKeys"]["mldsaPrivateKey"].as_str().is_some());
        assert!(did["privateKeys"]["mlkemPrivateKey"].as_str().is_some());
    }

    #[test]
    fn common_api_verifies_did_document_from_json_text() {
        let did = did::create_did(DidCreateOptions {
            mldsa_profile: MlDsaProfile::MlDsa65,
            mlkem_profile: MlKemProfile::MlKem768,
            created_at: "2026-05-27T00:00:00Z".to_string(),
        })
        .unwrap();
        let did_document_json =
            serde_json::to_string(&did::did_document_to_json(&did.did_document).unwrap()).unwrap();
        let result = verify_did_document_json(&did_document_json).unwrap();
        let result: Value = serde_json::from_str(&result).unwrap();

        assert_eq!(result["valid"], true);
        assert_eq!(result["fingerprintMatchesKeys"], true);
    }
}
