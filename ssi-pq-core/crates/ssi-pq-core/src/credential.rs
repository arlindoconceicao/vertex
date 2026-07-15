use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    Result, SsiError, canonical_json,
    crypto::mldsa,
    did::{self, DidDocument},
    encoding::{
        base64_encode, base64url_decode, base64url_encode, multibase_base58btc_decode,
        multibase_base58btc_encode,
    },
    hash::sha3_256,
    merkle::{
        self, ATTRIBUTE_SALT_SIZE, CredentialAttribute, MerkleMultiProofNode, MerkleProof,
        MerkleProofStep,
    },
    profiles::MlDsaProfile,
    schema::{self, SchemaDocument},
};

/// Separador de domínio usado para assinatura de credenciais.
pub const CREDENTIAL_SIGNATURE_CONTEXT: &[u8] = b"SSI_CREDENTIAL_SIGNATURE_V1";
pub const SIGNED_CREDENTIAL_TYPE_V1: &str = "ssi_signed_credential_v1";
pub const SIGNED_CREDENTIAL_TYPE_V2: &str = "ssi_signed_credential_v2";
pub const ATTRIBUTE_MULTIPROOF_ALG: &str = "Merkle-SHA3-256-Multiproof-V1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignedCredentialVersion {
    V1,
    V2,
}

impl SignedCredentialVersion {
    pub fn document_type(self) -> &'static str {
        match self {
            SignedCredentialVersion::V1 => SIGNED_CREDENTIAL_TYPE_V1,
            SignedCredentialVersion::V2 => SIGNED_CREDENTIAL_TYPE_V2,
        }
    }

    pub fn from_option(value: Option<String>) -> Result<Self> {
        match value.as_deref() {
            None | Some("") | Some("v2") | Some(SIGNED_CREDENTIAL_TYPE_V2) => {
                Ok(SignedCredentialVersion::V2)
            }
            Some("v1") | Some(SIGNED_CREDENTIAL_TYPE_V1) => Ok(SignedCredentialVersion::V1),
            Some(other) => Err(SsiError::InvalidCredential(format!(
                "unsupported signed credential version: {other}"
            ))),
        }
    }
}

/// Opções usadas para emitir uma credencial assinada.
#[derive(Debug, Clone, PartialEq)]
pub struct CredentialIssueOptions {
    /// Identificador opcional da credencial.
    pub credential_id: Option<String>,
    /// Timestamp de emissão.
    pub issued_at: String,
    /// Timestamp opcional de expiração.
    pub expires_at: Option<String>,
    /// Referência opcional de status/revogação.
    pub status_ref: Option<Value>,
    /// Caminhos de atributos que serão revelados junto da credencial.
    pub visible_paths: Option<Vec<String>>,
    /// Versão do pacote de credencial assinada a ser serializado.
    pub credential_version: SignedCredentialVersion,
}

/// Credencial SSI-PQ assinável.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CredentialDocument {
    /// Tipo/versionamento lógico da credencial.
    #[serde(rename = "type")]
    pub document_type: String,
    /// Identificador único da credencial.
    pub credential_id: String,
    /// Identificador do Schema usado.
    pub schema_id: String,
    /// Hash SHA3-256/Base64 da definição lógica do Schema.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_hash: Option<String>,
    /// DID do emissor.
    pub issuer_did: String,
    /// Identificador SHA3-256/Base64 derivado da chave pública do emissor.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issuer_identifier: Option<String>,
    /// Compromissos de atributos da credencial.
    pub subject: CredentialSubject,
    /// Compromisso Merkle dos atributos.
    pub attributes_commitment: AttributesCommitment,
    /// Timestamp de emissão.
    pub issued_at: String,
    /// Timestamp opcional de expiração.
    pub expires_at: Option<String>,
    /// Referência opcional de status/revogação.
    pub status_ref: Option<Value>,
}

/// Dados de assunto gravados na credencial.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CredentialSubject {
    /// Hashes de folhas dos atributos comprometidos.
    pub attribute_hashes: Vec<CredentialAttributeHash>,
}

/// Hash de atributo comprometido pela credencial.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CredentialAttributeHash {
    /// Caminho canônico do atributo.
    pub path: String,
    /// Algoritmo usado para gerar o hash.
    pub alg: String,
    /// Hash da folha em base64url sem padding.
    pub hash: String,
}

/// Compromisso Merkle gravado na credencial.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttributesCommitment {
    /// Algoritmo da árvore de Merkle.
    pub alg: String,
    /// Merkle root em base64url sem padding.
    pub root: String,
}

/// Assinatura ML-DSA da credencial.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CredentialSignature {
    /// Algoritmo ML-DSA usado.
    pub alg: String,
    /// Identificador local da chave no DID Document.
    pub key_id: String,
    /// Chave pública do assinante codificada em multibase/base58btc.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_key_multibase: Option<String>,
    /// Assinatura em base64url sem padding.
    pub signature: String,
}

/// Credencial assinada e acompanhada de atributos revelados.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignedCredential {
    /// Tipo/versionamento lógico do pacote.
    #[serde(rename = "type")]
    pub document_type: String,
    /// Credencial assinada.
    pub credential: CredentialDocument,
    /// Assinatura da credencial canônica.
    pub credential_signature: CredentialSignature,
    /// Atributos revelados com salt e prova Merkle.
    pub attribute_disclosures: Vec<AttributeDisclosure>,
    /// Prova Merkle compartilhada usada pelo formato v2.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribute_multiproof: Option<AttributeMultiproof>,
}

/// Atributo revelado para verificação seletiva.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AttributeDisclosure {
    /// Caminho canônico do atributo.
    pub path: String,
    /// Tipo primitivo do atributo.
    #[serde(rename = "type")]
    pub attr_type: String,
    /// Valor JSON revelado.
    pub value: Value,
    /// Salt do atributo em base64url sem padding.
    pub salt: String,
    /// Hash da folha em base64url sem padding.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leaf_hash: Option<String>,
    /// Prova Merkle até a root da credencial.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proof: Option<Vec<MerkleProofStep>>,
}

/// Multiprova Merkle deduplicada para atributos revelados.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AttributeMultiproof {
    /// Algoritmo lógico da multiprova.
    pub alg: String,
    /// Quantidade total de folhas na árvore comprometida.
    pub leaf_count: usize,
    /// Nós irmãos compartilhados necessários para reconstruir a Merkle root.
    pub proof_nodes: Vec<MerkleMultiProofNode>,
}

/// Emite uma credencial assinada a partir de um Schema e atributos preenchidos.
///
/// A função valida os atributos contra o Schema, calcula salts de 32 bytes,
/// constrói a Merkle root e assina a credencial canônica com ML-DSA.
pub fn issue_credential_from_schema(
    schema: &SchemaDocument,
    attributes: &Value,
    issuer_did_document: &DidDocument,
    issuer_private_key: &[u8],
    options: CredentialIssueOptions,
) -> Result<SignedCredential> {
    let issued_at = crate::time::parse_rfc3339_timestamp("issued_at", &options.issued_at)
        .map_err(SsiError::InvalidCredential)?;
    if let Some(expires_at) = &options.expires_at {
        let expires_at = crate::time::parse_rfc3339_timestamp("expires_at", expires_at)
            .map_err(SsiError::InvalidCredential)?;
        if expires_at < issued_at {
            return Err(SsiError::InvalidCredential(
                "expires_at must be greater than or equal to issued_at".to_string(),
            ));
        }
    }

    if !did::verify_did_document(issuer_did_document)? {
        return Err(SsiError::InvalidDidDocument(
            "issuer DID document is not valid".to_string(),
        ));
    }
    schema::validate_attributes_against_schema(schema, attributes)?;

    let (signing_profile, signing_public_key) =
        issuer_signing_key(issuer_did_document, "#mldsa-1")?;
    let credential_id = match options.credential_id {
        Some(credential_id) => credential_id,
        None => generated_credential_id(
            &signing_public_key,
            schema,
            attributes,
            options.issued_at.as_str(),
        )?,
    };
    let credential_attributes = credential_attributes_from_schema(schema, attributes)?;
    let tree =
        merkle::build_merkle_tree(&schema.schema_id, &credential_id, &credential_attributes)?;
    let root = merkle::merkle_root(&tree)?;
    let root_encoded = base64url_encode(&root);
    let attribute_hashes = tree
        .leaves
        .iter()
        .map(|leaf| CredentialAttributeHash {
            path: leaf.path.clone(),
            alg: "SHA3-256".to_string(),
            hash: base64url_encode(&leaf.hash),
        })
        .collect::<Vec<_>>();

    let credential = CredentialDocument {
        document_type: "ssi_credential_v1".to_string(),
        credential_id,
        schema_id: schema.schema_id.clone(),
        schema_hash: Some(schema::schema_hash_base64(schema)?),
        issuer_did: issuer_did_document.id.clone(),
        issuer_identifier: Some(did::issuer_identifier_base64(issuer_did_document)?),
        subject: CredentialSubject { attribute_hashes },
        attributes_commitment: AttributesCommitment {
            alg: "Merkle-SHA3-256".to_string(),
            root: root_encoded,
        },
        issued_at: options.issued_at,
        expires_at: options.expires_at,
        status_ref: options.status_ref,
    };

    let credential_value = serde_json::to_value(&credential)?;
    let canonical = canonical_json::canonical_json_bytes(&credential_value);
    let signature = mldsa::sign(
        signing_profile,
        issuer_private_key,
        &canonical,
        CREDENTIAL_SIGNATURE_CONTEXT,
    )?;
    let visible_paths = normalize_visible_paths(options.visible_paths, &credential_attributes)?;
    let attribute_disclosures = match options.credential_version {
        SignedCredentialVersion::V1 => {
            build_legacy_attribute_disclosures(&credential_attributes, &tree, &visible_paths)?
        }
        SignedCredentialVersion::V2 => {
            build_attribute_disclosures(&credential_attributes, &visible_paths)?
        }
    };
    let attribute_multiproof = match options.credential_version {
        SignedCredentialVersion::V1 => None,
        SignedCredentialVersion::V2 => {
            let multiproof = merkle::merkle_multiproof(&tree, &visible_paths)?;
            Some(AttributeMultiproof {
                alg: ATTRIBUTE_MULTIPROOF_ALG.to_string(),
                leaf_count: multiproof.leaf_count,
                proof_nodes: multiproof.proof_nodes,
            })
        }
    };

    Ok(SignedCredential {
        document_type: options.credential_version.document_type().to_string(),
        credential,
        credential_signature: CredentialSignature {
            alg: signing_profile.as_str().to_string(),
            key_id: "#mldsa-1".to_string(),
            public_key_multibase: Some(multibase_base58btc_encode(&signing_public_key)),
            signature: base64url_encode(&signature.signature),
        },
        attribute_disclosures,
        attribute_multiproof,
    })
}

/// Verifica uma credencial assinada usando o DID Document público do emissor.
///
/// A verificação cobre o DID do emissor, a assinatura ML-DSA da credencial e as
/// provas Merkle de todos os atributos revelados.
pub fn verify_signed_credential(
    signed_credential: &SignedCredential,
    issuer_did_document: &DidDocument,
) -> Result<bool> {
    if signed_credential.document_type != SIGNED_CREDENTIAL_TYPE_V1
        && signed_credential.document_type != SIGNED_CREDENTIAL_TYPE_V2
    {
        return Ok(false);
    }
    if signed_credential.credential.document_type != "ssi_credential_v1" {
        return Ok(false);
    }
    if signed_credential.credential.issuer_did != issuer_did_document.id {
        return Ok(false);
    }
    if !did::verify_did_document(issuer_did_document)? {
        return Ok(false);
    }

    let (profile, public_key) = issuer_signing_key(
        issuer_did_document,
        &signed_credential.credential_signature.key_id,
    )?;
    if signed_credential.credential_signature.alg != profile.as_str() {
        return Ok(false);
    }
    if signed_credential
        .credential_signature
        .public_key_multibase
        .as_ref()
        .is_some_and(|declared| declared != &multibase_base58btc_encode(&public_key))
    {
        return Ok(false);
    }
    if signed_credential
        .credential
        .issuer_identifier
        .as_ref()
        .is_some_and(|declared| {
            did::issuer_identifier_base64(issuer_did_document)
                .map(|expected| declared != &expected)
                .unwrap_or(true)
        })
    {
        return Ok(false);
    }

    let signature = base64url_decode(&signed_credential.credential_signature.signature)?;
    let credential_value = serde_json::to_value(&signed_credential.credential)?;
    let canonical = canonical_json::canonical_json_bytes(&credential_value);
    if !mldsa::verify(
        profile,
        &public_key,
        &canonical,
        CREDENTIAL_SIGNATURE_CONTEXT,
        &signature,
    )? {
        return Ok(false);
    }

    match signed_credential.document_type.as_str() {
        SIGNED_CREDENTIAL_TYPE_V1 => verify_legacy_attribute_disclosures(signed_credential),
        SIGNED_CREDENTIAL_TYPE_V2 => verify_attribute_disclosures(signed_credential),
        _ => Ok(false),
    }
}

/// Converte uma credencial assinada tipada para `serde_json::Value`.
pub fn signed_credential_to_json(signed_credential: &SignedCredential) -> Result<Value> {
    Ok(serde_json::to_value(signed_credential)?)
}

/// Converte um `serde_json::Value` para credencial assinada tipada.
pub fn signed_credential_from_json(value: Value) -> Result<SignedCredential> {
    Ok(serde_json::from_value(value)?)
}

/// Calcula o hash canônico da credencial assinável.
pub fn credential_hash(credential: &CredentialDocument) -> Result<[u8; 32]> {
    let value = serde_json::to_value(credential)?;
    Ok(sha3_256(&canonical_json::canonical_json_bytes(&value)))
}

fn credential_attributes_from_schema(
    schema: &SchemaDocument,
    attributes: &Value,
) -> Result<Vec<CredentialAttribute>> {
    schema
        .attributes
        .iter()
        .map(|schema_attribute| {
            let value = schema::value_for_schema_path(attributes, &schema_attribute.path)?;
            Ok(CredentialAttribute {
                path: schema_attribute.path.clone(),
                attr_type: schema_attribute.attr_type.clone(),
                value: value.clone(),
                salt: merkle::generate_attribute_salt()?,
            })
        })
        .collect()
}

fn build_attribute_disclosures(
    attributes: &[CredentialAttribute],
    visible_paths: &[String],
) -> Result<Vec<AttributeDisclosure>> {
    visible_paths
        .iter()
        .map(|path| {
            let attribute = attributes
                .iter()
                .find(|attribute| attribute.path == *path)
                .ok_or_else(|| SsiError::MissingAttribute(path.clone()))?;

            Ok(AttributeDisclosure {
                path: attribute.path.clone(),
                attr_type: attribute.attr_type.clone(),
                value: attribute.value.clone(),
                salt: base64url_encode(&attribute.salt),
                leaf_hash: None,
                proof: None,
            })
        })
        .collect()
}

fn build_legacy_attribute_disclosures(
    attributes: &[CredentialAttribute],
    tree: &merkle::MerkleTree,
    visible_paths: &[String],
) -> Result<Vec<AttributeDisclosure>> {
    visible_paths
        .iter()
        .map(|path| {
            let attribute = attributes
                .iter()
                .find(|attribute| attribute.path == *path)
                .ok_or_else(|| SsiError::MissingAttribute(path.clone()))?;
            let proof = merkle::merkle_proof(tree, path)?;

            Ok(AttributeDisclosure {
                path: attribute.path.clone(),
                attr_type: attribute.attr_type.clone(),
                value: attribute.value.clone(),
                salt: base64url_encode(&attribute.salt),
                leaf_hash: Some(proof.leaf_hash),
                proof: Some(proof.proof),
            })
        })
        .collect()
}

fn verify_legacy_attribute_disclosures(signed_credential: &SignedCredential) -> Result<bool> {
    let expected_root = base64url_decode(&signed_credential.credential.attributes_commitment.root)?;

    for disclosure in &signed_credential.attribute_disclosures {
        let salt = base64url_decode(&disclosure.salt)?;
        if salt.len() != ATTRIBUTE_SALT_SIZE {
            return Ok(false);
        }
        let Some(leaf_hash) = &disclosure.leaf_hash else {
            return Ok(false);
        };
        let Some(proof_steps) = &disclosure.proof else {
            return Ok(false);
        };

        let proof = MerkleProof {
            path: disclosure.path.clone(),
            leaf_hash: leaf_hash.clone(),
            proof: proof_steps.clone(),
        };
        let proof_valid = merkle::verify_merkle_proof(
            &signed_credential.credential.schema_id,
            &signed_credential.credential.credential_id,
            &disclosure.path,
            &disclosure.attr_type,
            &disclosure.value,
            &salt,
            &proof,
            &expected_root,
        )?;
        if !proof_valid {
            return Ok(false);
        }

        let declared_hash = signed_credential
            .credential
            .subject
            .attribute_hashes
            .iter()
            .find(|hash| hash.path == disclosure.path)
            .ok_or_else(|| SsiError::MissingAttribute(disclosure.path.clone()))?;
        if declared_hash.hash != *leaf_hash {
            return Ok(false);
        }
    }

    Ok(true)
}

fn verify_attribute_disclosures(signed_credential: &SignedCredential) -> Result<bool> {
    let expected_root = base64url_decode(&signed_credential.credential.attributes_commitment.root)?;
    let Some(multiproof) = &signed_credential.attribute_multiproof else {
        return Ok(false);
    };
    // Defesa obrigatória contra ambiguidade estrutural de árvores que duplicam
    // o último nó em níveis ímpares: a geometria da multiprova deve corresponder
    // exatamente ao array de folhas coberto pela assinatura da credencial.
    if multiproof.alg != ATTRIBUTE_MULTIPROOF_ALG
        || multiproof.leaf_count != signed_credential.credential.subject.attribute_hashes.len()
    {
        return Ok(false);
    }

    if signed_credential.attribute_disclosures.is_empty() {
        return Ok(multiproof.proof_nodes.is_empty());
    }

    let mut disclosed_leaves = Vec::with_capacity(signed_credential.attribute_disclosures.len());
    let mut disclosed_paths = std::collections::BTreeSet::new();

    for disclosure in &signed_credential.attribute_disclosures {
        if !disclosed_paths.insert(disclosure.path.clone()) {
            return Ok(false);
        }

        let salt = base64url_decode(&disclosure.salt)?;
        if salt.len() != ATTRIBUTE_SALT_SIZE {
            return Ok(false);
        }

        let leaf_hash = merkle::attribute_leaf_hash(
            &signed_credential.credential.schema_id,
            &signed_credential.credential.credential_id,
            &disclosure.path,
            &disclosure.attr_type,
            &disclosure.value,
            &salt,
        )?;
        let leaf_hash_encoded = base64url_encode(&leaf_hash);
        if disclosure
            .leaf_hash
            .as_ref()
            .is_some_and(|declared| declared != &leaf_hash_encoded)
        {
            return Ok(false);
        }

        let Some((leaf_index, declared_hash)) = signed_credential
            .credential
            .subject
            .attribute_hashes
            .iter()
            .enumerate()
            .find(|(_, hash)| hash.path == disclosure.path)
        else {
            return Err(SsiError::MissingAttribute(disclosure.path.clone()));
        };
        if declared_hash.hash != leaf_hash_encoded {
            return Ok(false);
        }

        disclosed_leaves.push((leaf_index, leaf_hash));
    }

    merkle::verify_merkle_multiproof(
        multiproof.leaf_count,
        &disclosed_leaves,
        &multiproof.proof_nodes,
        &expected_root,
    )
}

fn issuer_signing_key(
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

fn normalize_visible_paths(
    visible_paths: Option<Vec<String>>,
    attributes: &[CredentialAttribute],
) -> Result<Vec<String>> {
    let mut paths = match visible_paths {
        Some(paths) => paths
            .into_iter()
            .map(|path| {
                if path.starts_with("subject.") {
                    path
                } else {
                    format!("subject.{path}")
                }
            })
            .collect::<Vec<_>>(),
        None => attributes
            .iter()
            .map(|attribute| attribute.path.clone())
            .collect::<Vec<_>>(),
    };
    paths.sort();
    paths.dedup();

    for path in &paths {
        if !attributes.iter().any(|attribute| attribute.path == *path) {
            return Err(SsiError::MissingAttribute(path.clone()));
        }
    }

    Ok(paths)
}

fn generated_credential_id(
    issuer_public_key: &[u8],
    schema: &SchemaDocument,
    attributes: &Value,
    issued_at: &str,
) -> Result<String> {
    let schema_value = serde_json::to_value(schema)?;
    let schema_canonical = canonical_json::canonical_json_bytes(&schema_value);
    let attributes_canonical = canonical_json::canonical_json_bytes(attributes);
    let mut input = Vec::new();

    input.extend_from_slice(b"SSI_PQ_CREDENTIAL_ID_SHA3_256_V1");
    push_credential_id_component(&mut input, b"issuer_public_key", issuer_public_key);
    push_credential_id_component(&mut input, b"schema", &schema_canonical);
    push_credential_id_component(&mut input, b"attributes", &attributes_canonical);
    push_credential_id_component(&mut input, b"issued_at", issued_at.as_bytes());

    Ok(base64_encode(&sha3_256(&input)))
}

fn push_credential_id_component(input: &mut Vec<u8>, label: &[u8], value: &[u8]) {
    input.extend_from_slice(b"\x1eSSI_PQ_CREDENTIAL_ID_FIELD\x1f");
    input.extend_from_slice(&(label.len() as u64).to_be_bytes());
    input.extend_from_slice(label);
    input.extend_from_slice(&(value.len() as u64).to_be_bytes());
    input.extend_from_slice(value);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        did::{DidCreateOptions, create_did},
        schema::{SchemaCreateOptions, create_schema_from_attributes},
    };
    use serde_json::json;

    fn issuer() -> crate::did::DidCreationResult {
        create_did(DidCreateOptions {
            mldsa_profile: MlDsaProfile::MlDsa65,
            mlkem_profile: crate::profiles::MlKemProfile::MlKem768,
            created_at: "2026-05-27T00:00:00Z".to_string(),
        })
        .unwrap()
    }

    fn schema() -> SchemaDocument {
        create_schema_from_attributes(
            &json!({"nome": "Ana", "idade": 30}),
            SchemaCreateOptions {
                version: "1".to_string(),
                created_at: "2026-05-27T00:00:00Z".to_string(),
            },
        )
        .unwrap()
    }

    #[test]
    fn signed_credential_verifies() {
        let issuer = issuer();
        let signed = issue_credential_from_schema(
            &schema(),
            &json!({"nome": "Ana", "idade": 30}),
            &issuer.did_document,
            &issuer.mldsa_private_key,
            CredentialIssueOptions {
                credential_id: Some("cred_test".to_string()),
                issued_at: "2026-05-27T00:00:00Z".to_string(),
                expires_at: None,
                status_ref: None,
                visible_paths: None,
                credential_version: SignedCredentialVersion::V2,
            },
        )
        .unwrap();

        assert!(verify_signed_credential(&signed, &issuer.did_document).unwrap());
        assert_eq!(signed.document_type, SIGNED_CREDENTIAL_TYPE_V2);
        assert_eq!(signed.attribute_disclosures.len(), 2);
        assert!(signed.attribute_multiproof.is_some());
        assert!(
            signed
                .attribute_disclosures
                .iter()
                .all(|disclosure| disclosure.leaf_hash.is_none() && disclosure.proof.is_none())
        );
    }

    #[test]
    fn signed_credential_rejects_changed_merkle_root() {
        let issuer = issuer();
        let mut signed = issue_credential_from_schema(
            &schema(),
            &json!({"nome": "Ana", "idade": 30}),
            &issuer.did_document,
            &issuer.mldsa_private_key,
            CredentialIssueOptions {
                credential_id: Some("cred_test".to_string()),
                issued_at: "2026-05-27T00:00:00Z".to_string(),
                expires_at: None,
                status_ref: None,
                visible_paths: None,
                credential_version: SignedCredentialVersion::V2,
            },
        )
        .unwrap();
        signed.credential.attributes_commitment.root = base64url_encode(&[9u8; 32]);

        assert!(!verify_signed_credential(&signed, &issuer.did_document).unwrap());
    }

    #[test]
    fn legacy_signed_credential_v1_still_verifies() {
        let issuer = issuer();
        let signed = issue_credential_from_schema(
            &schema(),
            &json!({"nome": "Ana", "idade": 30}),
            &issuer.did_document,
            &issuer.mldsa_private_key,
            CredentialIssueOptions {
                credential_id: Some("cred_test".to_string()),
                issued_at: "2026-05-27T00:00:00Z".to_string(),
                expires_at: None,
                status_ref: None,
                visible_paths: Some(vec!["nome".to_string()]),
                credential_version: SignedCredentialVersion::V1,
            },
        )
        .unwrap();

        assert_eq!(signed.document_type, SIGNED_CREDENTIAL_TYPE_V1);
        assert!(signed.attribute_multiproof.is_none());
        assert_eq!(signed.attribute_disclosures.len(), 1);
        assert!(signed.attribute_disclosures[0].leaf_hash.is_some());
        assert!(signed.attribute_disclosures[0].proof.is_some());
        assert!(verify_signed_credential(&signed, &issuer.did_document).unwrap());
    }

    #[test]
    fn signed_credential_v2_rejects_changed_multiproof() {
        let issuer = issuer();
        let mut signed = issue_credential_from_schema(
            &schema(),
            &json!({"nome": "Ana", "idade": 30}),
            &issuer.did_document,
            &issuer.mldsa_private_key,
            CredentialIssueOptions {
                credential_id: Some("cred_test".to_string()),
                issued_at: "2026-05-27T00:00:00Z".to_string(),
                expires_at: None,
                status_ref: None,
                visible_paths: Some(vec!["nome".to_string()]),
                credential_version: SignedCredentialVersion::V2,
            },
        )
        .unwrap();

        let multiproof = signed
            .attribute_multiproof
            .as_mut()
            .expect("v2 credential contains multiproof");
        assert_eq!(multiproof.proof_nodes.len(), 1);
        multiproof.proof_nodes[0].hash = base64url_encode(&[7u8; 32]);

        assert!(!verify_signed_credential(&signed, &issuer.did_document).unwrap());
    }

    #[test]
    fn signed_credential_v2_rejects_changed_multiproof_leaf_count() {
        let issuer = issuer();
        let mut signed = issue_credential_from_schema(
            &schema(),
            &json!({"nome": "Ana", "idade": 30}),
            &issuer.did_document,
            &issuer.mldsa_private_key,
            CredentialIssueOptions {
                credential_id: Some("cred_test".to_string()),
                issued_at: "2026-05-27T00:00:00Z".to_string(),
                expires_at: None,
                status_ref: None,
                visible_paths: Some(vec!["nome".to_string()]),
                credential_version: SignedCredentialVersion::V2,
            },
        )
        .unwrap();

        let multiproof = signed
            .attribute_multiproof
            .as_mut()
            .expect("v2 credential contains multiproof");
        assert_eq!(
            multiproof.leaf_count,
            signed.credential.subject.attribute_hashes.len()
        );
        multiproof.leaf_count += 1;

        assert!(!verify_signed_credential(&signed, &issuer.did_document).unwrap());
    }
}
