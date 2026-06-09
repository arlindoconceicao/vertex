use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use zeroize::Zeroizing;

use crate::{
    Result, SsiError, canonical_json,
    crypto::{mldsa, mlkem},
    encoding::{self, base64_encode, multibase_base58btc_decode, multibase_base58btc_encode},
    hash::sha3_256,
    profiles::{MlDsaProfile, MlKemProfile},
};

/// Separador de domínio usado para calcular fingerprints de DID.
pub const DID_FINGERPRINT_DOMAIN: &[u8] = b"SSI_DID_FINGERPRINT_V1";

/// Separador de domínio usado para assinar DID Documents.
pub const DID_DOCUMENT_SIGNATURE_CONTEXT: &[u8] = b"SSI_DID_DOCUMENT_SIGNATURE_V1";
pub const ISSUER_IDENTIFIER_DOMAIN: &[u8] = b"SSI_PQ_ISSUER_IDENTIFIER_SHA3_256_V1";

/// Identificador do método DID usado pelo projeto SSI-PQ.
pub const DID_METHOD_PREFIX: &str = "did:ssipq:";

/// Opções usadas para gerar um novo DID SSI-PQ.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DidCreateOptions {
    /// Perfil ML-DSA usado para a chave de assinatura.
    pub mldsa_profile: MlDsaProfile,
    /// Perfil ML-KEM usado para a chave de acordo/encapsulamento.
    pub mlkem_profile: MlKemProfile,
    /// Timestamp de criação a ser gravado no DID Document.
    pub created_at: String,
}

/// Resultado da criação de um DID SSI-PQ.
///
/// As chaves privadas aparecem aqui somente para testes e protótipos. Quando a
/// wallet SQLite cifrada existir, elas devem ser gravadas fora do DID Document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DidCreationResult {
    /// DID final no formato `did:ssipq:z...`.
    pub did: String,
    /// Fingerprint multibase/base58btc usado no DID.
    pub fingerprint: String,
    /// DID Document público assinado.
    pub did_document: DidDocument,
    /// Chave privada ML-DSA serializada para uso temporário em testes.
    pub mldsa_private_key: Zeroizing<Vec<u8>>,
    /// Chave privada ML-KEM serializada para uso temporário em testes.
    pub mlkem_private_key: Zeroizing<Vec<u8>>,
}

/// DID Document público SSI-PQ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DidDocument {
    /// Tipo/versionamento lógico do documento.
    #[serde(rename = "type")]
    pub document_type: String,
    /// Identificador DID.
    pub id: String,
    /// Controlador do DID.
    pub controller: String,
    /// Timestamp de criação em formato textual RFC 3339.
    pub created_at: String,
    /// Chaves públicas declaradas pelo DID.
    pub keys: Vec<DidPublicKey>,
    /// Estado operacional do DID.
    pub status: String,
    /// Assinatura do DID Document.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<DidSignature>,
}

/// Chave pública declarada em um DID Document SSI-PQ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DidPublicKey {
    /// Identificador local da chave dentro do documento.
    pub id: String,
    /// Algoritmo da chave pública.
    #[serde(rename = "type")]
    pub key_type: String,
    /// Usos autorizados para a chave.
    pub usage: Vec<String>,
    /// Chave pública codificada em multibase/base58btc.
    pub public_key_multibase: String,
}

/// Assinatura do DID Document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DidSignature {
    /// Algoritmo usado na assinatura.
    pub alg: String,
    /// Identificador local da chave de assinatura.
    pub key_id: String,
    /// Assinatura em base64url sem padding.
    pub value: String,
}

/// Gera um novo DID SSI-PQ com chaves públicas ML-DSA e ML-KEM.
///
/// O documento público final contém apenas chaves públicas. As chaves privadas
/// retornadas existem para manter testes em memória até a wallet cifrada.
pub fn create_did(options: DidCreateOptions) -> Result<DidCreationResult> {
    crate::time::validate_rfc3339_timestamp("created_at", &options.created_at)
        .map_err(SsiError::InvalidDidDocument)?;

    let mldsa_key_pair = mldsa::keygen(options.mldsa_profile)?;
    let mlkem_key_pair = mlkem::keygen(options.mlkem_profile)?;
    let fingerprint = fingerprint_from_keys(
        options.mldsa_profile,
        &mldsa_key_pair.public_key,
        options.mlkem_profile,
        &mlkem_key_pair.public_key,
    );
    let did = format!("{DID_METHOD_PREFIX}{fingerprint}");

    let mut did_document = DidDocument {
        document_type: "ssi_pq_did_document_v1".to_string(),
        id: did.clone(),
        controller: did.clone(),
        created_at: options.created_at,
        keys: vec![
            DidPublicKey {
                id: "#mldsa-1".to_string(),
                key_type: options.mldsa_profile.as_str().to_string(),
                usage: vec!["authentication".to_string(), "assertionMethod".to_string()],
                public_key_multibase: multibase_base58btc_encode(&mldsa_key_pair.public_key),
            },
            DidPublicKey {
                id: "#mlkem-1".to_string(),
                key_type: options.mlkem_profile.as_str().to_string(),
                usage: vec!["keyAgreement".to_string()],
                public_key_multibase: multibase_base58btc_encode(&mlkem_key_pair.public_key),
            },
        ],
        status: "active".to_string(),
        signature: None,
    };

    sign_did_document(
        &mut did_document,
        &mldsa_key_pair.private_key,
        options.mldsa_profile,
    )?;

    Ok(DidCreationResult {
        did,
        fingerprint,
        did_document,
        mldsa_private_key: mldsa_key_pair.private_key,
        mlkem_private_key: mlkem_key_pair.private_key,
    })
}

/// Cria um fingerprint multibase/base58btc para as chaves públicas do DID.
///
/// O hash inclui os identificadores dos algoritmos para impedir reinterpretação
/// de bytes de chave sob outro perfil criptográfico.
pub fn fingerprint_from_keys(
    mldsa_profile: MlDsaProfile,
    mldsa_public_key: &[u8],
    mlkem_profile: MlKemProfile,
    mlkem_public_key: &[u8],
) -> String {
    let mut input = Vec::with_capacity(
        DID_FINGERPRINT_DOMAIN.len()
            + len_prefixed_size(mldsa_profile.as_str().as_bytes())
            + len_prefixed_size(mldsa_public_key)
            + len_prefixed_size(mlkem_profile.as_str().as_bytes())
            + len_prefixed_size(mlkem_public_key),
    );
    input.extend_from_slice(DID_FINGERPRINT_DOMAIN);
    push_len_prefixed(&mut input, mldsa_profile.as_str().as_bytes());
    push_len_prefixed(&mut input, mldsa_public_key);
    push_len_prefixed(&mut input, mlkem_profile.as_str().as_bytes());
    push_len_prefixed(&mut input, mlkem_public_key);

    multibase_base58btc_encode(&sha3_256(&input))
}

/// Assina um DID Document usando a chave privada ML-DSA informada.
///
/// A assinatura cobre a versão canônica do documento sem o campo `signature`.
pub fn sign_did_document(
    did_document: &mut DidDocument,
    mldsa_private_key: &[u8],
    mldsa_profile: MlDsaProfile,
) -> Result<()> {
    did_document.signature = None;
    let document_value = serde_json::to_value(&did_document)?;
    let canonical = canonical_json::canonical_json_bytes(&document_value);
    let signature = mldsa::sign(
        mldsa_profile,
        mldsa_private_key,
        &canonical,
        DID_DOCUMENT_SIGNATURE_CONTEXT,
    )?;

    did_document.signature = Some(DidSignature {
        alg: mldsa_profile.as_str().to_string(),
        key_id: "#mldsa-1".to_string(),
        value: encoding::base64url_encode(&signature.signature),
    });

    Ok(())
}

/// Verifica se um DID Document assinado é íntegro e coerente.
///
/// A validação confirma o fingerprint, o controlador, a chave declarada na
/// assinatura e a assinatura ML-DSA sobre o documento canônico.
pub fn verify_did_document(did_document: &DidDocument) -> Result<bool> {
    if !fingerprint_matches_keys(did_document)? {
        return Ok(false);
    }

    if did_document.controller != did_document.id {
        return Ok(false);
    }

    let signature = did_document
        .signature
        .as_ref()
        .ok_or(SsiError::MissingDidSignature)?;
    let signing_key = did_document
        .keys
        .iter()
        .find(|key| key.id == signature.key_id)
        .ok_or_else(|| SsiError::MissingDidKey(signature.key_id.clone()))?;

    if signing_key.key_type != signature.alg {
        return Ok(false);
    }

    let mldsa_profile = signature.alg.parse::<MlDsaProfile>()?;
    let public_key = multibase_base58btc_decode(&signing_key.public_key_multibase)?;
    let signature_bytes = encoding::base64url_decode(&signature.value)?;
    let mut document_without_signature = did_document.clone();
    document_without_signature.signature = None;
    let document_value = serde_json::to_value(&document_without_signature)?;
    let canonical = canonical_json::canonical_json_bytes(&document_value);

    mldsa::verify(
        mldsa_profile,
        &public_key,
        &canonical,
        DID_DOCUMENT_SIGNATURE_CONTEXT,
        &signature_bytes,
    )
}

/// Verifica se o DID corresponde ao fingerprint calculado pelas chaves públicas.
pub fn fingerprint_matches_keys(did_document: &DidDocument) -> Result<bool> {
    let mldsa_key = did_document
        .keys
        .iter()
        .find(|key| key.id == "#mldsa-1")
        .ok_or_else(|| SsiError::MissingDidKey("#mldsa-1".to_string()))?;
    let mlkem_key = did_document
        .keys
        .iter()
        .find(|key| key.id == "#mlkem-1")
        .ok_or_else(|| SsiError::MissingDidKey("#mlkem-1".to_string()))?;
    let mldsa_profile = mldsa_key.key_type.parse::<MlDsaProfile>()?;
    let mlkem_profile = mlkem_key.key_type.parse::<MlKemProfile>()?;
    let mldsa_public_key = multibase_base58btc_decode(&mldsa_key.public_key_multibase)?;
    let mlkem_public_key = multibase_base58btc_decode(&mlkem_key.public_key_multibase)?;
    let fingerprint = fingerprint_from_keys(
        mldsa_profile,
        &mldsa_public_key,
        mlkem_profile,
        &mlkem_public_key,
    );

    Ok(did_document.id == format!("{DID_METHOD_PREFIX}{fingerprint}"))
}

/// Calcula um identificador SHA3-256/Base64 para o emissor.
///
/// O identificador é derivado do DID e da chave pública ML-DSA de assinatura,
/// mantendo o DID completo disponível no JSON, mas oferecendo uma forma curta
/// e estável para exibição em PDF.
pub fn issuer_identifier_base64(did_document: &DidDocument) -> Result<String> {
    let signing_key = did_document
        .keys
        .iter()
        .find(|key| key.id == "#mldsa-1")
        .ok_or_else(|| SsiError::MissingDidKey("#mldsa-1".to_string()))?;
    let public_key = multibase_base58btc_decode(&signing_key.public_key_multibase)?;
    let mut input = Vec::new();

    input.extend_from_slice(ISSUER_IDENTIFIER_DOMAIN);
    push_labeled_len_prefixed(&mut input, b"did", did_document.id.as_bytes());
    push_labeled_len_prefixed(&mut input, b"key_id", signing_key.id.as_bytes());
    push_labeled_len_prefixed(&mut input, b"key_type", signing_key.key_type.as_bytes());
    push_labeled_len_prefixed(&mut input, b"public_key", &public_key);

    Ok(base64_encode(&sha3_256(&input)))
}

/// Converte um DID Document tipado para `serde_json::Value`.
pub fn did_document_to_json(did_document: &DidDocument) -> Result<Value> {
    Ok(serde_json::to_value(did_document)?)
}

/// Converte um `serde_json::Value` para DID Document tipado.
pub fn did_document_from_json(value: Value) -> Result<DidDocument> {
    Ok(serde_json::from_value(value)?)
}

/// Monta o objeto JSON temporário com as chaves privadas retornadas para testes.
pub fn private_keys_to_json(result: &DidCreationResult) -> Value {
    json!({
        "mldsaPrivateKey": encoding::base64url_encode(&result.mldsa_private_key),
        "mlkemPrivateKey": encoding::base64url_encode(&result.mlkem_private_key),
    })
}

fn push_len_prefixed(output: &mut Vec<u8>, field: &[u8]) {
    output.extend_from_slice(&(field.len() as u64).to_be_bytes());
    output.extend_from_slice(field);
}

fn push_labeled_len_prefixed(output: &mut Vec<u8>, label: &[u8], field: &[u8]) {
    output.extend_from_slice(b"\x1eSSI_PQ_ISSUER_IDENTIFIER_FIELD\x1f");
    push_len_prefixed(output, label);
    push_len_prefixed(output, field);
}

fn len_prefixed_size(field: &[u8]) -> usize {
    std::mem::size_of::<u64>() + field.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_options() -> DidCreateOptions {
        DidCreateOptions {
            mldsa_profile: MlDsaProfile::MlDsa65,
            mlkem_profile: MlKemProfile::MlKem768,
            created_at: "2026-05-27T00:00:00Z".to_string(),
        }
    }

    fn legacy_ambiguous_fingerprint_from_keys(
        mldsa_profile: MlDsaProfile,
        mldsa_public_key: &[u8],
        mlkem_profile: MlKemProfile,
        mlkem_public_key: &[u8],
    ) -> String {
        let mut input = Vec::new();
        input.extend_from_slice(DID_FINGERPRINT_DOMAIN);
        input.extend_from_slice(mldsa_profile.as_str().as_bytes());
        input.extend_from_slice(mldsa_public_key);
        input.extend_from_slice(mlkem_profile.as_str().as_bytes());
        input.extend_from_slice(mlkem_public_key);
        multibase_base58btc_encode(&sha3_256(&input))
    }

    #[test]
    fn fingerprint_uses_length_prefixed_fields() {
        let mldsa_public_key = [1u8; 32];
        let mlkem_public_key = [2u8; 32];
        let legacy = legacy_ambiguous_fingerprint_from_keys(
            MlDsaProfile::MlDsa65,
            &mldsa_public_key,
            MlKemProfile::MlKem768,
            &mlkem_public_key,
        );
        let length_prefixed = fingerprint_from_keys(
            MlDsaProfile::MlDsa65,
            &mldsa_public_key,
            MlKemProfile::MlKem768,
            &mlkem_public_key,
        );

        assert_ne!(length_prefixed, legacy);
    }

    #[test]
    fn create_did_builds_signed_document() {
        let result = create_did(test_options()).unwrap();

        assert!(result.did.starts_with("did:ssipq:z"));
        assert_eq!(result.did, result.did_document.id);
        assert_eq!(result.did, result.did_document.controller);
        assert_eq!(result.did_document.document_type, "ssi_pq_did_document_v1");
        assert!(result.did_document.signature.is_some());
        assert!(fingerprint_matches_keys(&result.did_document).unwrap());
        assert!(verify_did_document(&result.did_document).unwrap());
    }

    #[test]
    fn did_verification_rejects_changed_key_material() {
        let result = create_did(test_options()).unwrap();
        let mut document = result.did_document;
        document.keys[0].public_key_multibase = multibase_base58btc_encode(&[1, 2, 3]);

        assert!(!fingerprint_matches_keys(&document).unwrap());
        assert!(!verify_did_document(&document).unwrap());
    }
}
