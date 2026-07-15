use std::borrow::Cow;

#[cfg(not(target_arch = "wasm32"))]
use std::os::raw::{c_int, c_ulong};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha3::{Digest, Sha3_256};

use crate::{
    Result, SsiError, canonical_json,
    crypto::mldsa,
    did::{self, DidDocument},
    encoding::{
        base64url_decode, base64url_encode, multibase_base58btc_decode, multibase_base58btc_encode,
    },
    hash::sha3_256,
    profiles::MlDsaProfile,
};

const PDF_GENERIC_SIGNATURE_MARKER: &[u8] = b"%SSI-PQ-GENERIC-SIGNATURE-V1\n";
const PDF_GENERIC_MANIFEST_TYPE: &str = "ssi_generic_pdf_signature_v1";
const PDF_GENERIC_SIGNATURE_CONTENTS_TYPE: &str = "ssi_generic_pdf_signature_contents_v1";
const PDF_GENERIC_SIGNATURE_PAYLOAD_TYPE: &str = "ssi_generic_pdf_signature_payload_v1";
const PDF_GENERIC_EMBEDDING_POLICY: &str = "manifest_must_be_final_incremental_update";
const PDF_GENERIC_MANIFEST_FILENAME: &str = "ssi-pq-generic-signature-manifest.json";
const PDF_GENERIC_SIGNATURE_FIELD_NAME: &str = "SSI-PQ Generic Signature";
const PDF_GENERIC_SIGNATURE_REASON: &str = "SSI-PQ generic PDF signature";
const PDF_VISIBLE_SIGNATURE_DEFAULT_TEXT: &str =
    "Documento assinado digitalmente\nSSI-PQ / ML-DSA\nVerifique no validador SSI-PQ";
const PDF_VISIBLE_SIGNATURE_RIGHT_MARGIN_TEXT: &str =
    "Documento assinado digitalmente SSI-PQ / SSI";
const PDF_VISIBLE_SIGNATURE_FOOTER_FONT_SIZE: f64 = 5.8;
const PDF_VISIBLE_SIGNATURE_RIGHT_MARGIN_FONT_SIZE: f64 = 7.0;
const PDF_SIGNATURE_CONTENTS_RAW_CAPACITY: usize = 16 * 1024;
const PDF_SIGNATURE_CONTENTS_HEX_LEN: usize = PDF_SIGNATURE_CONTENTS_RAW_CAPACITY * 2;
const PDF_BYTE_RANGE_NUMBER_WIDTH: usize = 20;
const PDF_BYTE_RANGE_INNER_LEN: usize = PDF_BYTE_RANGE_NUMBER_WIDTH * 4 + 3;

/// Separador de domínio usado para assinar contratos e PDFs genéricos.
pub const PDF_GENERIC_SIGNATURE_CONTEXT: &[u8] = b"SSI_GENERIC_PDF_SIGNATURE_V1";

/// Opções usadas para assinar um PDF genérico.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PdfSignOptions {
    /// Timestamp de criação da assinatura.
    pub created_at: String,
    /// CID opcional do DID Document público quando ele estiver publicado.
    pub did_doc_cid: Option<String>,
    /// Configuração visual da assinatura no PDF final.
    pub visibility: PdfSignatureVisibility,
}

/// Modo de apresentação visual da assinatura PDF.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PdfSignatureVisibility {
    /// Cria um widget de assinatura invisível.
    Invisible,
    /// Cria um widget de assinatura visível na primeira página.
    Visible(PdfVisibleSignatureOptions),
}

/// Opções para assinatura visível.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PdfVisibleSignatureOptions {
    /// Local da assinatura visível na primeira página.
    pub placement: PdfVisibleSignaturePlacement,
    /// Texto curto exibido no retângulo visual.
    pub text: Option<String>,
}

/// Posições suportadas para assinatura visível na primeira página.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PdfVisibleSignaturePlacement {
    /// Retângulo horizontal no rodapé da primeira página.
    FirstPageFooter,
    /// Retângulo vertical na margem direita da primeira página.
    FirstPageRightMargin,
}

/// Assinatura ML-DSA do manifesto do PDF.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfGenericSignature {
    /// Algoritmo ML-DSA usado.
    pub alg: String,
    /// Identificador local da chave no DID Document.
    pub key_id: String,
    /// Algoritmo usado para calcular o hash dos byte ranges assinados.
    pub byte_range_hash_alg: String,
    /// Hash SHA3-256 dos byte ranges do PDF final, excluindo `/Contents`.
    pub byte_range_hash: String,
    /// Algoritmo usado para calcular o hash do manifesto embutido.
    pub manifest_hash_alg: String,
    /// Hash SHA3-256 da forma canônica do manifesto embutido sem assinatura.
    pub manifest_hash: String,
    /// Assinatura ML-DSA em base64url sem padding.
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct PdfGenericSignatureContents {
    #[serde(rename = "type")]
    document_type: String,
    alg: String,
    key_id: String,
    byte_range_hash_alg: String,
    byte_range_hash: String,
    manifest_hash_alg: String,
    manifest_hash: String,
    signature: String,
}

#[derive(Debug, Clone)]
struct ExtractedGenericPdfSignature {
    manifest: PdfGenericSignatureManifest,
    signature: PdfGenericSignature,
    byte_range: [usize; 4],
}

#[derive(Debug, Clone)]
struct VisibleSignatureLayout {
    page_id: usize,
    placement: PdfVisibleSignaturePlacement,
    page_rotation: i32,
    rect: PdfRect,
    width: f64,
    height: f64,
    visual_width: f64,
    visual_height: f64,
    text_lines: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
struct PdfRect {
    left: f64,
    bottom: f64,
    right: f64,
    top: f64,
}

/// Manifesto de Assinatura SSI embutido no PDF final como arquivo JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PdfGenericSignatureManifest {
    /// Tipo/versionamento lógico do manifesto.
    #[serde(rename = "type")]
    pub document_type: String,
    /// Algoritmo usado para calcular o hash do PDF-base.
    pub pdf_hash_alg: String,
    /// Hash SHA3-256 do arquivo PDF original.
    pub pdf_base_hash: String,
    /// Tamanho exato do PDF original em bytes antes de ser assinado.
    pub pdf_base_length: u64,
    /// Política exigida para inserção do manifesto no PDF final.
    pub embedding_policy: String,
    /// DID de quem assinou o documento.
    pub signer_did: String,
    /// CID opcional do DID Document público.
    pub did_doc_cid: Option<String>,
    /// Identificador local da chave de assinatura.
    pub signing_key_id: String,
    /// Fingerprint da chave pública usada para assinar o documento.
    pub signing_key_fingerprint: String,
    /// Timestamp da assinatura.
    pub created_at: String,
    /// Assinatura ML-DSA destacada em `/Contents`, calculada sobre o hash do `/ByteRange`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<PdfGenericSignature>,
}

/// Resultado detalhado da verificação criptográfica de um PDF genérico.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GenericPdfVerificationResult {
    /// Indica se todas as verificações obrigatórias foram aprovadas.
    pub valid: bool,
    /// Estado resumido da verificação.
    pub status: String,
    /// DID do assinante extraído do manifesto, quando disponível.
    pub signer_did: Option<String>,
    /// Indica se o hash dos bytes originais do PDF confere com o manifesto.
    pub pdf_base_hash_valid: bool,
    /// Indica se a assinatura ML-DSA destacada e o `/ByteRange` são válidos.
    pub signature_valid: bool,
    /// Indica se o manifesto é a atualização incremental final do PDF.
    pub manifest_is_final_revision: bool,
    /// Indica se o DID Document e a chave pública correspondem ao manifesto.
    pub did_key_match: bool,
    /// Códigos de erro acumulados durante a verificação.
    pub errors: Vec<String>,
    /// Manifesto extraído do PDF, quando a extração foi possível.
    pub manifest: Option<PdfGenericSignatureManifest>,
}

/// Assina digitalmente qualquer arquivo PDF genérico usando um campo `/Sig`.
///
/// O PDF final usa a mecânica padrão de assinatura destacada do PDF:
/// `/ByteRange` cobre todo o documento exceto `/Contents`, e `/Contents`
/// carrega um contêiner SSI-PQ com assinatura ML-DSA. Como ML-DSA não é CMS
/// clássico, a verificação de confiança continua sendo feita pelo core SSI-PQ.
pub fn sign_generic_pdf(
    pdf_base_bytes: &[u8],
    signer_did_document: &DidDocument,
    signer_private_key: &[u8],
    signing_key_id: &str,
    options: PdfSignOptions,
) -> Result<Vec<u8>> {
    validate_pdf_base(pdf_base_bytes)?;
    crate::time::validate_rfc3339_timestamp("created_at", &options.created_at)
        .map_err(SsiError::InvalidPdf)?;

    if !did::verify_did_document(signer_did_document)? {
        return Err(SsiError::InvalidCredential(
            "signer DID document is not valid".to_string(),
        ));
    }
    if signer_did_document.status != "active" {
        return Err(SsiError::InvalidCredential(
            "signer DID document is not active".to_string(),
        ));
    }

    let (signing_profile, signing_public_key) =
        signer_pdf_signing_key(signer_did_document, signing_key_id)?;
    let visibility = options.visibility.clone();

    let manifest = PdfGenericSignatureManifest {
        document_type: PDF_GENERIC_MANIFEST_TYPE.to_string(),
        pdf_hash_alg: "SHA3-256".to_string(),
        pdf_base_hash: base64url_encode(&sha3_256(pdf_base_bytes)),
        pdf_base_length: pdf_base_bytes.len() as u64,
        embedding_policy: PDF_GENERIC_EMBEDDING_POLICY.to_string(),
        signer_did: signer_did_document.id.clone(),
        did_doc_cid: options.did_doc_cid,
        signing_key_id: signing_key_id.to_string(),
        signing_key_fingerprint: signing_key_fingerprint(
            &signing_profile.as_str(),
            &signing_public_key,
        ),
        created_at: options.created_at,
        signature: None,
    };

    embed_signature_manifest_in_pdf(
        pdf_base_bytes,
        &manifest,
        signing_profile,
        signer_private_key,
        &visibility,
    )
}

/// Extrai o manifesto de assinatura embutido em um PDF genérico.
pub fn extract_generic_signature_manifest(pdf_bytes: &[u8]) -> Result<PdfGenericSignatureManifest> {
    let extracted = extract_generic_signature_components(pdf_bytes)?;
    let mut manifest = extracted.manifest;
    manifest.signature = Some(extracted.signature);
    Ok(manifest)
}

fn extract_embedded_generic_signature_manifest(
    pdf_bytes: &[u8],
) -> Result<PdfGenericSignatureManifest> {
    let marker_offset = rfind_bytes(pdf_bytes, PDF_GENERIC_SIGNATURE_MARKER).ok_or_else(|| {
        SsiError::InvalidPdf("SSI-PQ generic signature marker not found".to_string())
    })?;
    let search = &pdf_bytes[marker_offset..];
    let stream_marker = b"stream\n";
    let stream_relative = find_bytes(search, stream_marker)
        .ok_or_else(|| SsiError::InvalidPdf("manifest stream not found".to_string()))?;
    let stream_start = marker_offset + stream_relative + stream_marker.len();
    let endstream_relative = find_bytes(&pdf_bytes[stream_start..], b"\nendstream")
        .ok_or_else(|| SsiError::InvalidPdf("manifest stream terminator not found".to_string()))?;
    let stream_end = stream_start + endstream_relative;

    Ok(serde_json::from_slice(
        &pdf_bytes[stream_start..stream_end],
    )?)
}

/// Verifica a integridade criptográfica de um PDF genérico.
pub fn verify_generic_pdf(
    pdf_bytes: &[u8],
    signer_did_document: &DidDocument,
) -> Result<GenericPdfVerificationResult> {
    let extracted = match extract_generic_signature_components(pdf_bytes) {
        Ok(extracted) => extracted,
        Err(_) => {
            return Ok(GenericPdfVerificationResult::invalid(
                "MALFORMED_MANIFEST",
                None,
            ));
        }
    };
    let mut manifest = extracted.manifest.clone();
    manifest.signature = Some(extracted.signature.clone());

    let mut result = GenericPdfVerificationResult::from_manifest(manifest.clone());

    if manifest.document_type != PDF_GENERIC_MANIFEST_TYPE
        || manifest.embedding_policy != PDF_GENERIC_EMBEDDING_POLICY
    {
        result.push_error("MALFORMED_MANIFEST");
    }
    if crate::time::validate_rfc3339_timestamp("created_at", &manifest.created_at).is_err() {
        result.push_error("INVALID_CREATED_AT");
    }

    result.did_key_match =
        did_document_matches_manifest(signer_did_document, &manifest).unwrap_or(false);
    if !result.did_key_match {
        result.push_error("DID_KEY_MISMATCH");
    }

    let pdf_base_length = usize::try_from(manifest.pdf_base_length).ok();
    let pdf_base_bytes = pdf_base_length.and_then(|length| pdf_bytes.get(..length));

    if let Some(pdf_base_bytes) = pdf_base_bytes {
        let actual_pdf_hash = base64url_encode(&sha3_256(pdf_base_bytes));
        result.pdf_base_hash_valid =
            manifest.pdf_hash_alg == "SHA3-256" && manifest.pdf_base_hash == actual_pdf_hash;
        if !result.pdf_base_hash_valid {
            result.push_error("PDF_BASE_HASH_MISMATCH");
        }
    } else {
        result.push_error("PDF_BASE_LENGTH_INVALID");
    }

    result.signature_valid =
        verify_manifest_signature(pdf_bytes, &extracted, signer_did_document).unwrap_or(false);
    if !result.signature_valid {
        result.push_error("INVALID_SIGNATURE");
    }

    result.manifest_is_final_revision =
        extracted.byte_range[2].saturating_add(extracted.byte_range[3]) == pdf_bytes.len();
    if !result.manifest_is_final_revision {
        result.push_error("MANIFEST_NOT_FINAL_REVISION");
    }

    result.finalize();
    Ok(result)
}

pub fn pdf_generic_manifest_to_json(manifest: &PdfGenericSignatureManifest) -> Result<Value> {
    Ok(serde_json::to_value(manifest)?)
}

pub fn generic_pdf_verification_result_to_json(
    result: &GenericPdfVerificationResult,
) -> Result<Value> {
    Ok(serde_json::to_value(result)?)
}

fn verify_manifest_signature(
    pdf_bytes: &[u8],
    extracted: &ExtractedGenericPdfSignature,
    signer_did_document: &DidDocument,
) -> Result<bool> {
    let manifest = &extracted.manifest;
    let (profile, public_key) =
        signer_pdf_signing_key(signer_did_document, &manifest.signing_key_id)?;
    let signature_obj = &extracted.signature;

    if signature_obj.alg != profile.as_str() || signature_obj.key_id != manifest.signing_key_id {
        return Ok(false);
    }
    if signature_obj.byte_range_hash_alg != "SHA3-256"
        || signature_obj.manifest_hash_alg != "SHA3-256"
    {
        return Ok(false);
    }

    let manifest_hash = base64url_encode(&sha3_256(&manifest_canonical_bytes(manifest)?));
    if signature_obj.manifest_hash != manifest_hash {
        return Ok(false);
    }

    let actual_byte_range_hash =
        base64url_encode(&byte_range_sha3_256(pdf_bytes, extracted.byte_range)?);
    if signature_obj.byte_range_hash != actual_byte_range_hash {
        return Ok(false);
    }

    let message = signature_payload_canonical_bytes(signature_obj)?;
    let signature_bytes = base64url_decode(&signature_obj.signature)?;

    mldsa::verify(
        profile,
        &public_key,
        &message,
        PDF_GENERIC_SIGNATURE_CONTEXT,
        &signature_bytes,
    )
}

fn did_document_matches_manifest(
    signer_did_document: &DidDocument,
    manifest: &PdfGenericSignatureManifest,
) -> Result<bool> {
    if !did::verify_did_document(signer_did_document)? {
        return Ok(false);
    }
    if signer_did_document.status != "active" {
        return Ok(false);
    }
    if signer_did_document.id != manifest.signer_did {
        return Ok(false);
    }

    let (_, public_key) = signer_pdf_signing_key(signer_did_document, &manifest.signing_key_id)?;
    let Some(signature_obj) = &manifest.signature else {
        return Ok(false);
    };
    if signature_obj.key_id != manifest.signing_key_id {
        return Ok(false);
    }

    Ok(
        manifest.signing_key_fingerprint
            == signing_key_fingerprint(&signature_obj.alg, &public_key),
    )
}

fn signer_pdf_signing_key(
    did_document: &DidDocument,
    key_id: &str,
) -> Result<(MlDsaProfile, Vec<u8>)> {
    let key = did_document
        .keys
        .iter()
        .find(|key| key.id == key_id)
        .ok_or_else(|| SsiError::MissingDidKey(key_id.to_string()))?;
    if !key.usage.iter().any(|usage| usage == "assertionMethod") {
        return Err(SsiError::InvalidDidDocument(format!(
            "DID key {key_id} is not authorized for assertionMethod"
        )));
    }
    let profile = key.key_type.parse::<MlDsaProfile>()?;
    let public_key = multibase_base58btc_decode(&key.public_key_multibase)?;
    Ok((profile, public_key))
}

fn signing_key_fingerprint(alg: &str, public_key: &[u8]) -> String {
    let mut input =
        Vec::with_capacity(b"SSI_SIGNING_KEY_FINGERPRINT_V1".len() + alg.len() + public_key.len());
    input.extend_from_slice(b"SSI_SIGNING_KEY_FINGERPRINT_V1");
    input.extend_from_slice(alg.as_bytes());
    input.extend_from_slice(public_key);
    multibase_base58btc_encode(&sha3_256(&input))
}

fn manifest_canonical_bytes(manifest: &PdfGenericSignatureManifest) -> Result<Vec<u8>> {
    let value = serde_json::to_value(manifest)?;
    Ok(canonical_json::canonical_json_bytes(&value))
}

fn signature_payload_canonical_bytes(signature: &PdfGenericSignature) -> Result<Vec<u8>> {
    let value = json!({
        "type": PDF_GENERIC_SIGNATURE_PAYLOAD_TYPE,
        "alg": signature.alg,
        "key_id": signature.key_id,
        "byte_range_hash_alg": signature.byte_range_hash_alg,
        "byte_range_hash": signature.byte_range_hash,
        "manifest_hash_alg": signature.manifest_hash_alg,
        "manifest_hash": signature.manifest_hash,
    });
    Ok(canonical_json::canonical_json_bytes(&value))
}

fn signature_contents_canonical_bytes(signature: &PdfGenericSignature) -> Result<Vec<u8>> {
    let contents = PdfGenericSignatureContents {
        document_type: PDF_GENERIC_SIGNATURE_CONTENTS_TYPE.to_string(),
        alg: signature.alg.clone(),
        key_id: signature.key_id.clone(),
        byte_range_hash_alg: signature.byte_range_hash_alg.clone(),
        byte_range_hash: signature.byte_range_hash.clone(),
        manifest_hash_alg: signature.manifest_hash_alg.clone(),
        manifest_hash: signature.manifest_hash.clone(),
        signature: signature.signature.clone(),
    };
    let value = serde_json::to_value(contents)?;
    Ok(canonical_json::canonical_json_bytes(&value))
}

fn embed_signature_manifest_in_pdf(
    pdf_base_bytes: &[u8],
    manifest: &PdfGenericSignatureManifest,
    signing_profile: MlDsaProfile,
    signer_private_key: &[u8],
    visibility: &PdfSignatureVisibility,
) -> Result<Vec<u8>> {
    validate_pdf_base(pdf_base_bytes)?;

    let previous_size = previous_pdf_size(pdf_base_bytes)?;
    let previous_startxref = previous_startxref(pdf_base_bytes)?;
    let root_id = previous_root_id(pdf_base_bytes)?;
    let visible_layout = match visibility {
        PdfSignatureVisibility::Invisible => None,
        PdfSignatureVisibility::Visible(options) => {
            Some(visible_signature_layout(pdf_base_bytes, root_id, options)?)
        }
    };

    let embedded_file_id = previous_size;
    let filespec_id = previous_size + 1;
    let names_id = previous_size + 2;
    let signature_id = previous_size + 3;
    let signature_field_id = previous_size + 4;
    let appearance_id = visible_layout.as_ref().map(|_| previous_size + 5);
    let new_object_count = if appearance_id.is_some() { 6 } else { 5 };
    let updated_size = previous_size + new_object_count;
    let manifest_bytes = manifest_canonical_bytes(manifest)?;
    let mut update = Vec::new();
    let mut xref_entries = Vec::new();

    update.extend_from_slice(b"\n");
    update.extend_from_slice(PDF_GENERIC_SIGNATURE_MARKER);

    let catalog_offset = push_pdf_object(
        &mut update,
        pdf_base_bytes.len(),
        root_id,
        &catalog_object(pdf_base_bytes, root_id, names_id, signature_field_id)?,
    );
    xref_entries.push((root_id, catalog_offset));
    if let Some(layout) = &visible_layout {
        let page_offset = push_pdf_object(
            &mut update,
            pdf_base_bytes.len(),
            layout.page_id,
            &page_object_with_signature_annotation(
                pdf_base_bytes,
                layout.page_id,
                signature_field_id,
            )?,
        );
        xref_entries.push((layout.page_id, page_offset));
    }
    let embedded_offset = push_pdf_object(
        &mut update,
        pdf_base_bytes.len(),
        embedded_file_id,
        &embedded_file_object(&manifest_bytes),
    );
    xref_entries.push((embedded_file_id, embedded_offset));
    let filespec_offset = push_pdf_object(
        &mut update,
        pdf_base_bytes.len(),
        filespec_id,
        filespec_object(embedded_file_id).as_bytes(),
    );
    xref_entries.push((filespec_id, filespec_offset));
    let names_offset = push_pdf_object(
        &mut update,
        pdf_base_bytes.len(),
        names_id,
        names_object(filespec_id).as_bytes(),
    );
    xref_entries.push((names_id, names_offset));
    let signature_offset = push_pdf_object(
        &mut update,
        pdf_base_bytes.len(),
        signature_id,
        signature_dictionary_placeholder(manifest).as_bytes(),
    );
    xref_entries.push((signature_id, signature_offset));
    let signature_field_offset = push_pdf_object(
        &mut update,
        pdf_base_bytes.len(),
        signature_field_id,
        signature_field_object(signature_id, &visible_layout, appearance_id).as_bytes(),
    );
    xref_entries.push((signature_field_id, signature_field_offset));
    if let (Some(layout), Some(appearance_id)) = (&visible_layout, appearance_id) {
        let appearance_offset = push_pdf_object(
            &mut update,
            pdf_base_bytes.len(),
            appearance_id,
            &signature_appearance_object(layout),
        );
        xref_entries.push((appearance_id, appearance_offset));
    }
    let xref_offset = pdf_base_bytes.len() + update.len();

    write_xref_table(&mut update, &xref_entries);
    update.extend_from_slice(format!("trailer\n<< /Size {updated_size} /Root {root_id} 0 R /Prev {previous_startxref} >>\nstartxref\n{xref_offset}\n%%EOF\n").as_bytes());

    let mut output = Vec::with_capacity(pdf_base_bytes.len() + update.len());
    output.extend_from_slice(pdf_base_bytes);
    output.extend_from_slice(&update);

    let contents_range = pdf_signature_contents_range(&output)?;
    let byte_range = [
        0,
        contents_range.0,
        contents_range.1,
        output.len() - contents_range.1,
    ];
    write_byte_range(&mut output, byte_range)?;

    let byte_range_hash = base64url_encode(&byte_range_sha3_256(&output, byte_range)?);
    let manifest_hash = base64url_encode(&sha3_256(&manifest_bytes));
    let mut signature = PdfGenericSignature {
        alg: signing_profile.as_str().to_string(),
        key_id: manifest.signing_key_id.clone(),
        byte_range_hash_alg: "SHA3-256".to_string(),
        byte_range_hash,
        manifest_hash_alg: "SHA3-256".to_string(),
        manifest_hash,
        signature: String::new(),
    };
    let message = signature_payload_canonical_bytes(&signature)?;
    let mldsa_signature = mldsa::sign(
        signing_profile,
        signer_private_key,
        &message,
        PDF_GENERIC_SIGNATURE_CONTEXT,
    )?;
    signature.signature = base64url_encode(&mldsa_signature.signature);
    write_signature_contents(&mut output, contents_range, &signature)?;

    Ok(output)
}

// --- Reimplementações isoladas de Manipulação Segura de Incremental Update ---
fn validate_pdf_base(pdf_base_bytes: &[u8]) -> Result<()> {
    if !pdf_base_bytes.starts_with(b"%PDF-") {
        return Err(SsiError::InvalidPdf(
            "PDF base must start with a PDF header".to_string(),
        ));
    }
    if !has_pdf_eof(pdf_base_bytes) {
        return Err(SsiError::InvalidPdf(
            "PDF base must end with %%EOF".to_string(),
        ));
    }
    previous_pdf_size(pdf_base_bytes)?;
    previous_startxref(pdf_base_bytes)?;
    previous_root_id(pdf_base_bytes)?;
    Ok(())
}

fn previous_pdf_size(pdf_base_bytes: &[u8]) -> Result<usize> {
    let trailer = previous_trailer_dictionary(pdf_base_bytes)?;
    pdf_dictionary_usize_entry(trailer, b"/Size")
        .ok_or_else(|| SsiError::InvalidPdf("PDF trailer /Size is invalid".to_string()))
}

fn previous_startxref(pdf_base_bytes: &[u8]) -> Result<usize> {
    let startxref_offset = rfind_bytes(pdf_base_bytes, b"startxref")
        .ok_or_else(|| SsiError::InvalidPdf("PDF startxref not found".to_string()))?;
    parse_ascii_usize_after(pdf_base_bytes, startxref_offset + b"startxref".len())
        .ok_or_else(|| SsiError::InvalidPdf("PDF startxref is invalid".to_string()))
}

fn previous_root_id(pdf_base_bytes: &[u8]) -> Result<usize> {
    let trailer = previous_trailer_dictionary(pdf_base_bytes)?;
    pdf_dictionary_indirect_ref_entry(trailer, b"/Root")
        .ok_or_else(|| SsiError::InvalidPdf("PDF trailer /Root is invalid".to_string()))
}

fn previous_trailer_dictionary(pdf_base_bytes: &[u8]) -> Result<&[u8]> {
    let startxref = previous_startxref(pdf_base_bytes)?;
    if startxref >= pdf_base_bytes.len() {
        return Err(SsiError::InvalidPdf(
            "PDF startxref points outside the document".to_string(),
        ));
    }

    let offset = skip_pdf_whitespace_and_comments(pdf_base_bytes, startxref);
    if pdf_base_bytes[offset..].starts_with(b"xref") {
        let trailer_offset = offset
            + find_bytes(&pdf_base_bytes[offset..], b"trailer").ok_or_else(|| {
                SsiError::InvalidPdf("PDF xref trailer dictionary not found".to_string())
            })?;
        let dict_start =
            skip_pdf_whitespace_and_comments(pdf_base_bytes, trailer_offset + b"trailer".len());
        return pdf_dictionary_at(pdf_base_bytes, dict_start);
    }

    pdf_indirect_object_dictionary_at(pdf_base_bytes, offset)
}

fn pdf_indirect_object_dictionary_at(bytes: &[u8], offset: usize) -> Result<&[u8]> {
    let first_end = skip_pdf_token(bytes, offset);
    if !is_ascii_integer(&bytes[offset..first_end]) {
        return Err(SsiError::InvalidPdf(
            "PDF xref stream object number is invalid".to_string(),
        ));
    }
    let generation_start = skip_pdf_whitespace_and_comments(bytes, first_end);
    let generation_end = skip_pdf_token(bytes, generation_start);
    if !is_ascii_integer(&bytes[generation_start..generation_end]) {
        return Err(SsiError::InvalidPdf(
            "PDF xref stream generation is invalid".to_string(),
        ));
    }
    let obj_start = skip_pdf_whitespace_and_comments(bytes, generation_end);
    if !bytes[obj_start..].starts_with(b"obj") {
        return Err(SsiError::InvalidPdf(
            "PDF xref stream object header is invalid".to_string(),
        ));
    }
    let dict_start = skip_pdf_whitespace_and_comments(bytes, obj_start + b"obj".len());
    pdf_dictionary_at(bytes, dict_start)
}

fn pdf_dictionary_at(bytes: &[u8], offset: usize) -> Result<&[u8]> {
    if !bytes[offset..].starts_with(b"<<") {
        return Err(SsiError::InvalidPdf(
            "PDF dictionary start not found".to_string(),
        ));
    }
    let dict_end = skip_pdf_dictionary(bytes, offset)?;
    Ok(&bytes[offset..dict_end])
}

fn previous_object_body(pdf_base_bytes: &[u8], object_id: usize) -> Result<&[u8]> {
    let object_offset = rfind_indirect_object_marker(pdf_base_bytes, object_id)
        .ok_or_else(|| SsiError::InvalidPdf(format!("PDF object {object_id} 0 not found")))?;
    let marker = format!("{object_id} 0 obj");
    let body_start = object_offset + marker.len();
    let body_end = find_bytes(&pdf_base_bytes[body_start..], b"endobj")
        .map(|relative| body_start + relative)
        .ok_or_else(|| {
            SsiError::InvalidPdf(format!("PDF object {object_id} 0 terminator not found"))
        })?;
    Ok(&pdf_base_bytes[body_start..body_end])
}

fn pdf_object_body<'a>(pdf_base_bytes: &'a [u8], object_id: usize) -> Result<Cow<'a, [u8]>> {
    match previous_object_body(pdf_base_bytes, object_id) {
        Ok(body) => Ok(Cow::Borrowed(body)),
        Err(direct_error) => compressed_pdf_object_body(pdf_base_bytes, object_id)
            .map(Cow::Owned)
            .ok_or(direct_error),
    }
}

fn compressed_pdf_object_body(pdf_base_bytes: &[u8], object_id: usize) -> Option<Vec<u8>> {
    for object_stream_body in direct_object_stream_bodies(pdf_base_bytes) {
        let first = pdf_dictionary_usize_entry(object_stream_body, b"/First")?;
        let count = pdf_dictionary_usize_entry(object_stream_body, b"/N")?;
        let encoded_stream = pdf_stream_data(object_stream_body)?;
        let decoded_stream = if find_bytes(object_stream_body, b"/FlateDecode").is_some() {
            flate_decode_zlib(encoded_stream)?
        } else {
            encoded_stream.to_vec()
        };

        if let Some(body) = object_stream_object_body(&decoded_stream, first, count, object_id) {
            return Some(body);
        }
    }

    None
}

fn direct_object_stream_bodies(pdf_base_bytes: &[u8]) -> Vec<&[u8]> {
    let mut bodies = Vec::new();
    let mut offset = 0;

    while let Some(relative) = find_bytes(&pdf_base_bytes[offset..], b"obj") {
        let obj_offset = offset + relative;
        let Some(body_start) = indirect_object_body_start(pdf_base_bytes, obj_offset) else {
            offset = obj_offset + b"obj".len();
            continue;
        };
        let Some(body_end) = find_bytes(&pdf_base_bytes[body_start..], b"endobj")
            .map(|relative| body_start + relative)
        else {
            break;
        };

        let body = &pdf_base_bytes[body_start..body_end];
        if pdf_dictionary_name_entry(body, b"/Type").as_deref() == Some(b"/ObjStm") {
            bodies.push(body);
        }
        offset = body_end + b"endobj".len();
    }

    bodies
}

fn indirect_object_body_start(bytes: &[u8], obj_offset: usize) -> Option<usize> {
    if !bytes[obj_offset..].starts_with(b"obj") {
        return None;
    }
    if obj_offset > 0 && !is_pdf_whitespace(bytes[obj_offset - 1]) {
        return None;
    }
    let after_obj = obj_offset + b"obj".len();
    if after_obj < bytes.len()
        && !is_pdf_whitespace(bytes[after_obj])
        && !is_pdf_delimiter(bytes[after_obj])
    {
        return None;
    }

    let generation_end = previous_non_whitespace_offset(bytes, obj_offset)?;
    let generation_start = previous_token_start(bytes, generation_end)?;
    if !is_ascii_integer(&bytes[generation_start..generation_end]) {
        return None;
    }

    let object_id_end = previous_non_whitespace_offset(bytes, generation_start)?;
    let object_id_start = previous_token_start(bytes, object_id_end)?;
    if !is_ascii_integer(&bytes[object_id_start..object_id_end]) {
        return None;
    }

    Some(after_obj)
}

fn previous_non_whitespace_offset(bytes: &[u8], mut offset: usize) -> Option<usize> {
    while offset > 0 && is_pdf_whitespace(bytes[offset - 1]) {
        offset -= 1;
    }
    (offset > 0).then_some(offset)
}

fn previous_token_start(bytes: &[u8], mut offset: usize) -> Option<usize> {
    while offset > 0
        && !is_pdf_whitespace(bytes[offset - 1])
        && !is_pdf_delimiter(bytes[offset - 1])
    {
        offset -= 1;
    }
    Some(offset)
}

fn pdf_stream_data(object_body: &[u8]) -> Option<&[u8]> {
    let stream_marker = find_bytes(object_body, b"stream")?;
    let mut stream_start = stream_marker + b"stream".len();
    if object_body.get(stream_start) == Some(&b'\r')
        && object_body.get(stream_start + 1) == Some(&b'\n')
    {
        stream_start += 2;
    } else if matches!(object_body.get(stream_start), Some(b'\n' | b'\r')) {
        stream_start += 1;
    }

    if let Some(length) = pdf_dictionary_usize_entry(object_body, b"/Length") {
        let stream_end = stream_start.checked_add(length)?;
        if stream_end <= object_body.len() {
            return Some(&object_body[stream_start..stream_end]);
        }
    }

    let stream_end = find_bytes(&object_body[stream_start..], b"endstream")
        .map(|relative| stream_start + relative)?;
    let stream_end = if stream_end >= 2 && &object_body[stream_end - 2..stream_end] == b"\r\n" {
        stream_end - 2
    } else if stream_end >= 1 && matches!(object_body[stream_end - 1], b'\n' | b'\r') {
        stream_end - 1
    } else {
        stream_end
    };
    Some(&object_body[stream_start..stream_end])
}

fn object_stream_object_body(
    decoded_stream: &[u8],
    first: usize,
    count: usize,
    target_object_id: usize,
) -> Option<Vec<u8>> {
    if first >= decoded_stream.len() {
        return None;
    }

    let index = &decoded_stream[..first];
    let mut entries = Vec::new();
    let mut offset = 0;
    for _ in 0..count {
        offset = skip_pdf_whitespace_and_comments(index, offset);
        let object_id = parse_ascii_usize_after(index, offset)?;
        offset = skip_pdf_token(index, offset);
        offset = skip_pdf_whitespace_and_comments(index, offset);
        let object_offset = parse_ascii_usize_after(index, offset)?;
        offset = skip_pdf_token(index, offset);
        entries.push((object_id, object_offset));
    }

    entries.sort_by_key(|(_, object_offset)| *object_offset);
    let entry_index = entries
        .iter()
        .position(|(object_id, _)| *object_id == target_object_id)?;
    let object_start = first.checked_add(entries[entry_index].1)?;
    let object_end = entries
        .get(entry_index + 1)
        .and_then(|(_, next_offset)| first.checked_add(*next_offset))
        .unwrap_or(decoded_stream.len());
    if object_start > object_end || object_end > decoded_stream.len() {
        return None;
    }

    Some(trim_ascii(&decoded_stream[object_start..object_end]).to_vec())
}

#[cfg(not(target_arch = "wasm32"))]
fn flate_decode_zlib(input: &[u8]) -> Option<Vec<u8>> {
    const Z_OK: c_int = 0;
    const Z_BUF_ERROR: c_int = -5;

    let mut capacity = input.len().saturating_mul(4).max(1024);
    for _ in 0..10 {
        let mut output = vec![0_u8; capacity];
        let mut output_len = output.len() as c_ulong;
        let status = unsafe {
            uncompress(
                output.as_mut_ptr(),
                &mut output_len,
                input.as_ptr(),
                input.len() as c_ulong,
            )
        };

        if status == Z_OK {
            output.truncate(output_len as usize);
            return Some(output);
        }
        if status != Z_BUF_ERROR {
            return None;
        }
        capacity = capacity.saturating_mul(2);
    }

    None
}

#[cfg(target_arch = "wasm32")]
fn flate_decode_zlib(_input: &[u8]) -> Option<Vec<u8>> {
    None
}

#[cfg(not(target_arch = "wasm32"))]
#[link(name = "z")]
unsafe extern "C" {
    fn uncompress(
        dest: *mut u8,
        dest_len: *mut c_ulong,
        source: *const u8,
        source_len: c_ulong,
    ) -> c_int;
}

fn rfind_indirect_object_marker(pdf_base_bytes: &[u8], object_id: usize) -> Option<usize> {
    let marker = format!("{object_id} 0 obj");
    let marker = marker.as_bytes();
    let mut search_end = pdf_base_bytes.len();

    while let Some(offset) = rfind_bytes(&pdf_base_bytes[..search_end], marker) {
        let before_is_boundary = offset == 0 || is_pdf_whitespace(pdf_base_bytes[offset - 1]);
        let after = offset + marker.len();
        let after_is_boundary = after >= pdf_base_bytes.len()
            || is_pdf_whitespace(pdf_base_bytes[after])
            || is_pdf_delimiter(pdf_base_bytes[after]);

        if before_is_boundary && after_is_boundary {
            return Some(offset);
        }

        search_end = offset;
    }

    None
}

fn parse_ascii_usize_after(bytes: &[u8], mut offset: usize) -> Option<usize> {
    while offset < bytes.len() && bytes[offset].is_ascii_whitespace() {
        offset += 1;
    }
    let start = offset;
    while offset < bytes.len() && bytes[offset].is_ascii_digit() {
        offset += 1;
    }
    if offset == start {
        return None;
    }
    std::str::from_utf8(&bytes[start..offset])
        .ok()?
        .parse::<usize>()
        .ok()
}

fn has_pdf_eof(bytes: &[u8]) -> bool {
    let mut end = bytes.len();
    while end > 0 && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    end >= b"%%EOF".len() && &bytes[end - b"%%EOF".len()..end] == b"%%EOF"
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn rfind_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return Some(haystack.len());
    }
    haystack
        .windows(needle.len())
        .rposition(|window| window == needle)
}

fn extract_generic_signature_components(pdf_bytes: &[u8]) -> Result<ExtractedGenericPdfSignature> {
    let manifest = extract_embedded_generic_signature_manifest(pdf_bytes)?;
    let (byte_range, signature) = extract_pdf_signature_contents(pdf_bytes)?;

    Ok(ExtractedGenericPdfSignature {
        manifest,
        signature,
        byte_range,
    })
}

fn extract_pdf_signature_contents(pdf_bytes: &[u8]) -> Result<([usize; 4], PdfGenericSignature)> {
    let marker_offset = rfind_bytes(pdf_bytes, PDF_GENERIC_SIGNATURE_MARKER).ok_or_else(|| {
        SsiError::InvalidPdf("SSI-PQ generic signature marker not found".to_string())
    })?;
    let byte_range_offset = marker_offset
        + find_bytes(&pdf_bytes[marker_offset..], b"/ByteRange [").ok_or_else(|| {
            SsiError::InvalidPdf("PDF signature /ByteRange not found".to_string())
        })?;
    let byte_range_start = byte_range_offset + b"/ByteRange [".len();
    let byte_range_end = byte_range_start
        + find_bytes(&pdf_bytes[byte_range_start..], b"]").ok_or_else(|| {
            SsiError::InvalidPdf("PDF signature /ByteRange terminator not found".to_string())
        })?;
    let byte_range = parse_byte_range(&pdf_bytes[byte_range_start..byte_range_end])?;
    let contents_range = pdf_signature_contents_range(pdf_bytes)?;

    if byte_range[0] != 0
        || byte_range[1] != contents_range.0
        || byte_range[2] != contents_range.1
        || byte_range[2].saturating_add(byte_range[3]) > pdf_bytes.len()
    {
        return Err(SsiError::InvalidPdf(
            "PDF signature /ByteRange does not match /Contents".to_string(),
        ));
    }

    let contents_hex = &pdf_bytes[contents_range.0 + 1..contents_range.1 - 1];
    let mut contents_bytes = hex::decode(contents_hex).map_err(|error| {
        SsiError::InvalidPdf(format!("PDF signature /Contents hex is invalid: {error}"))
    })?;
    while contents_bytes.last() == Some(&0) {
        contents_bytes.pop();
    }
    if contents_bytes.is_empty() {
        return Err(SsiError::InvalidPdf(
            "PDF signature /Contents is empty".to_string(),
        ));
    }

    let contents: PdfGenericSignatureContents = serde_json::from_slice(&contents_bytes)?;
    if contents.document_type != PDF_GENERIC_SIGNATURE_CONTENTS_TYPE {
        return Err(SsiError::InvalidPdf(
            "PDF signature /Contents type is invalid".to_string(),
        ));
    }

    Ok((
        byte_range,
        PdfGenericSignature {
            alg: contents.alg,
            key_id: contents.key_id,
            byte_range_hash_alg: contents.byte_range_hash_alg,
            byte_range_hash: contents.byte_range_hash,
            manifest_hash_alg: contents.manifest_hash_alg,
            manifest_hash: contents.manifest_hash,
            signature: contents.signature,
        },
    ))
}

fn parse_byte_range(bytes: &[u8]) -> Result<[usize; 4]> {
    let value = std::str::from_utf8(bytes)
        .map_err(|_| SsiError::InvalidPdf("PDF signature /ByteRange is not ASCII".to_string()))?;
    let parts = value.split_ascii_whitespace().collect::<Vec<_>>();
    if parts.len() != 4 {
        return Err(SsiError::InvalidPdf(
            "PDF signature /ByteRange must have four numbers".to_string(),
        ));
    }
    let mut output = [0usize; 4];
    for (index, part) in parts.iter().enumerate() {
        output[index] = part.parse::<usize>().map_err(|_| {
            SsiError::InvalidPdf("PDF signature /ByteRange has invalid number".to_string())
        })?;
    }
    Ok(output)
}

fn pdf_signature_contents_range(pdf_bytes: &[u8]) -> Result<(usize, usize)> {
    let marker_offset = rfind_bytes(pdf_bytes, PDF_GENERIC_SIGNATURE_MARKER).ok_or_else(|| {
        SsiError::InvalidPdf("SSI-PQ generic signature marker not found".to_string())
    })?;
    let contents_keyword_offset = marker_offset
        + find_bytes(&pdf_bytes[marker_offset..], b"/Contents <")
            .ok_or_else(|| SsiError::InvalidPdf("PDF signature /Contents not found".to_string()))?;
    let contents_start = contents_keyword_offset + b"/Contents ".len();
    let contents_end = contents_start
        + 1
        + find_bytes(&pdf_bytes[contents_start + 1..], b">").ok_or_else(|| {
            SsiError::InvalidPdf("PDF signature /Contents terminator not found".to_string())
        })?
        + 1;

    if pdf_bytes.get(contents_start) != Some(&b'<')
        || pdf_bytes.get(contents_end - 1) != Some(&b'>')
    {
        return Err(SsiError::InvalidPdf(
            "PDF signature /Contents is malformed".to_string(),
        ));
    }

    Ok((contents_start, contents_end))
}

fn write_byte_range(pdf_bytes: &mut [u8], byte_range: [usize; 4]) -> Result<()> {
    let marker_offset = rfind_bytes(pdf_bytes, PDF_GENERIC_SIGNATURE_MARKER).ok_or_else(|| {
        SsiError::InvalidPdf("SSI-PQ generic signature marker not found".to_string())
    })?;
    let byte_range_offset = marker_offset
        + find_bytes(&pdf_bytes[marker_offset..], b"/ByteRange [").ok_or_else(|| {
            SsiError::InvalidPdf("PDF signature /ByteRange not found".to_string())
        })?;
    let byte_range_start = byte_range_offset + b"/ByteRange [".len();
    let byte_range_end = byte_range_start + PDF_BYTE_RANGE_INNER_LEN;
    let byte_range_value = format!(
        "{:0width$} {:0width$} {:0width$} {:0width$}",
        byte_range[0],
        byte_range[1],
        byte_range[2],
        byte_range[3],
        width = PDF_BYTE_RANGE_NUMBER_WIDTH,
    );
    if byte_range_value.len() != PDF_BYTE_RANGE_INNER_LEN || byte_range_end > pdf_bytes.len() {
        return Err(SsiError::InvalidPdf(
            "PDF signature /ByteRange placeholder is invalid".to_string(),
        ));
    }
    pdf_bytes[byte_range_start..byte_range_end].copy_from_slice(byte_range_value.as_bytes());
    Ok(())
}

fn write_signature_contents(
    pdf_bytes: &mut [u8],
    contents_range: (usize, usize),
    signature: &PdfGenericSignature,
) -> Result<()> {
    let contents_bytes = signature_contents_canonical_bytes(signature)?;
    if contents_bytes.len() > PDF_SIGNATURE_CONTENTS_RAW_CAPACITY {
        return Err(SsiError::InvalidPdf(
            "PDF signature /Contents placeholder is too small".to_string(),
        ));
    }

    let contents_hex_start = contents_range.0 + 1;
    let contents_hex_end = contents_range.1 - 1;
    if contents_hex_end - contents_hex_start != PDF_SIGNATURE_CONTENTS_HEX_LEN {
        return Err(SsiError::InvalidPdf(
            "PDF signature /Contents placeholder length is invalid".to_string(),
        ));
    }

    pdf_bytes[contents_hex_start..contents_hex_end].fill(b'0');
    let contents_hex = hex::encode(contents_bytes);
    pdf_bytes[contents_hex_start..contents_hex_start + contents_hex.len()]
        .copy_from_slice(contents_hex.as_bytes());
    Ok(())
}

fn byte_range_sha3_256(pdf_bytes: &[u8], byte_range: [usize; 4]) -> Result<[u8; 32]> {
    let first_end = byte_range[0]
        .checked_add(byte_range[1])
        .ok_or_else(|| SsiError::InvalidPdf("PDF signature /ByteRange overflows".to_string()))?;
    let second_end = byte_range[2]
        .checked_add(byte_range[3])
        .ok_or_else(|| SsiError::InvalidPdf("PDF signature /ByteRange overflows".to_string()))?;

    if byte_range[0] != 0 || first_end > byte_range[2] || second_end > pdf_bytes.len() {
        return Err(SsiError::InvalidPdf(
            "PDF signature /ByteRange is outside the document".to_string(),
        ));
    }

    let mut hasher = Sha3_256::new();
    hasher.update(&pdf_bytes[byte_range[0]..first_end]);
    hasher.update(&pdf_bytes[byte_range[2]..second_end]);
    Ok(hasher.finalize().into())
}

fn write_xref_table(update: &mut Vec<u8>, entries: &[(usize, usize)]) {
    let mut entries = entries.to_vec();
    entries.sort_by_key(|(object_id, _)| *object_id);
    update.extend_from_slice(b"xref\n");

    let mut index = 0;
    while index < entries.len() {
        let start_object_id = entries[index].0;
        let mut section_len = 1;
        while index + section_len < entries.len()
            && entries[index + section_len].0 == start_object_id + section_len
        {
            section_len += 1;
        }

        update.extend_from_slice(format!("{start_object_id} {section_len}\n").as_bytes());
        for (_, offset) in &entries[index..index + section_len] {
            update.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        index += section_len;
    }
}

fn pdf_dictionary_inner(bytes: &[u8]) -> Option<&[u8]> {
    let bytes = trim_ascii(bytes);
    if bytes.starts_with(b"<<") {
        let dict_end = skip_pdf_dictionary(bytes, 0).ok()?;
        return Some(&bytes[2..dict_end - 2]);
    }
    if bytes.starts_with(b"/") {
        return Some(bytes);
    }
    None
}

fn pdf_dictionary_usize_entry(dict: &[u8], key: &[u8]) -> Option<usize> {
    let inner = pdf_dictionary_inner(dict)?;
    let value = pdf_dictionary_value_for_key(inner, key).ok()??;
    parse_ascii_usize_after(value, 0)
}

fn pdf_dictionary_i32_entry(dict: &[u8], key: &[u8]) -> Option<i32> {
    let inner = pdf_dictionary_inner(dict)?;
    let value = pdf_dictionary_value_for_key(inner, key).ok()??;
    std::str::from_utf8(value).ok()?.trim().parse().ok()
}

fn pdf_dictionary_indirect_ref_entry(dict: &[u8], key: &[u8]) -> Option<usize> {
    let inner = pdf_dictionary_inner(dict)?;
    let value = pdf_dictionary_value_for_key(inner, key).ok()??;
    let object_id = parse_ascii_usize_after(value, 0)?;
    let generation_start = skip_pdf_token(value, 0);
    let generation_start = skip_pdf_whitespace_and_comments(value, generation_start);
    let generation_end = skip_pdf_token(value, generation_start);
    let ref_start = skip_pdf_whitespace_and_comments(value, generation_end);
    if value.get(ref_start) != Some(&b'R') {
        return None;
    }
    Some(object_id)
}

fn pdf_dictionary_value_for_key<'a>(
    inner: &'a [u8],
    target_key: &[u8],
) -> Result<Option<&'a [u8]>> {
    let mut offset = 0;

    while offset < inner.len() {
        offset = skip_pdf_whitespace_and_comments(inner, offset);
        if offset >= inner.len() {
            break;
        }
        if inner[offset] != b'/' {
            offset = skip_pdf_value(inner, offset)?;
            continue;
        }

        let key_start = offset;
        let key_end = skip_pdf_name(inner, key_start);
        let value_start = skip_pdf_whitespace_and_comments(inner, key_end);
        let value_end = skip_pdf_value(inner, value_start)?;

        if &inner[key_start..key_end] == target_key {
            return Ok(Some(trim_ascii(&inner[value_start..value_end])));
        }
        offset = value_end;
    }

    Ok(None)
}

fn remove_top_level_dictionary_entries(inner: &[u8], keys_to_remove: &[&[u8]]) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut offset = 0;

    while offset < inner.len() {
        offset = skip_pdf_whitespace_and_comments(inner, offset);
        if offset >= inner.len() {
            break;
        }

        if inner[offset] != b'/' {
            let value_end = skip_pdf_value(inner, offset)?;
            append_pdf_dictionary_fragment(&mut output, &inner[offset..value_end]);
            offset = value_end;
            continue;
        }

        let key_start = offset;
        let key_end = skip_pdf_name(inner, key_start);
        let value_start = skip_pdf_whitespace_and_comments(inner, key_end);
        let value_end = skip_pdf_value(inner, value_start)?;
        let key = &inner[key_start..key_end];

        if !keys_to_remove.iter().any(|candidate| *candidate == key) {
            append_pdf_dictionary_fragment(&mut output, &inner[key_start..value_end]);
        }
        offset = value_end;
    }

    Ok(output)
}

fn append_pdf_dictionary_fragment(output: &mut Vec<u8>, fragment: &[u8]) {
    let fragment = trim_ascii(fragment);
    if fragment.is_empty() {
        return;
    }
    if !output.is_empty() {
        output.push(b' ');
    }
    output.extend_from_slice(fragment);
}

fn skip_pdf_value(bytes: &[u8], offset: usize) -> Result<usize> {
    let offset = skip_pdf_whitespace_and_comments(bytes, offset);
    if offset >= bytes.len() {
        return Err(SsiError::InvalidPdf(
            "PDF dictionary value is missing".to_string(),
        ));
    }

    if bytes[offset..].starts_with(b"<<") {
        return skip_pdf_dictionary(bytes, offset);
    }
    match bytes[offset] {
        b'[' => skip_pdf_array(bytes, offset),
        b'(' => skip_pdf_literal_string(bytes, offset),
        b'<' => skip_pdf_hex_string(bytes, offset),
        b'/' => Ok(skip_pdf_name(bytes, offset)),
        _ => skip_pdf_atom_or_indirect_ref(bytes, offset),
    }
}

fn skip_pdf_dictionary(bytes: &[u8], mut offset: usize) -> Result<usize> {
    offset += 2;
    loop {
        offset = skip_pdf_whitespace_and_comments(bytes, offset);
        if offset >= bytes.len() {
            return Err(SsiError::InvalidPdf(
                "PDF dictionary terminator not found".to_string(),
            ));
        }
        if bytes[offset..].starts_with(b">>") {
            return Ok(offset + 2);
        }
        offset = skip_pdf_value(bytes, offset)?;
    }
}

fn skip_pdf_array(bytes: &[u8], mut offset: usize) -> Result<usize> {
    offset += 1;
    loop {
        offset = skip_pdf_whitespace_and_comments(bytes, offset);
        if offset >= bytes.len() {
            return Err(SsiError::InvalidPdf(
                "PDF array terminator not found".to_string(),
            ));
        }
        if bytes[offset] == b']' {
            return Ok(offset + 1);
        }
        offset = skip_pdf_value(bytes, offset)?;
    }
}

fn skip_pdf_literal_string(bytes: &[u8], mut offset: usize) -> Result<usize> {
    offset += 1;
    let mut depth = 1usize;
    let mut escaped = false;

    while offset < bytes.len() {
        let byte = bytes[offset];
        if escaped {
            escaped = false;
        } else if byte == b'\\' {
            escaped = true;
        } else if byte == b'(' {
            depth += 1;
        } else if byte == b')' {
            depth -= 1;
            if depth == 0 {
                return Ok(offset + 1);
            }
        }
        offset += 1;
    }

    Err(SsiError::InvalidPdf(
        "PDF literal string terminator not found".to_string(),
    ))
}

fn skip_pdf_hex_string(bytes: &[u8], offset: usize) -> Result<usize> {
    if bytes[offset..].starts_with(b"<<") {
        return skip_pdf_dictionary(bytes, offset);
    }
    let end = find_bytes(&bytes[offset + 1..], b">")
        .map(|relative| offset + 1 + relative + 1)
        .ok_or_else(|| SsiError::InvalidPdf("PDF hex string terminator not found".to_string()))?;
    Ok(end)
}

fn skip_pdf_atom_or_indirect_ref(bytes: &[u8], offset: usize) -> Result<usize> {
    let first_end = skip_pdf_token(bytes, offset);
    if first_end == offset {
        return Err(SsiError::InvalidPdf("PDF token is invalid".to_string()));
    }

    let second_start = skip_pdf_whitespace_and_comments(bytes, first_end);
    let second_end = skip_pdf_token(bytes, second_start);
    let third_start = skip_pdf_whitespace_and_comments(bytes, second_end);
    let third_end = skip_pdf_token(bytes, third_start);

    if is_ascii_integer(&bytes[offset..first_end])
        && second_end > second_start
        && is_ascii_integer(&bytes[second_start..second_end])
        && &bytes[third_start..third_end] == b"R"
    {
        Ok(third_end)
    } else {
        Ok(first_end)
    }
}

fn skip_pdf_name(bytes: &[u8], mut offset: usize) -> usize {
    offset += 1;
    while offset < bytes.len()
        && !is_pdf_whitespace(bytes[offset])
        && !is_pdf_delimiter(bytes[offset])
    {
        offset += 1;
    }
    offset
}

fn skip_pdf_token(bytes: &[u8], mut offset: usize) -> usize {
    offset = skip_pdf_whitespace_and_comments(bytes, offset);
    while offset < bytes.len()
        && !is_pdf_whitespace(bytes[offset])
        && !is_pdf_delimiter(bytes[offset])
    {
        offset += 1;
    }
    offset
}

fn skip_pdf_whitespace_and_comments(bytes: &[u8], mut offset: usize) -> usize {
    loop {
        while offset < bytes.len() && is_pdf_whitespace(bytes[offset]) {
            offset += 1;
        }
        if offset < bytes.len() && bytes[offset] == b'%' {
            while offset < bytes.len() && bytes[offset] != b'\n' && bytes[offset] != b'\r' {
                offset += 1;
            }
            continue;
        }
        return offset;
    }
}

fn trim_ascii(bytes: &[u8]) -> &[u8] {
    let mut start = 0;
    let mut end = bytes.len();
    while start < end && bytes[start].is_ascii_whitespace() {
        start += 1;
    }
    while end > start && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    &bytes[start..end]
}

fn is_ascii_integer(bytes: &[u8]) -> bool {
    !bytes.is_empty() && bytes.iter().all(u8::is_ascii_digit)
}

fn is_pdf_whitespace(byte: u8) -> bool {
    matches!(byte, 0x00 | b'\t' | b'\n' | 0x0c | b'\r' | b' ')
}

fn is_pdf_delimiter(byte: u8) -> bool {
    matches!(
        byte,
        b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%'
    )
}

fn visible_signature_layout(
    pdf_base_bytes: &[u8],
    root_id: usize,
    options: &PdfVisibleSignatureOptions,
) -> Result<VisibleSignatureLayout> {
    let first_page = first_page_info(pdf_base_bytes, root_id)?;
    let page_box = first_page.media_box;
    let page_width = (page_box.right - page_box.left).max(1.0);
    let page_height = (page_box.top - page_box.bottom).max(1.0);
    let page_rotation = first_page.rotation;
    let page_is_sideways = matches!(page_rotation, 90 | 270);
    let visual_page_width = if page_is_sideways {
        page_height
    } else {
        page_width
    };
    let visual_page_height = if page_is_sideways {
        page_width
    } else {
        page_height
    };
    let margin_x = visual_page_width.min(612.0) * 0.06;
    let margin_y = visual_page_height.min(792.0) * 0.035;
    let fallback_text = match options.placement {
        PdfVisibleSignaturePlacement::FirstPageFooter => PDF_VISIBLE_SIGNATURE_DEFAULT_TEXT,
        PdfVisibleSignaturePlacement::FirstPageRightMargin => {
            PDF_VISIBLE_SIGNATURE_RIGHT_MARGIN_TEXT
        }
    };
    let text = options.text.as_deref().unwrap_or(fallback_text);
    let text_lines = visible_signature_text_lines(text, fallback_text);

    let visual_rect = match options.placement {
        PdfVisibleSignaturePlacement::FirstPageFooter => {
            let padding_x = 7.0;
            let padding_y = 3.5;
            let line_height = PDF_VISIBLE_SIGNATURE_FOOTER_FONT_SIZE + 1.4;
            let text_width = text_lines
                .iter()
                .map(|line| {
                    visible_signature_text_width(line, PDF_VISIBLE_SIGNATURE_FOOTER_FONT_SIZE)
                })
                .fold(0.0_f64, f64::max);
            let width = (text_width + padding_x * 2.0)
                .max(138.0)
                .min((visual_page_width - margin_x * 2.0).max(1.0));
            let height = (text_lines.len() as f64 * line_height + padding_y * 2.0)
                .max(20.0)
                .min((visual_page_height - margin_y * 2.0).max(1.0));
            let bottom = margin_y;
            let right = visual_page_width - margin_x;
            let left = (right - width).max(margin_x);
            PdfRect {
                left,
                bottom,
                right,
                top: (bottom + height).min(visual_page_height - margin_y),
            }
        }
        PdfVisibleSignaturePlacement::FirstPageRightMargin => {
            let padding = 7.0;
            let text = text_lines.join(" ");
            let width = PDF_VISIBLE_SIGNATURE_RIGHT_MARGIN_FONT_SIZE + padding * 2.0;
            let height =
                (visible_signature_text_width(&text, PDF_VISIBLE_SIGNATURE_RIGHT_MARGIN_FONT_SIZE)
                    + padding * 2.0)
                    .max(120.0)
                    .min((visual_page_height - margin_y * 2.0).max(1.0));
            let right = visual_page_width - margin_x * 0.72;
            let top = (visual_page_height * 0.72).min(visual_page_height - margin_y);
            PdfRect {
                left: (right - width).max(margin_x),
                bottom: (top - height).max(margin_y),
                right,
                top,
            }
        }
    };
    let rect = visual_rect_to_page_rect(visual_rect, page_box, page_rotation);

    Ok(VisibleSignatureLayout {
        page_id: first_page.page_id,
        placement: options.placement,
        page_rotation,
        rect,
        width: (rect.right - rect.left).max(1.0),
        height: (rect.top - rect.bottom).max(1.0),
        visual_width: (visual_rect.right - visual_rect.left).max(1.0),
        visual_height: (visual_rect.top - visual_rect.bottom).max(1.0),
        text_lines,
    })
}

fn visual_rect_to_page_rect(rect: PdfRect, page_box: PdfRect, rotation: i32) -> PdfRect {
    match rotation {
        90 => PdfRect {
            left: page_box.right - rect.top,
            bottom: page_box.bottom + rect.left,
            right: page_box.right - rect.bottom,
            top: page_box.bottom + rect.right,
        },
        180 => PdfRect {
            left: page_box.right - rect.right,
            bottom: page_box.top - rect.top,
            right: page_box.right - rect.left,
            top: page_box.top - rect.bottom,
        },
        270 => PdfRect {
            left: page_box.left + rect.bottom,
            bottom: page_box.top - rect.right,
            right: page_box.left + rect.top,
            top: page_box.top - rect.left,
        },
        _ => PdfRect {
            left: page_box.left + rect.left,
            bottom: page_box.bottom + rect.bottom,
            right: page_box.left + rect.right,
            top: page_box.bottom + rect.top,
        },
    }
}

fn visible_signature_text_lines(text: &str, fallback_text: &str) -> Vec<String> {
    let mut lines = text
        .lines()
        .map(|line| normalize_visible_signature_text(line).trim().to_string())
        .filter(|line| !line.is_empty())
        .take(4)
        .collect::<Vec<_>>();
    if lines.is_empty() {
        lines = fallback_text
            .lines()
            .map(normalize_visible_signature_text)
            .collect();
    }
    lines
}

fn visible_signature_text_width(text: &str, font_size: f64) -> f64 {
    text.chars()
        .map(|char| match char {
            ' ' => 0.28,
            'i' | 'j' | 'l' | '!' | '\'' | '.' | ',' | ':' | ';' => 0.25,
            'f' | 'r' | 't' | '(' | ')' | '[' | ']' => 0.33,
            'm' | 'w' | 'M' | 'W' => 0.82,
            char if char.is_ascii_uppercase() => 0.67,
            char if char.is_ascii_digit() => 0.56,
            char if char.is_ascii_punctuation() => 0.36,
            _ => 0.54,
        })
        .sum::<f64>()
        * font_size
}

fn normalize_visible_signature_text(text: &str) -> String {
    text.chars()
        .map(|char| {
            if char.is_ascii() && !char.is_control() {
                char
            } else {
                '?'
            }
        })
        .collect()
}

#[derive(Debug, Clone)]
struct FirstPageInfo {
    page_id: usize,
    media_box: PdfRect,
    rotation: i32,
}

fn first_page_info(pdf_base_bytes: &[u8], root_id: usize) -> Result<FirstPageInfo> {
    let catalog = pdf_object_body(pdf_base_bytes, root_id)?;
    let catalog = catalog.as_ref();
    let pages_id = pdf_dictionary_indirect_ref_entry(catalog, b"/Pages")
        .ok_or_else(|| SsiError::InvalidPdf("PDF catalog /Pages is invalid".to_string()))?;
    match first_page_info_from_node(pdf_base_bytes, pages_id, None, 0, 0) {
        Ok(Some(page)) => Ok(page),
        Ok(None) => linearized_first_page_info(pdf_base_bytes)
            .ok_or_else(|| SsiError::InvalidPdf("PDF first page not found".to_string())),
        Err(error) => linearized_first_page_info(pdf_base_bytes).ok_or(error),
    }
}

fn first_page_info_from_node(
    pdf_base_bytes: &[u8],
    object_id: usize,
    inherited_media_box: Option<PdfRect>,
    inherited_rotation: i32,
    depth: usize,
) -> Result<Option<FirstPageInfo>> {
    if depth > 64 {
        return Err(SsiError::InvalidPdf(
            "PDF page tree is too deep".to_string(),
        ));
    }

    let object_body = pdf_object_body(pdf_base_bytes, object_id)?;
    let object_body = object_body.as_ref();
    let object_type = pdf_dictionary_name_entry(object_body, b"/Type");
    let media_box = pdf_dictionary_rect_entry(object_body, b"/CropBox")
        .or_else(|| pdf_dictionary_rect_entry(object_body, b"/MediaBox"))
        .or(inherited_media_box);
    let rotation = pdf_dictionary_i32_entry(object_body, b"/Rotate")
        .map(normalize_pdf_rotation)
        .unwrap_or(inherited_rotation);

    if object_type.as_deref() == Some(b"/Page") {
        return Ok(Some(FirstPageInfo {
            page_id: object_id,
            media_box: media_box.ok_or_else(|| {
                SsiError::InvalidPdf("PDF first page does not define MediaBox".to_string())
            })?,
            rotation,
        }));
    }

    let Some(kids) = pdf_dictionary_array_indirect_refs_entry(object_body, b"/Kids") else {
        return Ok(None);
    };
    for kid_id in kids {
        if let Some(page) =
            first_page_info_from_node(pdf_base_bytes, kid_id, media_box, rotation, depth + 1)?
        {
            return Ok(Some(page));
        }
    }

    Ok(None)
}

fn linearized_first_page_info(pdf_base_bytes: &[u8]) -> Option<FirstPageInfo> {
    let linearized_offset = find_bytes(pdf_base_bytes, b"/Linearized")?;
    let dict_start = rfind_bytes(&pdf_base_bytes[..linearized_offset], b"<<")?;
    let dict = pdf_dictionary_at(pdf_base_bytes, dict_start).ok()?;
    let page_id = pdf_dictionary_usize_entry(dict, b"/O")?;
    let page_body = pdf_object_body(pdf_base_bytes, page_id).ok()?;
    let page_body = page_body.as_ref();
    if pdf_dictionary_name_entry(page_body, b"/Type").as_deref() != Some(b"/Page") {
        return None;
    }
    let media_box = pdf_dictionary_rect_entry(page_body, b"/CropBox")
        .or_else(|| pdf_dictionary_rect_entry(page_body, b"/MediaBox"))?;
    let rotation = pdf_dictionary_i32_entry(page_body, b"/Rotate")
        .map(normalize_pdf_rotation)
        .unwrap_or(0);
    Some(FirstPageInfo {
        page_id,
        media_box,
        rotation,
    })
}

fn normalize_pdf_rotation(rotation: i32) -> i32 {
    rotation.rem_euclid(360) / 90 * 90
}

fn pdf_dictionary_name_entry(dict: &[u8], key: &[u8]) -> Option<Vec<u8>> {
    let inner = pdf_dictionary_inner(dict)?;
    let value = pdf_dictionary_value_for_key(inner, key).ok()??;
    if value.first() == Some(&b'/') {
        Some(value.to_vec())
    } else {
        None
    }
}

fn pdf_dictionary_array_indirect_refs_entry(dict: &[u8], key: &[u8]) -> Option<Vec<usize>> {
    let inner = pdf_dictionary_inner(dict)?;
    let value = pdf_dictionary_value_for_key(inner, key).ok()??;
    parse_pdf_indirect_ref_array(value).ok()
}

fn pdf_dictionary_rect_entry(dict: &[u8], key: &[u8]) -> Option<PdfRect> {
    let inner = pdf_dictionary_inner(dict)?;
    let value = pdf_dictionary_value_for_key(inner, key).ok()??;
    parse_pdf_rect(value).ok()
}

fn parse_pdf_indirect_ref_array(value: &[u8]) -> Result<Vec<usize>> {
    let value = trim_ascii(value);
    if value.first() != Some(&b'[') || value.last() != Some(&b']') {
        return Err(SsiError::InvalidPdf("PDF array is invalid".to_string()));
    }

    let mut refs = Vec::new();
    let mut offset = 1;
    while offset + 1 < value.len() {
        offset = skip_pdf_whitespace_and_comments(value, offset);
        if offset >= value.len() - 1 {
            break;
        }
        let first_end = skip_pdf_token(value, offset);
        let second_start = skip_pdf_whitespace_and_comments(value, first_end);
        let second_end = skip_pdf_token(value, second_start);
        let ref_start = skip_pdf_whitespace_and_comments(value, second_end);
        if is_ascii_integer(&value[offset..first_end])
            && is_ascii_integer(&value[second_start..second_end])
            && value.get(ref_start) == Some(&b'R')
        {
            let object_id = parse_ascii_usize_after(value, offset).ok_or_else(|| {
                SsiError::InvalidPdf("PDF indirect reference is invalid".to_string())
            })?;
            refs.push(object_id);
            offset = ref_start + 1;
        } else {
            offset = skip_pdf_value(value, offset)?;
        }
    }

    Ok(refs)
}

fn parse_pdf_rect(value: &[u8]) -> Result<PdfRect> {
    let value = trim_ascii(value);
    if value.first() != Some(&b'[') || value.last() != Some(&b']') {
        return Err(SsiError::InvalidPdf("PDF rectangle is invalid".to_string()));
    }
    let text = std::str::from_utf8(&value[1..value.len() - 1])
        .map_err(|_| SsiError::InvalidPdf("PDF rectangle is not ASCII".to_string()))?;
    let numbers = text
        .split_ascii_whitespace()
        .map(|part| {
            part.parse::<f64>()
                .map_err(|_| SsiError::InvalidPdf("PDF rectangle number is invalid".to_string()))
        })
        .collect::<Result<Vec<_>>>()?;
    if numbers.len() != 4 {
        return Err(SsiError::InvalidPdf(
            "PDF rectangle must have four numbers".to_string(),
        ));
    }
    Ok(PdfRect {
        left: numbers[0].min(numbers[2]),
        bottom: numbers[1].min(numbers[3]),
        right: numbers[0].max(numbers[2]),
        top: numbers[1].max(numbers[3]),
    })
}

fn catalog_object(
    pdf_base_bytes: &[u8],
    root_id: usize,
    names_id: usize,
    signature_field_id: usize,
) -> Result<Vec<u8>> {
    let catalog_body = pdf_object_body(pdf_base_bytes, root_id)?;
    let catalog_body = catalog_body.as_ref();
    let catalog_inner = pdf_dictionary_inner(catalog_body).ok_or_else(|| {
        SsiError::InvalidPdf("PDF catalog object is not a dictionary".to_string())
    })?;
    let preserved =
        remove_top_level_dictionary_entries(catalog_inner, &[&b"/Names"[..], &b"/AcroForm"[..]])?;
    let mut object = Vec::new();
    object.extend_from_slice(b"<<");
    object.extend_from_slice(trim_ascii(&preserved));
    if !trim_ascii(&preserved).is_empty() {
        object.extend_from_slice(b" ");
    }
    object.extend_from_slice(
        format!(
            "/Names << /EmbeddedFiles {names_id} 0 R >> /AcroForm << /SigFlags 3 /Fields [{signature_field_id} 0 R] >>"
        )
        .as_bytes(),
    );
    object.extend_from_slice(b" >>");
    Ok(object)
}

fn filespec_object(embedded_file_id: usize) -> String {
    let file_name = pdf_literal_string(PDF_GENERIC_MANIFEST_FILENAME);
    format!(
        "<< /Type /Filespec /F {file_name} /UF {file_name} /Desc (SSI-PQ generic PDF signature manifest) /AFRelationship /Data /EF << /F {embedded_file_id} 0 R /UF {embedded_file_id} 0 R >> >>"
    )
}

fn names_object(filespec_id: usize) -> String {
    let file_name = pdf_literal_string(PDF_GENERIC_MANIFEST_FILENAME);
    format!("<< /Names [{file_name} {filespec_id} 0 R] >>")
}

fn page_object_with_signature_annotation(
    pdf_base_bytes: &[u8],
    page_id: usize,
    signature_field_id: usize,
) -> Result<Vec<u8>> {
    let page_body = pdf_object_body(pdf_base_bytes, page_id)?;
    let page_body = page_body.as_ref();
    let page_inner = pdf_dictionary_inner(page_body)
        .ok_or_else(|| SsiError::InvalidPdf("PDF page object is not a dictionary".to_string()))?;
    let annots = merged_page_annots(pdf_base_bytes, page_inner, signature_field_id)?;
    let preserved = remove_top_level_dictionary_entries(page_inner, &[&b"/Annots"[..]])?;

    let mut object = Vec::new();
    object.extend_from_slice(b"<<");
    object.extend_from_slice(trim_ascii(&preserved));
    if !trim_ascii(&preserved).is_empty() {
        object.extend_from_slice(b" ");
    }
    object.extend_from_slice(b"/Annots ");
    object.extend_from_slice(&annots);
    object.extend_from_slice(b" >>");
    Ok(object)
}

fn merged_page_annots(
    pdf_base_bytes: &[u8],
    page_inner: &[u8],
    signature_field_id: usize,
) -> Result<Vec<u8>> {
    let signature_ref = format!("{signature_field_id} 0 R");
    let Some(existing) = pdf_dictionary_value_for_key(page_inner, b"/Annots")? else {
        return Ok(format!("[{signature_ref}]").into_bytes());
    };

    let existing = trim_ascii(existing);
    let array_bytes: Cow<'_, [u8]> = if existing.first() == Some(&b'[')
        && existing.last() == Some(&b']')
    {
        Cow::Borrowed(existing)
    } else {
        let object_id = parse_indirect_ref_object_id(existing).ok_or_else(|| {
            SsiError::InvalidPdf("PDF page /Annots is not an array or indirect array".to_string())
        })?;
        let object_body = pdf_object_body(pdf_base_bytes, object_id)?;
        let object_body = trim_ascii(object_body.as_ref());
        if object_body.first() != Some(&b'[') || object_body.last() != Some(&b']') {
            return Err(SsiError::InvalidPdf(
                "PDF page /Annots indirect object is not an array".to_string(),
            ));
        }
        Cow::Owned(object_body.to_vec())
    };

    let array_bytes = array_bytes.as_ref();

    let inner = trim_ascii(&array_bytes[1..array_bytes.len() - 1]);
    let mut output = Vec::new();
    output.extend_from_slice(b"[");
    output.extend_from_slice(inner);
    if !inner.is_empty() {
        output.extend_from_slice(b" ");
    }
    output.extend_from_slice(signature_ref.as_bytes());
    output.extend_from_slice(b"]");
    Ok(output)
}

fn parse_indirect_ref_object_id(value: &[u8]) -> Option<usize> {
    let value = trim_ascii(value);
    let object_id = parse_ascii_usize_after(value, 0)?;
    let first_end = skip_pdf_token(value, 0);
    let generation_start = skip_pdf_whitespace_and_comments(value, first_end);
    let generation_end = skip_pdf_token(value, generation_start);
    if !is_ascii_integer(&value[generation_start..generation_end]) {
        return None;
    }
    let ref_start = skip_pdf_whitespace_and_comments(value, generation_end);
    if value.get(ref_start) != Some(&b'R') {
        return None;
    }
    Some(object_id)
}

fn signature_dictionary_placeholder(manifest: &PdfGenericSignatureManifest) -> String {
    let byte_range_placeholder = format!(
        "{} {} {} {}",
        "0".repeat(PDF_BYTE_RANGE_NUMBER_WIDTH),
        "0".repeat(PDF_BYTE_RANGE_NUMBER_WIDTH),
        "0".repeat(PDF_BYTE_RANGE_NUMBER_WIDTH),
        "0".repeat(PDF_BYTE_RANGE_NUMBER_WIDTH),
    );
    let contents_placeholder = "0".repeat(PDF_SIGNATURE_CONTENTS_HEX_LEN);
    format!(
        "<< /Type /Sig /Filter /SSI-PQ /SubFilter /ssi-pq.mldsa.detached /ByteRange [{byte_range_placeholder}] /Contents <{contents_placeholder}> /Reason {} /M {} /Name {} >>",
        pdf_literal_string(PDF_GENERIC_SIGNATURE_REASON),
        pdf_literal_string(&manifest.created_at),
        pdf_literal_string(&manifest.signer_did),
    )
}

fn signature_field_object(
    signature_id: usize,
    visible_layout: &Option<VisibleSignatureLayout>,
    appearance_id: Option<usize>,
) -> String {
    match (visible_layout, appearance_id) {
        (Some(layout), Some(appearance_id)) => format!(
            "<< /Type /Annot /Subtype /Widget /FT /Sig /T {} /F 4 /Rect {} /P {} 0 R /V {signature_id} 0 R /AP << /N {appearance_id} 0 R >> >>",
            pdf_literal_string(PDF_GENERIC_SIGNATURE_FIELD_NAME),
            pdf_rect_array(layout.rect),
            layout.page_id,
        ),
        _ => format!(
            "<< /Type /Annot /Subtype /Widget /FT /Sig /T {} /F 132 /Rect [0 0 0 0] /V {signature_id} 0 R >>",
            pdf_literal_string(PDF_GENERIC_SIGNATURE_FIELD_NAME),
        ),
    }
}

fn signature_appearance_object(layout: &VisibleSignatureLayout) -> Vec<u8> {
    let stream = signature_appearance_stream(layout);
    let mut object = format!(
        "<< /Type /XObject /Subtype /Form /BBox [0 0 {} {}] /Resources << /Font << /Helv << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> /ExtGState << /GS1 << /Type /ExtGState /ca 0.62 /CA 0.62 >> >> >> /Length {} >>\nstream\n",
        pdf_number(layout.width),
        pdf_number(layout.height),
        stream.len(),
    )
    .into_bytes();
    object.extend_from_slice(stream.as_bytes());
    object.extend_from_slice(b"\nendstream");
    object
}

#[derive(Debug, Clone, Copy)]
enum VisualTextOrientation {
    Horizontal,
    VerticalDown,
}

fn visual_text_matrix(
    layout: &VisibleSignatureLayout,
    orientation: VisualTextOrientation,
    x: f64,
    y: f64,
) -> [f64; 6] {
    let ((x_axis_x, x_axis_y), (y_axis_x, y_axis_y)) = match orientation {
        VisualTextOrientation::Horizontal => ((1.0, 0.0), (0.0, 1.0)),
        VisualTextOrientation::VerticalDown => ((0.0, -1.0), (1.0, 0.0)),
    };
    let (a, b) = visual_delta_to_appearance_delta(layout, x_axis_x, x_axis_y);
    let (c, d) = visual_delta_to_appearance_delta(layout, y_axis_x, y_axis_y);
    let (e, f) = visual_point_to_appearance_point(layout, x, y);

    [a, b, c, d, e, f]
}

fn visual_point_to_appearance_point(layout: &VisibleSignatureLayout, x: f64, y: f64) -> (f64, f64) {
    match layout.page_rotation {
        90 => (layout.visual_height - y, x),
        180 => (layout.visual_width - x, layout.visual_height - y),
        270 => (y, layout.visual_width - x),
        _ => (x, y),
    }
}

fn visual_delta_to_appearance_delta(
    layout: &VisibleSignatureLayout,
    dx: f64,
    dy: f64,
) -> (f64, f64) {
    match layout.page_rotation {
        90 => (-dy, dx),
        180 => (-dx, -dy),
        270 => (dy, -dx),
        _ => (dx, dy),
    }
}

fn signature_appearance_stream(layout: &VisibleSignatureLayout) -> String {
    if layout.placement == PdfVisibleSignaturePlacement::FirstPageRightMargin {
        return right_margin_signature_appearance_stream(layout);
    }

    let mut stream = String::new();
    let font_size = PDF_VISIBLE_SIGNATURE_FOOTER_FONT_SIZE;
    let line_height = font_size + 1.4;
    let padding = 3.5;
    let start_y = (layout.visual_height - padding - font_size).max(font_size);

    stream.push_str("q\n/GS1 gs\n");
    stream.push_str("0.94 0.98 1 rg\n");
    stream.push_str(&format!(
        "0 0 {} {} re f\n",
        pdf_number(layout.width),
        pdf_number(layout.height)
    ));
    stream.push_str("0.10 0.28 0.45 RG\n1.1 w\n");
    stream.push_str(&format!(
        "0.8 0.8 {} {} re S\n",
        pdf_number((layout.width - 1.6).max(1.0)),
        pdf_number((layout.height - 1.6).max(1.0))
    ));
    stream.push_str("BT\n/Helv ");
    stream.push_str(&pdf_number(font_size));
    stream.push_str(" Tf\n0.04 0.13 0.21 rg\n");

    for (index, line) in layout.text_lines.iter().enumerate() {
        let y = start_y - (index as f64 * line_height);
        if y < padding {
            break;
        }
        let matrix = visual_text_matrix(layout, VisualTextOrientation::Horizontal, padding, y);
        stream.push_str(&format!(
            "{} {} {} {} {} {} Tm\n{} Tj\n",
            pdf_number(matrix[0]),
            pdf_number(matrix[1]),
            pdf_number(matrix[2]),
            pdf_number(matrix[3]),
            pdf_number(matrix[4]),
            pdf_number(matrix[5]),
            pdf_literal_string(line),
        ));
    }

    stream.push_str("ET\nQ");
    stream
}

fn right_margin_signature_appearance_stream(layout: &VisibleSignatureLayout) -> String {
    let text = layout.text_lines.join(" ");
    let font_size = PDF_VISIBLE_SIGNATURE_RIGHT_MARGIN_FONT_SIZE;
    let padding = 7.0;
    let baseline_x = ((layout.visual_width - font_size) / 2.0).max(3.0);
    let baseline_y = (layout.visual_height - padding).max(font_size + padding);
    let matrix = visual_text_matrix(
        layout,
        VisualTextOrientation::VerticalDown,
        baseline_x,
        baseline_y,
    );

    let mut stream = String::new();
    stream.push_str("q\n/GS1 gs\n");
    stream.push_str("0.94 0.98 1 rg\n");
    stream.push_str(&format!(
        "0 0 {} {} re f\n",
        pdf_number(layout.width),
        pdf_number(layout.height)
    ));
    stream.push_str("0.10 0.28 0.45 RG\n1.1 w\n");
    stream.push_str(&format!(
        "0.8 0.8 {} {} re S\n",
        pdf_number((layout.width - 1.6).max(1.0)),
        pdf_number((layout.height - 1.6).max(1.0))
    ));
    stream.push_str("BT\n/Helv ");
    stream.push_str(&pdf_number(font_size));
    stream.push_str(" Tf\n0.04 0.13 0.21 rg\n");
    stream.push_str(&format!(
        "{} {} {} {} {} {} Tm\n{} Tj\n",
        pdf_number(matrix[0]),
        pdf_number(matrix[1]),
        pdf_number(matrix[2]),
        pdf_number(matrix[3]),
        pdf_number(matrix[4]),
        pdf_number(matrix[5]),
        pdf_literal_string(&text),
    ));
    stream.push_str("ET\nQ");
    stream
}

fn pdf_rect_array(rect: PdfRect) -> String {
    format!(
        "[{} {} {} {}]",
        pdf_number(rect.left),
        pdf_number(rect.bottom),
        pdf_number(rect.right),
        pdf_number(rect.top)
    )
}

fn pdf_number(value: f64) -> String {
    let mut value = if value.abs() < 0.0001 {
        "0".to_string()
    } else {
        format!("{value:.2}")
    };
    while value.contains('.') && value.ends_with('0') {
        value.pop();
    }
    if value.ends_with('.') {
        value.pop();
    }
    value
}

fn embedded_file_object(manifest_bytes: &[u8]) -> Vec<u8> {
    let mut object = format!("<< /Type /EmbeddedFile /Subtype /application#2Fjson /Length {} /Params << /Size {} >> >>\nstream\n", manifest_bytes.len(), manifest_bytes.len()).into_bytes();
    object.extend_from_slice(manifest_bytes);
    object.extend_from_slice(b"\nendstream");
    object
}

fn push_pdf_object(update: &mut Vec<u8>, base_len: usize, object_id: usize, body: &[u8]) -> usize {
    let offset = base_len + update.len();
    update.extend_from_slice(format!("{object_id} 0 obj\n").as_bytes());
    update.extend_from_slice(body);
    update.extend_from_slice(b"\nendobj\n");
    offset
}

fn pdf_literal_string(value: &str) -> String {
    let mut output = String::from("(");
    for char in value.chars() {
        match char {
            '(' | ')' | '\\' => {
                output.push('\\');
                output.push(char);
            }
            char if char.is_ascii() && !char.is_control() => output.push(char),
            _ => output.push('?'),
        }
    }
    output.push(')');
    output
}

impl GenericPdfVerificationResult {
    fn invalid(status: &str, manifest: Option<PdfGenericSignatureManifest>) -> Self {
        Self {
            valid: false,
            status: status.to_string(),
            signer_did: manifest.as_ref().map(|m| m.signer_did.clone()),
            pdf_base_hash_valid: false,
            signature_valid: false,
            manifest_is_final_revision: false,
            did_key_match: false,
            errors: vec![status.to_string()],
            manifest,
        }
    }

    fn from_manifest(manifest: PdfGenericSignatureManifest) -> Self {
        Self {
            valid: false,
            status: "PENDING".to_string(),
            signer_did: Some(manifest.signer_did.clone()),
            pdf_base_hash_valid: false,
            signature_valid: false,
            manifest_is_final_revision: false,
            did_key_match: false,
            errors: Vec::new(),
            manifest: Some(manifest),
        }
    }

    fn push_error(&mut self, status: &str) {
        if !self.errors.iter().any(|error| error == status) {
            self.errors.push(status.to_string());
        }
    }

    fn finalize(&mut self) {
        self.valid = self.errors.is_empty()
            && self.pdf_base_hash_valid
            && self.signature_valid
            && self.manifest_is_final_revision
            && self.did_key_match;
        self.status = if self.valid {
            "VALID".to_string()
        } else {
            self.errors
                .first()
                .cloned()
                .unwrap_or_else(|| "INVALID".to_string())
        };
    }
}
