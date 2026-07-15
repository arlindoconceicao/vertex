use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use unicode_normalization::UnicodeNormalization;

use crate::{
    Result, SsiError, canonical_json,
    credential::{self, SignedCredential},
    crypto::mldsa,
    did::{self, DidDocument},
    encoding::{
        base64url_decode, base64url_encode, multibase_base58btc_decode, multibase_base58btc_encode,
    },
    hash::sha3_256,
    profiles::MlDsaProfile,
};

const PAGE_WIDTH: f32 = 595.0;
const PAGE_HEIGHT: f32 = 842.0;
const MARGIN_LEFT: f32 = 56.0;
const MARGIN_RIGHT: f32 = 56.0;
const PAGE_TOP: f32 = 780.0;
const PAGE_BOTTOM: f32 = 56.0;
const PDF_MANIFEST_MARKER: &[u8] = b"%SSI-PQ-MANIFEST-V1\n";
const PDF_MANIFEST_FILENAME: &str = "ssi-pq-credential-manifest.json";
const PDF_BINDING_TYPE: &str = "ssi_pdf_binding_v1";
const PDF_MANIFEST_TYPE: &str = "ssi_pdf_signature_v1";
const PDF_BINDING_SCOPE: &str = "pdf_base_bytes_plus_signed_credential_hash";
const PDF_CREDENTIAL_HASH_SCOPE: &str = "signed_credential_canonical_json";
const PDF_EMBEDDING_POLICY: &str = "manifest_must_be_final_incremental_update";
const PDF_RENDER_CREDENTIAL_HASH_MARKER: &[u8] = b"%SSI-PQ-RENDER-CREDENTIAL-SHA3-256 ";

/// Separador de domínio usado para assinar o vínculo entre PDF e credencial.
pub const PDF_DOCUMENT_BINDING_CONTEXT: &[u8] = b"SSI_PDF_DOCUMENT_BINDING_V1";

#[derive(Debug, Clone, Copy)]
struct PdfColor {
    r: f32,
    g: f32,
    b: f32,
}

#[derive(Debug, Clone)]
struct PositionedText {
    text: String,
    font_size: f32,
    x: f32,
    y: f32,
    bold: bool,
    font: PdfTextFont,
    color: PdfColor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PdfTextFont {
    Helvetica,
    Courier,
}

#[derive(Debug, Clone)]
struct PdfRect {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    fill: Option<PdfColor>,
    stroke: Option<PdfColor>,
    stroke_width: f32,
}

#[derive(Debug, Clone)]
struct PdfStroke {
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    color: PdfColor,
    width: f32,
}

#[derive(Debug, Clone)]
enum PdfElement {
    Text(PositionedText),
    Rect(PdfRect),
    Line(PdfStroke),
}

#[derive(Debug, Clone)]
struct AttributeDisplay {
    label: String,
    value: String,
    divider_key: String,
}

/// Opções usadas para assinar o vínculo entre um PDF-base e uma credencial.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PdfBindingOptions {
    /// Timestamp de criação do vínculo PDF↔credencial.
    pub created_at: String,
    /// CID opcional do DID Document público quando ele estiver publicado.
    pub did_doc_cid: Option<String>,
}

/// Opções puramente visuais para renderizar uma credencial como PDF.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PdfRenderOptions {
    /// Labels amigáveis por caminho, sem alterar Schema, credencial ou manifesto.
    pub labels: BTreeMap<String, String>,
}

/// Dados assinados que vinculam o PDF-base à credencial assinada.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfDocumentBinding {
    /// Tipo/versionamento lógico do vínculo.
    #[serde(rename = "type")]
    pub document_type: String,
    /// Algoritmo usado para calcular o hash do PDF-base.
    pub pdf_hash_alg: String,
    /// Hash SHA3-256 do PDF-base em base64url sem padding.
    pub pdf_base_hash: String,
    /// Tamanho exato do PDF-base em bytes.
    pub pdf_base_length: u64,
    /// Algoritmo usado para calcular o hash da credencial.
    pub credential_hash_alg: String,
    /// Hash SHA3-256 da credencial assinada canônica em base64url sem padding.
    pub credential_hash: String,
    /// Escopo do hash da credencial usado nesta versão.
    pub credential_hash_scope: String,
    /// Escopo lógico da assinatura do vínculo.
    pub binding_scope: String,
    /// Política exigida para inserção do manifesto no PDF final.
    pub embedding_policy: String,
    /// DID do emissor que assinou a credencial e o vínculo.
    pub issuer_did: String,
    /// CID opcional do DID Document público.
    pub did_doc_cid: Option<String>,
    /// Identificador local da chave de assinatura.
    pub signing_key_id: String,
    /// Chave pública usada pelo assinante para verificar a assinatura.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signing_public_key_multibase: Option<String>,
    /// Fingerprint da chave pública usada para assinar o vínculo.
    pub signing_key_fingerprint: String,
    /// Timestamp de criação do vínculo.
    pub created_at: String,
}

/// Assinatura ML-DSA do vínculo PDF↔credencial.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfDocumentBindingSignature {
    /// Algoritmo ML-DSA usado.
    pub alg: String,
    /// Identificador local da chave no DID Document.
    pub key_id: String,
    /// Assinatura em base64url sem padding.
    pub signature: String,
}

/// Manifesto SSI embutido no PDF final como arquivo JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PdfCredentialManifest {
    /// Tipo/versionamento lógico do manifesto.
    #[serde(rename = "type")]
    pub document_type: String,
    /// Credencial assinada embutida no PDF.
    pub signed_credential: SignedCredential,
    /// Vínculo assinado entre PDF-base e credencial.
    pub document_binding: PdfDocumentBinding,
    /// Assinatura ML-DSA do vínculo.
    pub document_binding_signature: PdfDocumentBindingSignature,
}

/// Resultado detalhado da verificação criptográfica de um PDF-credencial.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignedPdfVerificationResult {
    /// Indica se todas as verificações obrigatórias foram aprovadas.
    pub valid: bool,
    /// Estado resumido da verificação.
    pub status: String,
    /// DID do emissor extraído do manifesto, quando disponível.
    pub issuer_did: Option<String>,
    /// Identificador da credencial extraído do manifesto, quando disponível.
    pub credential_id: Option<String>,
    /// Indica se o hash do PDF-base confere com o vínculo assinado.
    pub pdf_base_hash_valid: bool,
    /// Indica se a assinatura da credencial é válida.
    pub credential_signature_valid: bool,
    /// Indica se a assinatura do vínculo PDF↔credencial é válida.
    pub document_binding_signature_valid: bool,
    /// Indica se o manifesto é a atualização incremental final do PDF.
    pub manifest_is_final_revision: bool,
    /// Indica se o DID Document e a chave pública correspondem ao manifesto.
    pub did_key_match: bool,
    /// Códigos de erro acumulados durante a verificação.
    pub errors: Vec<String>,
    /// Manifesto extraído do PDF, quando a extração foi possível.
    pub manifest: Option<PdfCredentialManifest>,
    /// Credencial assinada extraída do manifesto, quando disponível.
    pub signed_credential: Option<SignedCredential>,
}

/// Gera um PDF visual simples a partir de uma credencial assinada.
///
/// Esta primeira versão foca em legibilidade para pessoas leigas: mostra dados
/// da credencial, emissor, assinatura e atributos revelados, sem expor a
/// estrutura criptográfica completa como conteúdo principal.
pub fn signed_credential_to_pdf(signed_credential: &SignedCredential) -> Result<Vec<u8>> {
    signed_credential_to_pdf_with_options(signed_credential, PdfRenderOptions::default())
}

/// Gera um PDF visual com opções de apresentação, sem alterar a credencial.
pub fn signed_credential_to_pdf_with_options(
    signed_credential: &SignedCredential,
    options: PdfRenderOptions,
) -> Result<Vec<u8>> {
    let pages = credential_pdf_pages(signed_credential, &options);
    let render_credential_hash = base64url_encode(&signed_credential_hash(signed_credential)?);

    Ok(write_pdf(&pages, Some(&render_credential_hash)))
}

/// Embute uma credencial assinada em um PDF-base e assina o vínculo entre ambos.
///
/// O manifesto é anexado por atualização incremental como arquivo JSON embutido.
/// A assinatura `document_binding_signature` cobre o hash e o tamanho do
/// PDF-base, além do hash canônico da credencial assinada embutida.
pub fn embed_signed_credential_in_pdf(
    pdf_base_bytes: &[u8],
    signed_credential: &SignedCredential,
    issuer_did_document: &DidDocument,
    issuer_private_key: &[u8],
    options: PdfBindingOptions,
) -> Result<Vec<u8>> {
    if !credential::verify_signed_credential(signed_credential, issuer_did_document)? {
        return Err(SsiError::InvalidCredential(
            "signed credential is not valid for issuer DID".to_string(),
        ));
    }

    let (signing_profile, signing_public_key) = issuer_pdf_signing_key(
        issuer_did_document,
        &signed_credential.credential_signature.key_id,
    )?;
    let document_binding = create_document_binding(
        pdf_base_bytes,
        signed_credential,
        &signing_public_key,
        options,
    )?;
    let binding_message = document_binding_message(&document_binding)?;
    let signature = mldsa::sign(
        signing_profile,
        issuer_private_key,
        &binding_message,
        PDF_DOCUMENT_BINDING_CONTEXT,
    )?;
    let manifest = PdfCredentialManifest {
        document_type: PDF_MANIFEST_TYPE.to_string(),
        signed_credential: signed_credential.clone(),
        document_binding,
        document_binding_signature: PdfDocumentBindingSignature {
            alg: signing_profile.as_str().to_string(),
            key_id: signed_credential.credential_signature.key_id.clone(),
            signature: base64url_encode(&signature.signature),
        },
    };

    embed_manifest_in_pdf(pdf_base_bytes, &manifest)
}

/// Extrai o manifesto SSI embutido em um PDF-credencial.
///
/// Esta função apenas lê o JSON embutido. Para validar assinatura, vínculo com
/// o PDF-base e política de revisão final, use `verify_signed_credential_pdf`.
pub fn extract_pdf_manifest(pdf_bytes: &[u8]) -> Result<PdfCredentialManifest> {
    let marker_offset = rfind_bytes(pdf_bytes, PDF_MANIFEST_MARKER)
        .ok_or_else(|| SsiError::InvalidPdf("SSI-PQ manifest marker not found".to_string()))?;
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

/// Verifica integralmente um PDF-credencial e retorna diagnóstico estruturado.
///
/// A verificação cobre a assinatura da credencial, a assinatura do vínculo
/// PDF↔credencial, o hash do PDF-base e a exigência de que o manifesto seja a
/// última atualização incremental produzida pelo core.
pub fn verify_signed_credential_pdf(
    pdf_bytes: &[u8],
    issuer_did_document: &DidDocument,
) -> Result<SignedPdfVerificationResult> {
    let manifest = match extract_pdf_manifest(pdf_bytes) {
        Ok(manifest) => manifest,
        Err(_) => {
            return Ok(SignedPdfVerificationResult::invalid(
                "MALFORMED_MANIFEST",
                None,
            ));
        }
    };

    let mut result = SignedPdfVerificationResult::from_manifest(manifest.clone());
    let signed_credential = &manifest.signed_credential;
    let binding = &manifest.document_binding;

    if manifest.document_type != PDF_MANIFEST_TYPE
        || binding.document_type != PDF_BINDING_TYPE
        || binding.binding_scope != PDF_BINDING_SCOPE
        || binding.credential_hash_scope != PDF_CREDENTIAL_HASH_SCOPE
        || binding.embedding_policy != PDF_EMBEDDING_POLICY
    {
        result.push_error("MALFORMED_MANIFEST");
    }

    result.did_key_match =
        did_document_matches_manifest(issuer_did_document, &manifest).unwrap_or(false);
    if !result.did_key_match {
        result.push_error("DID_KEY_MISMATCH");
    }

    result.credential_signature_valid =
        credential::verify_signed_credential(signed_credential, issuer_did_document)
            .unwrap_or(false);
    if !result.credential_signature_valid {
        result.push_error("INVALID_CREDENTIAL_SIGNATURE");
    }

    let actual_credential_hash = match signed_credential_hash(signed_credential) {
        Ok(hash) => Some(base64url_encode(&hash)),
        Err(_) => {
            result.push_error("CREDENTIAL_HASH_MISMATCH");
            None
        }
    };
    if let Some(actual_credential_hash) = &actual_credential_hash {
        if binding.credential_hash_alg != "SHA3-256"
            || binding.credential_hash != *actual_credential_hash
        {
            result.push_error("CREDENTIAL_HASH_MISMATCH");
        }
    }

    let pdf_base_length = usize::try_from(binding.pdf_base_length).ok();
    let pdf_base_bytes = pdf_base_length.and_then(|length| pdf_bytes.get(..length));
    if let Some(pdf_base_bytes) = pdf_base_bytes {
        let actual_pdf_hash = base64url_encode(&sha3_256(pdf_base_bytes));
        result.pdf_base_hash_valid =
            binding.pdf_hash_alg == "SHA3-256" && binding.pdf_base_hash == actual_pdf_hash;
        if !result.pdf_base_hash_valid {
            result.push_error("PDF_BASE_HASH_MISMATCH");
        }

        if let (Some(render_credential_hash), Some(actual_credential_hash)) = (
            pdf_render_credential_hash(pdf_base_bytes),
            actual_credential_hash.as_ref(),
        ) {
            if render_credential_hash != *actual_credential_hash {
                result.push_error("PDF_CREDENTIAL_RENDER_MISMATCH");
            }
        }
    } else {
        result.push_error("PDF_BASE_LENGTH_INVALID");
    }

    result.document_binding_signature_valid =
        verify_document_binding_signature(&manifest, issuer_did_document).unwrap_or(false);
    if !result.document_binding_signature_valid {
        result.push_error("INVALID_DOCUMENT_BINDING_SIGNATURE");
    }

    if let Some(pdf_base_bytes) = pdf_base_bytes {
        result.manifest_is_final_revision = match embed_manifest_in_pdf(pdf_base_bytes, &manifest) {
            Ok(expected) => expected == pdf_bytes,
            Err(_) => false,
        };
        if !result.manifest_is_final_revision {
            result.push_error("MANIFEST_NOT_FINAL_REVISION");
        }
    }

    result.finalize();
    Ok(result)
}

/// Converte um manifesto PDF SSI-PQ tipado para `serde_json::Value`.
pub fn pdf_manifest_to_json(manifest: &PdfCredentialManifest) -> Result<Value> {
    Ok(serde_json::to_value(manifest)?)
}

/// Converte um resultado de verificação PDF SSI-PQ para `serde_json::Value`.
pub fn pdf_verification_result_to_json(result: &SignedPdfVerificationResult) -> Result<Value> {
    Ok(serde_json::to_value(result)?)
}

fn credential_pdf_pages(
    signed_credential: &SignedCredential,
    options: &PdfRenderOptions,
) -> Vec<Vec<PdfElement>> {
    let mut renderer = PdfRenderer::new();

    renderer.add_header();
    renderer.add_summary(signed_credential);
    renderer.add_visible_attributes(signed_credential, options);
    renderer.add_signature(signed_credential);
    renderer.add_integrity(signed_credential);

    renderer.finish()
}

struct PdfRenderer {
    pages: Vec<Vec<PdfElement>>,
    current_page: Vec<PdfElement>,
    y: f32,
    page_index: usize,
}

impl PdfRenderer {
    fn new() -> Self {
        Self {
            pages: Vec::new(),
            current_page: Vec::new(),
            y: PAGE_TOP,
            page_index: 0,
        }
    }

    fn finish(mut self) -> Vec<Vec<PdfElement>> {
        if !self.current_page.is_empty() {
            self.pages.push(self.current_page);
        }
        if self.pages.is_empty() {
            self.pages.push(Vec::new());
        }
        self.pages
    }

    fn ensure_space(&mut self, height: f32) {
        if self.y - height >= PAGE_BOTTOM || self.current_page.is_empty() {
            return;
        }

        self.pages.push(std::mem::take(&mut self.current_page));
        self.page_index += 1;
        self.y = PAGE_TOP;
        self.add_continuation_header();
    }

    fn add_header(&mut self) {
        let title = PdfColor::rgb(0.04, 0.16, 0.33);
        let muted = PdfColor::rgb(0.25, 0.34, 0.47);
        let teal = PdfColor::rgb(0.02, 0.48, 0.54);
        let green = PdfColor::rgb(0.02, 0.55, 0.25);

        self.add_rect(
            MARGIN_LEFT,
            self.y - 72.0,
            54.0,
            54.0,
            Some(PdfColor::rgb(0.90, 0.97, 0.98)),
            Some(teal),
            1.2,
        );
        self.add_text("SSI", MARGIN_LEFT + 15.0, self.y - 42.0, 13.0, true, teal);
        self.add_text(
            "Credencial SSI-PQ",
            MARGIN_LEFT + 72.0,
            self.y - 24.0,
            26.0,
            true,
            title,
        );
        self.add_text(
            "Credencial Verificável • Padrões Pós-Quânticos",
            MARGIN_LEFT + 74.0,
            self.y - 49.0,
            11.0,
            false,
            muted,
        );
        self.add_rect(
            PAGE_WIDTH - MARGIN_RIGHT - 108.0,
            self.y - 46.0,
            108.0,
            26.0,
            Some(PdfColor::rgb(0.94, 0.99, 0.96)),
            Some(green),
            0.9,
        );
        self.add_text(
            "VERIFICÁVEL",
            PAGE_WIDTH - MARGIN_RIGHT - 92.0,
            self.y - 37.0,
            10.5,
            true,
            green,
        );
        self.add_line(
            MARGIN_LEFT,
            self.y - 82.0,
            PAGE_WIDTH - MARGIN_RIGHT,
            self.y - 82.0,
            teal,
            1.0,
        );
        self.y -= 108.0;
    }

    fn add_continuation_header(&mut self) {
        let title = PdfColor::rgb(0.04, 0.16, 0.33);
        let teal = PdfColor::rgb(0.02, 0.48, 0.54);

        self.add_text(
            "Credencial SSI-PQ",
            MARGIN_LEFT,
            self.y - 12.0,
            13.0,
            true,
            title,
        );
        self.add_text(
            "continuação",
            PAGE_WIDTH - MARGIN_RIGHT - 62.0,
            self.y - 12.0,
            9.0,
            false,
            PdfColor::rgb(0.33, 0.42, 0.54),
        );
        self.add_line(
            MARGIN_LEFT,
            self.y - 24.0,
            PAGE_WIDTH - MARGIN_RIGHT,
            self.y - 24.0,
            teal,
            0.8,
        );
        self.y -= 46.0;
    }

    fn add_summary(&mut self, signed_credential: &SignedCredential) {
        let credential = &signed_credential.credential;
        let schema_display = credential
            .schema_hash
            .as_deref()
            .unwrap_or(credential.schema_id.as_str());
        let issuer_display = credential
            .issuer_identifier
            .as_deref()
            .unwrap_or(credential.issuer_did.as_str());
        let rows = [
            ("ID da credencial", credential.credential_id.as_str()),
            ("Hash do Schema", schema_display),
            ("Identificador do Emissor", issuer_display),
            ("Emitida em", credential.issued_at.as_str()),
            (
                "Expira em",
                credential.expires_at.as_deref().unwrap_or("sem expiração"),
            ),
        ];

        self.add_section_header("Resumo", SectionTheme::blue());
        self.add_key_value_card(&rows, SectionTheme::blue());
    }

    fn add_visible_attributes(
        &mut self,
        signed_credential: &SignedCredential,
        options: &PdfRenderOptions,
    ) {
        self.add_section_header("Atributos visíveis", SectionTheme::teal());

        if signed_credential.attribute_disclosures.is_empty() {
            self.add_note_card(
                "Nenhum atributo foi revelado nesta apresentação.",
                SectionTheme::teal(),
            );
            return;
        }

        for (group, attributes) in grouped_attribute_disclosures(signed_credential, &options.labels)
        {
            self.add_attribute_group_card(&group, &attributes, SectionTheme::teal());
        }
    }

    fn add_signature(&mut self, signed_credential: &SignedCredential) {
        let public_key = signed_credential
            .credential_signature
            .public_key_multibase
            .as_deref()
            .unwrap_or("não informada na credencial");
        let rows = [
            (
                "Algoritmo de assinatura",
                signed_credential.credential_signature.alg.as_str(),
            ),
            (
                "Chave de assinatura",
                signed_credential.credential_signature.key_id.as_str(),
            ),
            ("Chave Pública do Assinante", public_key),
            (
                "Estado",
                "credencial assinada e verificável pela chave pública do emissor.",
            ),
        ];

        self.add_section_header("Assinatura criptográfica", SectionTheme::blue());
        self.add_key_value_card(&rows, SectionTheme::blue());
    }

    fn add_integrity(&mut self, signed_credential: &SignedCredential) {
        let credential = &signed_credential.credential;
        let rows = [
            (
                "Compromisso dos atributos",
                credential.attributes_commitment.alg.as_str(),
            ),
            (
                "Merkle root",
                credential.attributes_commitment.root.as_str(),
            ),
        ];

        self.add_section_header("Integridade", SectionTheme::green());
        self.add_key_value_card(&rows, SectionTheme::green());
    }

    fn add_section_header(&mut self, title: &str, theme: SectionTheme) {
        self.ensure_space(48.0);
        let top = self.y;

        self.add_rect(
            MARGIN_LEFT,
            top - 34.0,
            content_width(),
            34.0,
            Some(theme.header_fill),
            Some(theme.stroke),
            0.9,
        );
        self.add_rect(
            MARGIN_LEFT,
            top - 34.0,
            5.0,
            34.0,
            Some(theme.stroke),
            None,
            0.0,
        );
        self.add_text(
            title,
            MARGIN_LEFT + 16.0,
            top - 22.0,
            14.0,
            true,
            theme.title,
        );
        self.y -= 44.0;
    }

    fn add_key_value_card(&mut self, rows: &[(&str, &str)], theme: SectionTheme) {
        let label_font_size = 9.8;
        let top_padding = 28.0;
        let bottom_padding = 4.0;
        let row_padding = 12.0;
        let last_row_padding = 4.0;
        let min_row_height = 24.0;
        let min_last_row_height = 15.0;
        let divider_gap_below = 12.0;
        let x = MARGIN_LEFT + 8.0;
        let width = content_width() - 16.0;
        let label_x = x + 14.0;
        let value_x = x + 178.0;
        let value_width = x + width - 14.0 - value_x;
        let row_values = rows
            .iter()
            .map(|(label, value)| {
                let font_size = key_value_value_font_size(label);
                wrap_pdf_text_with_font(value, value_width, font_size, key_value_value_font(label))
            })
            .collect::<Vec<_>>();
        let row_value_font_sizes = rows
            .iter()
            .map(|(label, _)| key_value_value_font_size(label))
            .collect::<Vec<_>>();
        let row_line_heights = row_value_font_sizes
            .iter()
            .map(|font_size| key_value_line_height(*font_size))
            .collect::<Vec<_>>();
        let last_row_index = rows.len().saturating_sub(1);
        let row_heights = row_values
            .iter()
            .enumerate()
            .map(|(index, lines)| {
                let padding = if index == last_row_index {
                    last_row_padding
                } else {
                    row_padding
                };
                let min_height = if index == last_row_index {
                    min_last_row_height
                } else {
                    min_row_height
                };

                (lines.len() as f32 * row_line_heights[index] + padding).max(min_height)
            })
            .collect::<Vec<_>>();
        let card_height = top_padding + bottom_padding + row_heights.iter().sum::<f32>();
        self.ensure_space(card_height + 14.0);
        let top = self.y;

        self.add_rect(
            x,
            top - card_height,
            width,
            card_height,
            Some(PdfColor::rgb(1.0, 1.0, 1.0)),
            Some(theme.light_stroke),
            0.7,
        );

        let mut row_y = top - top_padding;
        for (index, (label, _value)) in rows.iter().enumerate() {
            self.add_text(
                *label,
                label_x,
                row_y,
                label_font_size,
                true,
                PdfColor::rgb(0.08, 0.14, 0.24),
            );
            for (line_index, line) in row_values[index].iter().enumerate() {
                let line_y = row_y - line_index as f32 * row_line_heights[index];
                if key_value_value_font(label) == PdfTextFont::Courier {
                    self.add_monospace_text(
                        line,
                        value_x,
                        line_y,
                        row_value_font_sizes[index],
                        PdfColor::rgb(0.08, 0.14, 0.24),
                    );
                } else {
                    self.add_text(
                        line,
                        value_x,
                        line_y,
                        row_value_font_sizes[index],
                        false,
                        PdfColor::rgb(0.08, 0.14, 0.24),
                    );
                }
            }
            if index + 1 < rows.len() {
                let row_height = row_heights[index];
                self.add_line(
                    label_x,
                    row_y - row_height + divider_gap_below,
                    x + width - 14.0,
                    row_y - row_height + divider_gap_below,
                    theme.light_stroke,
                    0.45,
                );
            }
            row_y -= row_heights[index];
        }

        self.y -= card_height + 16.0;
    }

    fn add_attribute_group_card(
        &mut self,
        group: &str,
        attributes: &[AttributeDisplay],
        theme: SectionTheme,
    ) {
        let font_size = 9.8;
        let line_height = 12.5;
        let row_padding = 9.0;
        let x = MARGIN_LEFT + 8.0;
        let width = content_width() - 16.0;
        let text_x = x + 28.0;
        let text_width = width - 42.0;
        let rows = attributes
            .iter()
            .map(|attribute| {
                let text = format!("{}: {}", attribute.label, attribute.value);
                wrap_pdf_text(&text, text_width, font_size)
            })
            .collect::<Vec<_>>();
        let row_heights = rows
            .iter()
            .map(|lines| (lines.len() as f32 * line_height + row_padding).max(21.0))
            .collect::<Vec<_>>();
        let card_height = 36.0 + row_heights.iter().sum::<f32>();
        self.ensure_space(card_height + 10.0);
        let top = self.y;

        self.add_rect(
            x,
            top - card_height,
            width,
            card_height,
            Some(PdfColor::rgb(1.0, 1.0, 1.0)),
            Some(theme.light_stroke),
            0.7,
        );
        self.add_rect(
            x,
            top - 30.0,
            width,
            30.0,
            Some(theme.group_fill),
            None,
            0.0,
        );
        self.add_text(group, x + 14.0, top - 19.0, 12.0, true, theme.title);

        let mut row_y = top - 49.0;
        for (index, lines) in rows.iter().enumerate() {
            for (line_index, line) in lines.iter().enumerate() {
                self.add_text(
                    line,
                    text_x,
                    row_y - line_index as f32 * line_height,
                    font_size,
                    false,
                    PdfColor::rgb(0.08, 0.14, 0.24),
                );
            }

            let row_height = row_heights[index];
            if attributes
                .get(index + 1)
                .is_some_and(|next| next.divider_key != attributes[index].divider_key)
            {
                let last_text_baseline =
                    row_y - (lines.len().saturating_sub(1) as f32 * line_height);
                let current_text_bottom = last_text_baseline - font_size * 0.25;
                let next_text_top = row_y - row_height + font_size * 0.85;
                let divider_y = (current_text_bottom + next_text_top) / 2.0;
                self.add_line(
                    x + 24.0,
                    divider_y,
                    x + width - 14.0,
                    divider_y,
                    theme.light_stroke,
                    0.4,
                );
            }
            row_y -= row_height;
        }

        self.y -= card_height + 12.0;
    }

    fn add_note_card(&mut self, text: &str, theme: SectionTheme) {
        self.ensure_space(48.0);
        let top = self.y;
        let x = MARGIN_LEFT + 8.0;
        let width = content_width() - 16.0;

        self.add_rect(
            x,
            top - 40.0,
            width,
            40.0,
            Some(PdfColor::rgb(1.0, 1.0, 1.0)),
            Some(theme.light_stroke),
            0.7,
        );
        self.add_text(
            text,
            x + 14.0,
            top - 24.0,
            10.0,
            false,
            PdfColor::rgb(0.25, 0.34, 0.47),
        );
        self.y -= 52.0;
    }

    fn add_text(
        &mut self,
        text: impl Into<String>,
        x: f32,
        y: f32,
        font_size: f32,
        bold: bool,
        color: PdfColor,
    ) {
        self.current_page.push(PdfElement::Text(PositionedText {
            text: normalize_pdf_text(&text.into()),
            font_size,
            x,
            y,
            bold,
            font: PdfTextFont::Helvetica,
            color,
        }));
    }

    fn add_monospace_text(
        &mut self,
        text: impl Into<String>,
        x: f32,
        y: f32,
        font_size: f32,
        color: PdfColor,
    ) {
        self.current_page.push(PdfElement::Text(PositionedText {
            text: normalize_pdf_text(&text.into()),
            font_size,
            x,
            y,
            bold: false,
            font: PdfTextFont::Courier,
            color,
        }));
    }

    fn add_rect(
        &mut self,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        fill: Option<PdfColor>,
        stroke: Option<PdfColor>,
        stroke_width: f32,
    ) {
        self.current_page.push(PdfElement::Rect(PdfRect {
            x,
            y,
            width,
            height,
            fill,
            stroke,
            stroke_width,
        }));
    }

    fn add_line(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, color: PdfColor, width: f32) {
        self.current_page.push(PdfElement::Line(PdfStroke {
            x1,
            y1,
            x2,
            y2,
            color,
            width,
        }));
    }
}

#[derive(Debug, Clone, Copy)]
struct SectionTheme {
    title: PdfColor,
    stroke: PdfColor,
    light_stroke: PdfColor,
    header_fill: PdfColor,
    group_fill: PdfColor,
}

impl SectionTheme {
    fn blue() -> Self {
        Self {
            title: PdfColor::rgb(0.04, 0.25, 0.58),
            stroke: PdfColor::rgb(0.16, 0.48, 0.86),
            light_stroke: PdfColor::rgb(0.78, 0.86, 0.94),
            header_fill: PdfColor::rgb(0.94, 0.97, 1.0),
            group_fill: PdfColor::rgb(0.95, 0.98, 1.0),
        }
    }

    fn teal() -> Self {
        Self {
            title: PdfColor::rgb(0.0, 0.41, 0.45),
            stroke: PdfColor::rgb(0.0, 0.54, 0.58),
            light_stroke: PdfColor::rgb(0.75, 0.88, 0.89),
            header_fill: PdfColor::rgb(0.93, 0.99, 0.99),
            group_fill: PdfColor::rgb(0.94, 0.99, 0.99),
        }
    }

    fn green() -> Self {
        Self {
            title: PdfColor::rgb(0.0, 0.42, 0.30),
            stroke: PdfColor::rgb(0.0, 0.56, 0.38),
            light_stroke: PdfColor::rgb(0.75, 0.89, 0.84),
            header_fill: PdfColor::rgb(0.94, 0.99, 0.96),
            group_fill: PdfColor::rgb(0.95, 0.99, 0.97),
        }
    }
}

impl PdfColor {
    const fn rgb(r: f32, g: f32, b: f32) -> Self {
        Self { r, g, b }
    }
}

fn content_width() -> f32 {
    PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT
}

fn grouped_attribute_disclosures(
    signed_credential: &SignedCredential,
    labels: &BTreeMap<String, String>,
) -> BTreeMap<String, Vec<AttributeDisplay>> {
    let mut groups = BTreeMap::<String, Vec<AttributeDisplay>>::new();

    for disclosure in &signed_credential.attribute_disclosures {
        let path = disclosure
            .path
            .strip_prefix("subject.")
            .unwrap_or(&disclosure.path);
        let parts = path.split('.').collect::<Vec<_>>();
        let Some(root) = parts.first() else {
            continue;
        };
        let label_parts = if parts.len() > 1 {
            &parts[1..]
        } else {
            &parts[..]
        };
        let divider_key = attribute_divider_key(&parts);
        let label = label_parts
            .iter()
            .enumerate()
            .map(|(index, part)| {
                let prefix_end = if parts.len() > 1 { index + 2 } else { 1 };
                let prefix = parts[..prefix_end].join(".");
                display_label(labels, &prefix, part)
            })
            .collect::<Vec<_>>()
            .join(" > ");
        let group = display_label(labels, root, root);
        let value = display_value(&disclosure.value);

        groups.entry(group).or_default().push(AttributeDisplay {
            label,
            value,
            divider_key,
        });
    }

    groups
}

fn attribute_divider_key(parts: &[&str]) -> String {
    parts
        .get(1)
        .or_else(|| parts.first())
        .copied()
        .unwrap_or_default()
        .to_string()
}

fn key_value_value_font_size(label: &str) -> f32 {
    if label == "Chave Pública do Assinante" {
        5.0
    } else {
        8.3
    }
}

fn key_value_value_font(label: &str) -> PdfTextFont {
    if label == "Chave Pública do Assinante" {
        PdfTextFont::Courier
    } else {
        PdfTextFont::Helvetica
    }
}

fn key_value_line_height(font_size: f32) -> f32 {
    if font_size < 8.0 { 6.2 } else { 10.8 }
}

fn display_label(labels: &BTreeMap<String, String>, path: &str, fallback: &str) -> String {
    labels
        .get(path)
        .or_else(|| labels.get(&format!("subject.{path}")))
        .cloned()
        .unwrap_or_else(|| title_case_label(&fallback.replace('_', " ")))
}

fn write_pdf(pages: &[Vec<PdfElement>], render_credential_hash: Option<&str>) -> Vec<u8> {
    let regular_font_object_id = 3usize;
    let bold_font_object_id = 4usize;
    let monospace_font_object_id = 5usize;
    let page_object_ids = (0..pages.len())
        .map(|index| 6 + index * 2)
        .collect::<Vec<_>>();
    let content_object_ids = (0..pages.len())
        .map(|index| 7 + index * 2)
        .collect::<Vec<_>>();
    let object_count = 5 + pages.len() * 2;
    let mut objects = vec![String::new(); object_count + 1];

    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>".to_string();
    objects[2] = format!(
        "<< /Type /Pages /Kids [{}] /Count {} >>",
        page_object_ids
            .iter()
            .map(|id| format!("{id} 0 R"))
            .collect::<Vec<_>>()
            .join(" "),
        pages.len()
    );
    objects[regular_font_object_id] =
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
            .to_string();
    objects[bold_font_object_id] =
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
            .to_string();
    objects[monospace_font_object_id] =
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"
            .to_string();

    for (index, page_elements) in pages.iter().enumerate() {
        let page_id = page_object_ids[index];
        let content_id = content_object_ids[index];
        let content = page_content_stream(page_elements);

        objects[page_id] = format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH:.0} {PAGE_HEIGHT:.0}] /Resources << /Font << /F1 {regular_font_object_id} 0 R /F2 {bold_font_object_id} 0 R /F3 {monospace_font_object_id} 0 R >> >> /Contents {content_id} 0 R >>"
        );
        objects[content_id] = format!(
            "<< /Length {} >>\nstream\n{}endstream",
            content.len(),
            content
        );
    }

    let mut pdf = Vec::new();
    pdf.extend_from_slice(b"%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");
    if let Some(render_credential_hash) = render_credential_hash {
        pdf.extend_from_slice(PDF_RENDER_CREDENTIAL_HASH_MARKER);
        pdf.extend_from_slice(render_credential_hash.as_bytes());
        pdf.extend_from_slice(b"\n");
    }
    let mut offsets = vec![0usize; object_count + 1];

    for object_id in 1..=object_count {
        offsets[object_id] = pdf.len();
        pdf.extend_from_slice(
            format!("{object_id} 0 obj\n{}\nendobj\n", objects[object_id]).as_bytes(),
        );
    }

    let xref_offset = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n", object_count + 1).as_bytes());
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            object_count + 1,
            xref_offset
        )
        .as_bytes(),
    );

    pdf
}

fn page_content_stream(elements: &[PdfElement]) -> String {
    let mut stream = String::new();

    for element in elements {
        match element {
            PdfElement::Text(text) => {
                let font = match (text.font, text.bold) {
                    (PdfTextFont::Courier, _) => "F3",
                    (PdfTextFont::Helvetica, true) => "F2",
                    (PdfTextFont::Helvetica, false) => "F1",
                };
                stream.push_str("BT\n");
                stream.push_str(&format!(
                    "{:.3} {:.3} {:.3} rg\n",
                    text.color.r, text.color.g, text.color.b
                ));
                stream.push_str(&format!("/{font} {:.1} Tf\n", text.font_size));
                stream.push_str(&format!("{:.1} {:.1} Td\n", text.x, text.y));
                stream.push_str(&format!("<{}> Tj\n", pdf_winansi_hex(&text.text)));
                stream.push_str("ET\n");
            }
            PdfElement::Rect(rect) => {
                stream.push_str("q\n");
                if let Some(fill) = rect.fill {
                    stream.push_str(&format!("{:.3} {:.3} {:.3} rg\n", fill.r, fill.g, fill.b));
                }
                if let Some(stroke) = rect.stroke {
                    stream.push_str(&format!(
                        "{:.3} {:.3} {:.3} RG\n",
                        stroke.r, stroke.g, stroke.b
                    ));
                    stream.push_str(&format!("{:.2} w\n", rect.stroke_width.max(0.1)));
                }
                stream.push_str(&format!(
                    "{:.1} {:.1} {:.1} {:.1} re\n",
                    rect.x, rect.y, rect.width, rect.height
                ));
                match (rect.fill.is_some(), rect.stroke.is_some()) {
                    (true, true) => stream.push_str("B\n"),
                    (true, false) => stream.push_str("f\n"),
                    (false, true) => stream.push_str("S\n"),
                    (false, false) => {}
                }
                stream.push_str("Q\n");
            }
            PdfElement::Line(line) => {
                stream.push_str("q\n");
                stream.push_str(&format!(
                    "{:.3} {:.3} {:.3} RG\n",
                    line.color.r, line.color.g, line.color.b
                ));
                stream.push_str(&format!("{:.2} w\n", line.width));
                stream.push_str(&format!(
                    "{:.1} {:.1} m {:.1} {:.1} l S\n",
                    line.x1, line.y1, line.x2, line.y2
                ));
                stream.push_str("Q\n");
            }
        }
    }

    stream
}

fn create_document_binding(
    pdf_base_bytes: &[u8],
    signed_credential: &SignedCredential,
    signing_public_key: &[u8],
    options: PdfBindingOptions,
) -> Result<PdfDocumentBinding> {
    validate_pdf_base(pdf_base_bytes)?;
    crate::time::validate_rfc3339_timestamp("created_at", &options.created_at)
        .map_err(SsiError::InvalidPdf)?;

    Ok(PdfDocumentBinding {
        document_type: PDF_BINDING_TYPE.to_string(),
        pdf_hash_alg: "SHA3-256".to_string(),
        pdf_base_hash: base64url_encode(&sha3_256(pdf_base_bytes)),
        pdf_base_length: pdf_base_bytes.len() as u64,
        credential_hash_alg: "SHA3-256".to_string(),
        credential_hash: base64url_encode(&signed_credential_hash(signed_credential)?),
        credential_hash_scope: PDF_CREDENTIAL_HASH_SCOPE.to_string(),
        binding_scope: PDF_BINDING_SCOPE.to_string(),
        embedding_policy: PDF_EMBEDDING_POLICY.to_string(),
        issuer_did: signed_credential.credential.issuer_did.clone(),
        did_doc_cid: options.did_doc_cid,
        signing_key_id: signed_credential.credential_signature.key_id.clone(),
        signing_public_key_multibase: Some(multibase_base58btc_encode(signing_public_key)),
        signing_key_fingerprint: signing_key_fingerprint(
            &signed_credential.credential_signature.alg,
            signing_public_key,
        ),
        created_at: options.created_at,
    })
}

fn embed_manifest_in_pdf(
    pdf_base_bytes: &[u8],
    manifest: &PdfCredentialManifest,
) -> Result<Vec<u8>> {
    validate_pdf_base(pdf_base_bytes)?;

    let previous_size = previous_pdf_size(pdf_base_bytes)?;
    let previous_startxref = previous_startxref(pdf_base_bytes)?;
    let embedded_file_id = previous_size;
    let filespec_id = previous_size + 1;
    let names_id = previous_size + 2;
    let updated_size = previous_size + 3;
    let manifest_bytes = manifest_canonical_bytes(manifest)?;
    let mut update = Vec::new();

    update.extend_from_slice(b"\n");
    update.extend_from_slice(PDF_MANIFEST_MARKER);

    let catalog_offset = push_pdf_object(
        &mut update,
        pdf_base_bytes.len(),
        1,
        format!(
            "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles {names_id} 0 R >> /AF [{filespec_id} 0 R] >>"
        )
        .as_bytes(),
    );
    let embedded_offset = push_pdf_object(
        &mut update,
        pdf_base_bytes.len(),
        embedded_file_id,
        &embedded_file_object(&manifest_bytes),
    );
    let filespec_offset = push_pdf_object(
        &mut update,
        pdf_base_bytes.len(),
        filespec_id,
        filespec_object(embedded_file_id).as_bytes(),
    );
    let names_offset = push_pdf_object(
        &mut update,
        pdf_base_bytes.len(),
        names_id,
        names_object(filespec_id).as_bytes(),
    );
    let xref_offset = pdf_base_bytes.len() + update.len();

    update.extend_from_slice(
        format!(
            "xref\n1 1\n{catalog_offset:010} 00000 n \n{embedded_file_id} 3\n{embedded_offset:010} 00000 n \n{filespec_offset:010} 00000 n \n{names_offset:010} 00000 n \n"
        )
        .as_bytes(),
    );
    update.extend_from_slice(
        format!(
            "trailer\n<< /Size {updated_size} /Root 1 0 R /Prev {previous_startxref} >>\nstartxref\n{xref_offset}\n%%EOF\n"
        )
        .as_bytes(),
    );

    let mut output = Vec::with_capacity(pdf_base_bytes.len() + update.len());
    output.extend_from_slice(pdf_base_bytes);
    output.extend_from_slice(&update);
    Ok(output)
}

fn embedded_file_object(manifest_bytes: &[u8]) -> Vec<u8> {
    let mut object = format!(
        "<< /Type /EmbeddedFile /Subtype /application#2Fjson /Length {} /Params << /Size {} >> >>\nstream\n",
        manifest_bytes.len(),
        manifest_bytes.len()
    )
    .into_bytes();
    object.extend_from_slice(manifest_bytes);
    object.extend_from_slice(b"\nendstream");
    object
}

fn filespec_object(embedded_file_id: usize) -> String {
    let file_name = pdf_literal_string(PDF_MANIFEST_FILENAME);
    format!(
        "<< /Type /Filespec /F {file_name} /UF {file_name} /Desc (SSI-PQ signed credential manifest) /AFRelationship /Data /EF << /F {embedded_file_id} 0 R /UF {embedded_file_id} 0 R >> >>"
    )
}

fn names_object(filespec_id: usize) -> String {
    let file_name = pdf_literal_string(PDF_MANIFEST_FILENAME);
    format!("<< /Names [{file_name} {filespec_id} 0 R] >>")
}

fn push_pdf_object(update: &mut Vec<u8>, base_len: usize, object_id: usize, body: &[u8]) -> usize {
    let offset = base_len + update.len();
    update.extend_from_slice(format!("{object_id} 0 obj\n").as_bytes());
    update.extend_from_slice(body);
    update.extend_from_slice(b"\nendobj\n");
    offset
}

fn verify_document_binding_signature(
    manifest: &PdfCredentialManifest,
    issuer_did_document: &DidDocument,
) -> Result<bool> {
    let (profile, public_key) = issuer_pdf_signing_key(
        issuer_did_document,
        &manifest.document_binding.signing_key_id,
    )?;
    if manifest.document_binding_signature.alg != profile.as_str()
        || manifest.document_binding_signature.key_id != manifest.document_binding.signing_key_id
    {
        return Ok(false);
    }

    let signature = base64url_decode(&manifest.document_binding_signature.signature)?;
    let message = document_binding_message(&manifest.document_binding)?;

    mldsa::verify(
        profile,
        &public_key,
        &message,
        PDF_DOCUMENT_BINDING_CONTEXT,
        &signature,
    )
}

fn did_document_matches_manifest(
    issuer_did_document: &DidDocument,
    manifest: &PdfCredentialManifest,
) -> Result<bool> {
    if !did::verify_did_document(issuer_did_document)? {
        return Ok(false);
    }
    if issuer_did_document.id != manifest.signed_credential.credential.issuer_did
        || issuer_did_document.id != manifest.document_binding.issuer_did
    {
        return Ok(false);
    }

    let (_, public_key) = issuer_pdf_signing_key(
        issuer_did_document,
        &manifest.document_binding.signing_key_id,
    )?;
    if manifest
        .document_binding
        .signing_public_key_multibase
        .as_ref()
        .is_some_and(|declared| declared != &multibase_base58btc_encode(&public_key))
    {
        return Ok(false);
    }
    Ok(manifest.document_binding.signing_key_fingerprint
        == signing_key_fingerprint(&manifest.document_binding_signature.alg, &public_key))
}

fn issuer_pdf_signing_key(
    issuer_did_document: &DidDocument,
    key_id: &str,
) -> Result<(MlDsaProfile, Vec<u8>)> {
    let key = issuer_did_document
        .keys
        .iter()
        .find(|key| key.id == key_id)
        .ok_or_else(|| SsiError::MissingDidKey(key_id.to_string()))?;
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

fn signed_credential_hash(signed_credential: &SignedCredential) -> Result<[u8; 32]> {
    let value = serde_json::to_value(signed_credential)?;
    Ok(sha3_256(&canonical_json::canonical_json_bytes(&value)))
}

fn document_binding_message(document_binding: &PdfDocumentBinding) -> Result<Vec<u8>> {
    let value = serde_json::to_value(document_binding)?;
    Ok(canonical_json::canonical_json_bytes(&value))
}

fn pdf_render_credential_hash(pdf_base_bytes: &[u8]) -> Option<String> {
    let start = find_bytes(pdf_base_bytes, PDF_RENDER_CREDENTIAL_HASH_MARKER)?
        + PDF_RENDER_CREDENTIAL_HASH_MARKER.len();
    let end = pdf_base_bytes[start..]
        .iter()
        .position(|byte| *byte == b'\n' || *byte == b'\r')
        .map(|position| start + position)
        .unwrap_or(pdf_base_bytes.len());
    let value = std::str::from_utf8(&pdf_base_bytes[start..end]).ok()?;

    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn manifest_canonical_bytes(manifest: &PdfCredentialManifest) -> Result<Vec<u8>> {
    let value = serde_json::to_value(manifest)?;
    Ok(canonical_json::canonical_json_bytes(&value))
}

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
    Ok(())
}

fn previous_pdf_size(pdf_base_bytes: &[u8]) -> Result<usize> {
    let size_offset = rfind_bytes(pdf_base_bytes, b"/Size")
        .ok_or_else(|| SsiError::InvalidPdf("PDF trailer /Size not found".to_string()))?;
    parse_ascii_usize_after(pdf_base_bytes, size_offset + b"/Size".len())
        .ok_or_else(|| SsiError::InvalidPdf("PDF trailer /Size is invalid".to_string()))
}

fn previous_startxref(pdf_base_bytes: &[u8]) -> Result<usize> {
    let startxref_offset = rfind_bytes(pdf_base_bytes, b"startxref")
        .ok_or_else(|| SsiError::InvalidPdf("PDF startxref not found".to_string()))?;
    parse_ascii_usize_after(pdf_base_bytes, startxref_offset + b"startxref".len())
        .ok_or_else(|| SsiError::InvalidPdf("PDF startxref is invalid".to_string()))
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

fn display_value(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => value.clone(),
        Value::Array(_) | Value::Object(_) => value.to_string(),
    }
}

fn title_case_label(label: &str) -> String {
    label
        .split_whitespace()
        .map(title_case_word)
        .collect::<Vec<_>>()
        .join(" ")
}

fn title_case_word(word: &str) -> String {
    match word.to_lowercase().as_str() {
        "horaria" => "Horária".to_string(),
        "nivel" => "Nível".to_string(),
        "emissao" => "Emissão".to_string(),
        "expiracao" => "Expiração".to_string(),
        "publica" => "Pública".to_string(),
        "criptografica" => "Criptográfica".to_string(),
        "verificavel" => "Verificável".to_string(),
        _ => {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        }
    }
}

fn normalize_pdf_text(text: &str) -> String {
    text.nfc()
        .map(|char| match char {
            '\n' | '\r' | '\t' => ' ',
            char if !char.is_control() => char,
            _ => ' ',
        })
        .collect()
}

fn wrap_pdf_text(text: &str, max_width: f32, font_size: f32) -> Vec<String> {
    wrap_pdf_text_with_font(text, max_width, font_size, PdfTextFont::Helvetica)
}

fn wrap_pdf_text_with_font(
    text: &str,
    max_width: f32,
    font_size: f32,
    font: PdfTextFont,
) -> Vec<String> {
    let text = normalize_pdf_text(text);
    let mut lines = Vec::new();
    let mut current = String::new();

    for word in text.split_whitespace() {
        let candidate = if current.is_empty() {
            word.to_string()
        } else {
            format!("{current} {word}")
        };

        if pdf_text_width(&candidate, font_size, font) <= max_width {
            current = candidate;
            continue;
        }

        if !current.is_empty() {
            lines.push(current);
            current = String::new();
        }

        if pdf_text_width(word, font_size, font) <= max_width {
            current = word.to_string();
        } else {
            let chunks = split_long_pdf_word(word, max_width, font_size, font);
            let mut chunk_iter = chunks.into_iter().peekable();

            while let Some(chunk) = chunk_iter.next() {
                if chunk_iter.peek().is_some() {
                    lines.push(chunk);
                } else {
                    current = chunk;
                }
            }
        }
    }

    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }

    lines
}

fn split_long_pdf_word(
    word: &str,
    max_width: f32,
    font_size: f32,
    font: PdfTextFont,
) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();

    for char in word.chars() {
        let candidate = format!("{current}{char}");

        if !current.is_empty() && pdf_text_width(&candidate, font_size, font) > max_width {
            chunks.push(current);
            current = char.to_string();
        } else {
            current = candidate;
        }
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    chunks
}

fn pdf_text_width(text: &str, font_size: f32, font: PdfTextFont) -> f32 {
    text.chars()
        .map(|char| match font {
            PdfTextFont::Helvetica => helvetica_width_factor(char),
            PdfTextFont::Courier => 0.6,
        })
        .sum::<f32>()
        * font_size
}

fn helvetica_width_factor(char: char) -> f32 {
    match char {
        ' ' => 0.28,
        'i' | 'j' | 'l' | '!' | '|' | '\'' | '.' | ',' | ':' | ';' => 0.25,
        'f' | 'r' | 't' | '(' | ')' | '[' | ']' => 0.33,
        'm' | 'w' | 'M' | 'W' => 0.82,
        char if char.is_ascii_uppercase() => 0.67,
        char if char.is_ascii_digit() => 0.56,
        char if char.is_ascii_punctuation() => 0.36,
        _ => 0.54,
    }
}

fn pdf_winansi_hex(text: &str) -> String {
    text.chars()
        .map(winansi_byte)
        .map(|byte| format!("{byte:02X}"))
        .collect::<String>()
}

fn winansi_byte(char: char) -> u8 {
    match char {
        char if char.is_ascii() && !char.is_control() => char as u8,
        '\u{00A0}'..='\u{00FF}' => char as u8,
        '\u{20AC}' => 0x80,
        '\u{201A}' => 0x82,
        '\u{0192}' => 0x83,
        '\u{201E}' => 0x84,
        '\u{2026}' => 0x85,
        '\u{2020}' => 0x86,
        '\u{2021}' => 0x87,
        '\u{02C6}' => 0x88,
        '\u{2030}' => 0x89,
        '\u{0160}' => 0x8A,
        '\u{2039}' => 0x8B,
        '\u{0152}' => 0x8C,
        '\u{017D}' => 0x8E,
        '\u{2018}' => 0x91,
        '\u{2019}' => 0x92,
        '\u{201C}' => 0x93,
        '\u{201D}' => 0x94,
        '\u{2022}' => 0x95,
        '\u{2013}' => 0x96,
        '\u{2014}' => 0x97,
        '\u{02DC}' => 0x98,
        '\u{2122}' => 0x99,
        '\u{0161}' => 0x9A,
        '\u{203A}' => 0x9B,
        '\u{0153}' => 0x9C,
        '\u{017E}' => 0x9E,
        '\u{0178}' => 0x9F,
        _ => b'?',
    }
}

impl SignedPdfVerificationResult {
    fn invalid(status: &str, manifest: Option<PdfCredentialManifest>) -> Self {
        let signed_credential = manifest
            .as_ref()
            .map(|manifest| manifest.signed_credential.clone());
        let issuer_did = manifest
            .as_ref()
            .map(|manifest| manifest.document_binding.issuer_did.clone());
        let credential_id = manifest
            .as_ref()
            .map(|manifest| manifest.signed_credential.credential.credential_id.clone());

        Self {
            valid: false,
            status: status.to_string(),
            issuer_did,
            credential_id,
            pdf_base_hash_valid: false,
            credential_signature_valid: false,
            document_binding_signature_valid: false,
            manifest_is_final_revision: false,
            did_key_match: false,
            errors: vec![status.to_string()],
            manifest,
            signed_credential,
        }
    }

    fn from_manifest(manifest: PdfCredentialManifest) -> Self {
        Self {
            valid: false,
            status: "PENDING".to_string(),
            issuer_did: Some(manifest.document_binding.issuer_did.clone()),
            credential_id: Some(manifest.signed_credential.credential.credential_id.clone()),
            pdf_base_hash_valid: false,
            credential_signature_valid: false,
            document_binding_signature_valid: false,
            manifest_is_final_revision: false,
            did_key_match: false,
            errors: Vec::new(),
            signed_credential: Some(manifest.signed_credential.clone()),
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
            && self.credential_signature_valid
            && self.document_binding_signature_valid
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        credential::{
            CredentialIssueOptions, SignedCredentialVersion, issue_credential_from_schema,
        },
        did::{DidCreateOptions, create_did},
        profiles::{MlDsaProfile, MlKemProfile},
        schema::{SchemaCreateOptions, create_schema_from_attributes},
    };
    use serde_json::json;

    #[test]
    fn nested_attribute_divider_key_uses_direct_child_under_group() {
        assert_eq!(
            attribute_divider_key(&["titular", "documento", "numero"]),
            "documento"
        );
        assert_eq!(
            attribute_divider_key(&["titular", "documento", "tipo"]),
            "documento"
        );
        assert_eq!(attribute_divider_key(&["titular", "nome"]), "nome");
        assert_eq!(attribute_divider_key(&["nivel"]), "nivel");
    }

    #[test]
    fn attribute_group_card_separates_direct_children_not_nested_siblings() {
        let mut renderer = PdfRenderer::new();
        let attributes = vec![
            AttributeDisplay {
                label: "Documento > Numero".to_string(),
                value: "123.456.789-00".to_string(),
                divider_key: "documento".to_string(),
            },
            AttributeDisplay {
                label: "Documento > Tipo".to_string(),
                value: "CPF".to_string(),
                divider_key: "documento".to_string(),
            },
            AttributeDisplay {
                label: "Nome".to_string(),
                value: "Alice Silva".to_string(),
                divider_key: "nome".to_string(),
            },
        ];

        renderer.add_attribute_group_card("Titular", &attributes, SectionTheme::teal());

        let divider_count = renderer
            .current_page
            .iter()
            .filter(|element| matches!(element, PdfElement::Line(_)))
            .count();
        assert_eq!(divider_count, 1);
    }

    #[test]
    fn signed_credential_pdf_contains_visible_information() {
        let issuer = create_did(DidCreateOptions {
            mldsa_profile: MlDsaProfile::MlDsa65,
            mlkem_profile: MlKemProfile::MlKem768,
            created_at: "2026-05-27T00:00:00Z".to_string(),
        })
        .unwrap();
        let schema = create_schema_from_attributes(
            &json!({"nome": "Ana Silva", "curso": "Criptografia Aplicada"}),
            SchemaCreateOptions {
                version: "1".to_string(),
                created_at: "2026-05-27T00:00:00Z".to_string(),
            },
        )
        .unwrap();
        let signed_credential = issue_credential_from_schema(
            &schema,
            &json!({"nome": "Ana Silva", "curso": "Criptografia Aplicada"}),
            &issuer.did_document,
            &issuer.mldsa_private_key,
            CredentialIssueOptions {
                credential_id: Some("cred_pdf_test".to_string()),
                issued_at: "2026-05-27T00:00:00Z".to_string(),
                expires_at: None,
                status_ref: None,
                visible_paths: None,
                credential_version: SignedCredentialVersion::V2,
            },
        )
        .unwrap();
        let pdf = signed_credential_to_pdf(&signed_credential).unwrap();
        let pdf_text = String::from_utf8_lossy(&pdf);

        assert!(pdf.starts_with(b"%PDF-1.4"));
        assert!(pdf.ends_with(b"%%EOF\n"));
        assert!(pdf_text.contains(&pdf_winansi_hex("Credencial SSI-PQ")));
        assert!(pdf_text.contains(&pdf_winansi_hex("cred_pdf_test")));
        assert!(pdf_text.contains(&pdf_winansi_hex("Ana Silva")));
        assert!(pdf_text.contains(&pdf_winansi_hex("Criptografia Aplicada")));
        assert!(pdf_text.contains(&pdf_winansi_hex(
            signed_credential.credential.schema_hash.as_deref().unwrap()
        )));
        assert!(
            pdf_text.contains(&pdf_winansi_hex(
                signed_credential
                    .credential
                    .issuer_identifier
                    .as_deref()
                    .unwrap()
            ))
        );
        assert!(pdf_text.contains(&pdf_winansi_hex("Assinatura criptográfica")));
    }

    #[test]
    fn signed_pdf_manifest_binds_credential_to_pdf_base() {
        let issuer = create_did(DidCreateOptions {
            mldsa_profile: MlDsaProfile::MlDsa65,
            mlkem_profile: MlKemProfile::MlKem768,
            created_at: "2026-05-27T00:00:00Z".to_string(),
        })
        .unwrap();
        let schema = create_schema_from_attributes(
            &json!({"nome": "Ana Silva", "curso": "Criptografia Aplicada"}),
            SchemaCreateOptions {
                version: "1".to_string(),
                created_at: "2026-05-27T00:00:00Z".to_string(),
            },
        )
        .unwrap();
        let signed_credential = issue_credential_from_schema(
            &schema,
            &json!({"nome": "Ana Silva", "curso": "Criptografia Aplicada"}),
            &issuer.did_document,
            &issuer.mldsa_private_key,
            CredentialIssueOptions {
                credential_id: Some("cred_pdf_binding_test".to_string()),
                issued_at: "2026-05-27T00:00:00Z".to_string(),
                expires_at: None,
                status_ref: None,
                visible_paths: None,
                credential_version: SignedCredentialVersion::V2,
            },
        )
        .unwrap();
        let pdf_base = signed_credential_to_pdf(&signed_credential).unwrap();
        let final_pdf = embed_signed_credential_in_pdf(
            &pdf_base,
            &signed_credential,
            &issuer.did_document,
            &issuer.mldsa_private_key,
            PdfBindingOptions {
                created_at: "2026-05-27T00:00:00Z".to_string(),
                did_doc_cid: None,
            },
        )
        .unwrap();
        let manifest = extract_pdf_manifest(&final_pdf).unwrap();
        let verification = verify_signed_credential_pdf(&final_pdf, &issuer.did_document).unwrap();

        assert_eq!(
            manifest.signed_credential.credential.credential_id,
            "cred_pdf_binding_test"
        );
        assert!(final_pdf.len() > pdf_base.len());
        assert_eq!(&final_pdf[..pdf_base.len()], pdf_base.as_slice());
        assert!(verification.valid);
        assert!(verification.pdf_base_hash_valid);
        assert!(verification.credential_signature_valid);
        assert!(verification.document_binding_signature_valid);
        assert!(verification.manifest_is_final_revision);

        let mut changed_pdf_base = final_pdf.clone();
        changed_pdf_base[64] ^= 1;
        let changed_verification =
            verify_signed_credential_pdf(&changed_pdf_base, &issuer.did_document).unwrap();
        assert!(!changed_verification.valid);
        assert!(
            changed_verification
                .errors
                .contains(&"PDF_BASE_HASH_MISMATCH".to_string())
        );

        let mut appended_pdf = final_pdf.clone();
        appended_pdf.extend_from_slice(b"\n% extra update after SSI manifest\n");
        let appended_verification =
            verify_signed_credential_pdf(&appended_pdf, &issuer.did_document).unwrap();
        assert!(!appended_verification.valid);
        assert!(
            appended_verification
                .errors
                .contains(&"MANIFEST_NOT_FINAL_REVISION".to_string())
        );
    }

    #[test]
    fn signed_pdf_verification_rejects_swapped_visual_credential() {
        let issuer = create_did(DidCreateOptions {
            mldsa_profile: MlDsaProfile::MlDsa65,
            mlkem_profile: MlKemProfile::MlKem768,
            created_at: "2026-05-27T00:00:00Z".to_string(),
        })
        .unwrap();
        let schema = create_schema_from_attributes(
            &json!({"nome": "Ana Silva", "curso": "Criptografia Aplicada"}),
            SchemaCreateOptions {
                version: "1".to_string(),
                created_at: "2026-05-27T00:00:00Z".to_string(),
            },
        )
        .unwrap();
        let credential_data = json!({"nome": "Ana Silva", "curso": "Criptografia Aplicada"});
        let signed_credential_1 = issue_credential_from_schema(
            &schema,
            &credential_data,
            &issuer.did_document,
            &issuer.mldsa_private_key,
            CredentialIssueOptions {
                credential_id: Some("cred_pdf_swap_1".to_string()),
                issued_at: "2026-05-27T00:00:00Z".to_string(),
                expires_at: None,
                status_ref: None,
                visible_paths: None,
                credential_version: SignedCredentialVersion::V2,
            },
        )
        .unwrap();
        let signed_credential_2 = issue_credential_from_schema(
            &schema,
            &credential_data,
            &issuer.did_document,
            &issuer.mldsa_private_key,
            CredentialIssueOptions {
                credential_id: Some("cred_pdf_swap_2".to_string()),
                issued_at: "2026-05-27T00:00:00Z".to_string(),
                expires_at: None,
                status_ref: None,
                visible_paths: None,
                credential_version: SignedCredentialVersion::V2,
            },
        )
        .unwrap();

        let pdf_base_1 = signed_credential_to_pdf(&signed_credential_1).unwrap();
        let swapped_pdf = embed_signed_credential_in_pdf(
            &pdf_base_1,
            &signed_credential_2,
            &issuer.did_document,
            &issuer.mldsa_private_key,
            PdfBindingOptions {
                created_at: "2026-05-27T00:00:00Z".to_string(),
                did_doc_cid: None,
            },
        )
        .unwrap();

        let verification =
            verify_signed_credential_pdf(&swapped_pdf, &issuer.did_document).unwrap();

        assert!(!verification.valid);
        assert!(
            verification
                .errors
                .contains(&"PDF_CREDENTIAL_RENDER_MISMATCH".to_string())
        );
    }
}
