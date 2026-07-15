use sha3::{Digest, Sha3_256};

use crate::{canonical_json, errors::Result};

/// Calcula o digest SHA3-256 dos bytes informados.
///
/// Retorna sempre um array de 32 bytes, que deve ser convertido para o formato
/// de transporte apropriado somente nas bordas da aplicação.
pub fn sha3_256(bytes: &[u8]) -> [u8; 32] {
    let digest = Sha3_256::digest(bytes);
    digest.into()
}

/// Canonicaliza uma string JSON e calcula o SHA3-256 do resultado canônico.
///
/// Esta função é usada para garantir que objetos JSON semanticamente iguais,
/// mas com chaves em ordem diferente, produzam o mesmo hash criptográfico.
pub fn canonical_json_sha3_256(json: &str) -> Result<[u8; 32]> {
    let canonical = canonical_json::canonical_json_string_from_str(json)?;
    Ok(sha3_256(canonical.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha3_256_empty_matches_known_vector() {
        assert_eq!(
            hex::encode(sha3_256(b"")),
            "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a"
        );
    }

    #[test]
    fn canonical_json_hash_ignores_object_key_order() {
        let left = canonical_json_sha3_256(r#"{"b":2,"a":1}"#).unwrap();
        let right = canonical_json_sha3_256(r#"{"a":1,"b":2}"#).unwrap();

        assert_eq!(left, right);
    }
}
