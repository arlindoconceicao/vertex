use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use zeroize::Zeroize;

use crate::{Result, SsiError, canonical_json, encoding, hash::sha3_256, random::random_array};

/// Separador de domínio usado para folhas de atributos.
pub const ATTRIBUTE_LEAF_DOMAIN: &[u8] = b"SSI_ATTR_V1";

/// Separador de domínio usado para nós internos da árvore de Merkle.
pub const MERKLE_NODE_DOMAIN: &[u8] = b"SSI_MERKLE_NODE_V1";

/// Tamanho em bytes do salt de cada atributo.
pub const ATTRIBUTE_SALT_SIZE: usize = 32;

/// Atributo preparado para entrar na árvore de Merkle.
#[derive(Debug, Clone, PartialEq)]
pub struct CredentialAttribute {
    /// Caminho canônico do atributo.
    pub path: String,
    /// Tipo primitivo declarado pelo Schema.
    pub attr_type: String,
    /// Valor JSON do atributo.
    pub value: Value,
    /// Salt bruto de 32 bytes usado no hash da folha.
    pub salt: Vec<u8>,
}

impl Drop for CredentialAttribute {
    fn drop(&mut self) {
        self.salt.zeroize();
    }
}

/// Folha calculada da árvore de Merkle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MerkleLeaf {
    /// Caminho canônico do atributo.
    pub path: String,
    /// Hash SHA3-256 da folha.
    pub hash: [u8; 32],
}

/// Árvore de Merkle calculada para uma credencial.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MerkleTree {
    /// Folhas ordenadas por caminho.
    pub leaves: Vec<MerkleLeaf>,
    /// Níveis da árvore, começando pelas folhas e terminando pela root.
    pub levels: Vec<Vec<[u8; 32]>>,
}

/// Item de prova Merkle serializável.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MerkleProofStep {
    /// Posição do hash irmão em relação ao hash corrente: `left` ou `right`.
    pub position: String,
    /// Hash irmão em base64url sem padding.
    pub hash: String,
}

/// Prova de inclusão de um atributo em uma Merkle root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MerkleProof {
    /// Caminho canônico do atributo revelado.
    pub path: String,
    /// Hash da folha em base64url sem padding.
    pub leaf_hash: String,
    /// Caminho de hashes irmãos até a root.
    pub proof: Vec<MerkleProofStep>,
}

/// Nó irmão compartilhado por uma multiprova Merkle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MerkleMultiProofNode {
    /// Nível da árvore, começando nas folhas (`0`).
    pub level: usize,
    /// Índice do nó dentro do nível.
    pub index: usize,
    /// Hash do nó em base64url sem padding.
    pub hash: String,
}

/// Prova Merkle compartilhada para um conjunto de atributos revelados.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MerkleMultiProof {
    /// Quantidade total de folhas na árvore comprometida.
    pub leaf_count: usize,
    /// Nós irmãos necessários para reconstruir a root dos atributos revelados.
    pub proof_nodes: Vec<MerkleMultiProofNode>,
}

/// Gera um salt aleatório de 32 bytes para um atributo.
pub fn generate_attribute_salt() -> Result<Vec<u8>> {
    Ok(random_array::<ATTRIBUTE_SALT_SIZE>()?.to_vec())
}

/// Calcula o hash da folha Merkle de um atributo.
///
/// A fórmula segue o desenho do core: domínio, `schema_id`, `credential_id`,
/// caminho do atributo, tipo, JSON canônico do valor e salt de 32 bytes.
pub fn attribute_leaf_hash(
    schema_id: &str,
    credential_id: &str,
    attr_path: &str,
    attr_type: &str,
    attr_value: &Value,
    salt: &[u8],
) -> Result<[u8; 32]> {
    if salt.len() != ATTRIBUTE_SALT_SIZE {
        return Err(SsiError::InvalidLength {
            kind: "attribute salt",
            expected: ATTRIBUTE_SALT_SIZE,
            actual: salt.len(),
        });
    }

    let canonical_value = canonical_json::canonical_json_bytes(attr_value);
    let mut input = Vec::with_capacity(
        ATTRIBUTE_LEAF_DOMAIN.len()
            + len_prefixed_size(schema_id.as_bytes())
            + len_prefixed_size(credential_id.as_bytes())
            + len_prefixed_size(attr_path.as_bytes())
            + len_prefixed_size(attr_type.as_bytes())
            + len_prefixed_size(&canonical_value)
            + salt.len(),
    );
    input.extend_from_slice(ATTRIBUTE_LEAF_DOMAIN);
    push_len_prefixed(&mut input, schema_id.as_bytes());
    push_len_prefixed(&mut input, credential_id.as_bytes());
    push_len_prefixed(&mut input, attr_path.as_bytes());
    push_len_prefixed(&mut input, attr_type.as_bytes());
    push_len_prefixed(&mut input, &canonical_value);
    input.extend_from_slice(salt);

    Ok(sha3_256(&input))
}

/// Constrói a árvore de Merkle para os atributos de uma credencial.
///
/// As folhas são ordenadas por caminho antes da construção da árvore. Quando um
/// nível tem quantidade ímpar de nós, o último hash é duplicado.
pub fn build_merkle_tree(
    schema_id: &str,
    credential_id: &str,
    attributes: &[CredentialAttribute],
) -> Result<MerkleTree> {
    if attributes.is_empty() {
        return Err(SsiError::InvalidCredential(
            "credential must contain at least one attribute".to_string(),
        ));
    }

    let mut sorted = attributes.to_vec();
    sorted.sort_by(|left, right| left.path.cmp(&right.path));

    let leaves = sorted
        .iter()
        .map(|attribute| {
            Ok(MerkleLeaf {
                path: attribute.path.clone(),
                hash: attribute_leaf_hash(
                    schema_id,
                    credential_id,
                    &attribute.path,
                    &attribute.attr_type,
                    &attribute.value,
                    &attribute.salt,
                )?,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    let mut levels = vec![leaves.iter().map(|leaf| leaf.hash).collect::<Vec<_>>()];
    while levels.last().map_or(0, Vec::len) > 1 {
        let current = levels.last().expect("levels contains at least leaves");
        let mut next = Vec::with_capacity(current.len().div_ceil(2));

        for chunk in current.chunks(2) {
            let left = chunk[0];
            let right = *chunk.get(1).unwrap_or(&left);
            next.push(parent_hash(&left, &right));
        }

        levels.push(next);
    }

    Ok(MerkleTree { leaves, levels })
}

/// Retorna a Merkle root de uma árvore calculada.
pub fn merkle_root(tree: &MerkleTree) -> Result<[u8; 32]> {
    tree.levels
        .last()
        .and_then(|level| level.first())
        .copied()
        .ok_or_else(|| SsiError::InvalidCredential("empty Merkle tree".to_string()))
}

/// Gera a prova de inclusão de um atributo pela sua `path`.
pub fn merkle_proof(tree: &MerkleTree, path: &str) -> Result<MerkleProof> {
    let mut index = tree
        .leaves
        .iter()
        .position(|leaf| leaf.path == path)
        .ok_or_else(|| SsiError::MissingAttribute(path.to_string()))?;
    let leaf_hash = tree.leaves[index].hash;
    let mut proof = Vec::new();

    for level in &tree.levels {
        if level.len() == 1 {
            break;
        }

        let is_left = index % 2 == 0;
        let sibling_index = if is_left { index + 1 } else { index - 1 };
        let sibling = *level.get(sibling_index).unwrap_or(&level[index]);
        proof.push(MerkleProofStep {
            position: if is_left { "right" } else { "left" }.to_string(),
            hash: encoding::base64url_encode(&sibling),
        });
        index /= 2;
    }

    Ok(MerkleProof {
        path: path.to_string(),
        leaf_hash: encoding::base64url_encode(&leaf_hash),
        proof,
    })
}

/// Gera uma multiprova Merkle deduplicada para os atributos revelados.
pub fn merkle_multiproof(tree: &MerkleTree, paths: &[String]) -> Result<MerkleMultiProof> {
    let mut current = BTreeSet::new();
    for path in paths {
        let index = tree
            .leaves
            .iter()
            .position(|leaf| leaf.path == *path)
            .ok_or_else(|| SsiError::MissingAttribute(path.clone()))?;
        current.insert(index);
    }

    let mut proof_positions = BTreeSet::new();
    let mut proof_nodes = Vec::new();

    for (level_index, level) in tree.levels.iter().enumerate() {
        if level.len() == 1 || current.is_empty() {
            break;
        }

        let mut next = BTreeSet::new();
        for index in current.iter().copied() {
            let is_left = index % 2 == 0;
            let sibling_index = if is_left { index + 1 } else { index - 1 };

            if sibling_index < level.len()
                && !current.contains(&sibling_index)
                && proof_positions.insert((level_index, sibling_index))
            {
                proof_nodes.push(MerkleMultiProofNode {
                    level: level_index,
                    index: sibling_index,
                    hash: encoding::base64url_encode(&level[sibling_index]),
                });
            }

            next.insert(index / 2);
        }

        current = next;
    }

    Ok(MerkleMultiProof {
        leaf_count: tree.leaves.len(),
        proof_nodes,
    })
}

/// Verifica uma prova de inclusão de atributo contra uma Merkle root esperada.
pub fn verify_merkle_proof(
    schema_id: &str,
    credential_id: &str,
    attr_path: &str,
    attr_type: &str,
    attr_value: &Value,
    salt: &[u8],
    proof: &MerkleProof,
    expected_root: &[u8],
) -> Result<bool> {
    if proof.path != attr_path {
        return Ok(false);
    }

    let mut current = attribute_leaf_hash(
        schema_id,
        credential_id,
        attr_path,
        attr_type,
        attr_value,
        salt,
    )?;
    if proof.leaf_hash != encoding::base64url_encode(&current) {
        return Ok(false);
    }

    for step in &proof.proof {
        let sibling = encoding::base64url_decode(&step.hash)?;
        let sibling: [u8; 32] =
            sibling
                .as_slice()
                .try_into()
                .map_err(|_| SsiError::InvalidLength {
                    kind: "Merkle proof hash",
                    expected: 32,
                    actual: sibling.len(),
                })?;

        current = match step.position.as_str() {
            "left" => parent_hash(&sibling, &current),
            "right" => parent_hash(&current, &sibling),
            other => {
                return Err(SsiError::InvalidCredential(format!(
                    "invalid Merkle proof position: {other}"
                )));
            }
        };
    }

    Ok(current.as_slice() == expected_root)
}

/// Verifica uma multiprova Merkle a partir das folhas reveladas.
pub fn verify_merkle_multiproof(
    leaf_count: usize,
    disclosed_leaves: &[(usize, [u8; 32])],
    proof_nodes: &[MerkleMultiProofNode],
    expected_root: &[u8],
) -> Result<bool> {
    if leaf_count == 0 || expected_root.len() != 32 {
        return Ok(false);
    }
    if disclosed_leaves.is_empty() {
        return Ok(proof_nodes.is_empty());
    }

    let widths = merkle_level_widths(leaf_count);
    let mut levels = vec![BTreeMap::<usize, [u8; 32]>::new(); widths.len()];

    for (index, hash) in disclosed_leaves {
        if *index >= leaf_count {
            return Ok(false);
        }
        if insert_known_node(&mut levels[0], *index, *hash).is_err() {
            return Ok(false);
        }
    }

    for node in proof_nodes {
        if node.level + 1 >= widths.len() || node.index >= widths[node.level] {
            return Ok(false);
        }
        let hash = encoding::base64url_decode(&node.hash)?;
        let hash: [u8; 32] = hash
            .as_slice()
            .try_into()
            .map_err(|_| SsiError::InvalidLength {
                kind: "Merkle multiproof node hash",
                expected: 32,
                actual: hash.len(),
            })?;
        if insert_known_node(&mut levels[node.level], node.index, hash).is_err() {
            return Ok(false);
        }
    }

    for level_index in 0..(widths.len() - 1) {
        let indices = levels[level_index].keys().copied().collect::<Vec<usize>>();
        for index in indices {
            let current = *levels[level_index]
                .get(&index)
                .expect("index was collected from the same map");
            let sibling_index = if index % 2 == 0 { index + 1 } else { index - 1 };
            let sibling = if sibling_index >= widths[level_index] {
                current
            } else {
                match levels[level_index].get(&sibling_index) {
                    Some(sibling) => *sibling,
                    None => return Ok(false),
                }
            };
            let parent = if index % 2 == 0 {
                parent_hash(&current, &sibling)
            } else {
                parent_hash(&sibling, &current)
            };

            if insert_known_node(&mut levels[level_index + 1], index / 2, parent).is_err() {
                return Ok(false);
            }
        }
    }

    Ok(levels
        .last()
        .and_then(|level| level.get(&0))
        .is_some_and(|root| root.as_slice() == expected_root))
}

fn merkle_level_widths(leaf_count: usize) -> Vec<usize> {
    let mut widths = vec![leaf_count];
    while *widths.last().expect("widths has leaf count") > 1 {
        let current = *widths.last().expect("widths has current level");
        widths.push(current.div_ceil(2));
    }
    widths
}

fn insert_known_node(
    level: &mut BTreeMap<usize, [u8; 32]>,
    index: usize,
    hash: [u8; 32],
) -> std::result::Result<(), ()> {
    match level.get(&index) {
        Some(existing) if *existing != hash => Err(()),
        Some(_) => Ok(()),
        None => {
            level.insert(index, hash);
            Ok(())
        }
    }
}

fn parent_hash(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut input = Vec::with_capacity(MERKLE_NODE_DOMAIN.len() + left.len() + right.len());
    input.extend_from_slice(MERKLE_NODE_DOMAIN);
    input.extend_from_slice(left);
    input.extend_from_slice(right);
    sha3_256(&input)
}

fn push_len_prefixed(output: &mut Vec<u8>, field: &[u8]) {
    output.extend_from_slice(&(field.len() as u64).to_be_bytes());
    output.extend_from_slice(field);
}

fn len_prefixed_size(field: &[u8]) -> usize {
    std::mem::size_of::<u64>() + field.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn attributes() -> Vec<CredentialAttribute> {
        vec![
            CredentialAttribute {
                path: "subject.nome".to_string(),
                attr_type: "string".to_string(),
                value: json!("Ana"),
                salt: vec![1u8; ATTRIBUTE_SALT_SIZE],
            },
            CredentialAttribute {
                path: "subject.idade".to_string(),
                attr_type: "integer".to_string(),
                value: json!(30),
                salt: vec![2u8; ATTRIBUTE_SALT_SIZE],
            },
        ]
    }

    fn legacy_ambiguous_attribute_leaf_hash(
        schema_id: &str,
        credential_id: &str,
        attr_path: &str,
        attr_type: &str,
        attr_value: &Value,
        salt: &[u8],
    ) -> [u8; 32] {
        let canonical_value = canonical_json::canonical_json_bytes(attr_value);
        let mut input = Vec::new();
        input.extend_from_slice(ATTRIBUTE_LEAF_DOMAIN);
        input.extend_from_slice(schema_id.as_bytes());
        input.extend_from_slice(credential_id.as_bytes());
        input.extend_from_slice(attr_path.as_bytes());
        input.extend_from_slice(attr_type.as_bytes());
        input.extend_from_slice(&canonical_value);
        input.extend_from_slice(salt);
        sha3_256(&input)
    }

    #[test]
    fn attribute_leaf_hash_separates_variable_length_field_boundaries() {
        let salt = [7u8; ATTRIBUTE_SALT_SIZE];
        let value = json!("Ana");

        let legacy_left = legacy_ambiguous_attribute_leaf_hash(
            "schema1",
            "cred",
            "subject.nome",
            "string",
            &value,
            &salt,
        );
        let legacy_right = legacy_ambiguous_attribute_leaf_hash(
            "schema",
            "1cred",
            "subject.nome",
            "string",
            &value,
            &salt,
        );
        assert_eq!(legacy_left, legacy_right);

        let length_prefixed_left =
            attribute_leaf_hash("schema1", "cred", "subject.nome", "string", &value, &salt)
                .unwrap();
        let length_prefixed_right =
            attribute_leaf_hash("schema", "1cred", "subject.nome", "string", &value, &salt)
                .unwrap();
        assert_ne!(length_prefixed_left, length_prefixed_right);
    }

    #[test]
    fn merkle_root_is_independent_from_input_order() {
        let mut reversed = attributes();
        reversed.reverse();

        let left = build_merkle_tree("schema_z1", "cred_z1", &attributes()).unwrap();
        let right = build_merkle_tree("schema_z1", "cred_z1", &reversed).unwrap();

        assert_eq!(merkle_root(&left).unwrap(), merkle_root(&right).unwrap());
    }

    #[test]
    fn merkle_proof_rejects_changed_salt() {
        let tree = build_merkle_tree("schema_z1", "cred_z1", &attributes()).unwrap();
        let root = merkle_root(&tree).unwrap();
        let proof = merkle_proof(&tree, "subject.nome").unwrap();

        assert!(
            verify_merkle_proof(
                "schema_z1",
                "cred_z1",
                "subject.nome",
                "string",
                &json!("Ana"),
                &[1u8; ATTRIBUTE_SALT_SIZE],
                &proof,
                &root,
            )
            .unwrap()
        );
        assert!(
            !verify_merkle_proof(
                "schema_z1",
                "cred_z1",
                "subject.nome",
                "string",
                &json!("Ana"),
                &[3u8; ATTRIBUTE_SALT_SIZE],
                &proof,
                &root,
            )
            .unwrap()
        );
    }
}
