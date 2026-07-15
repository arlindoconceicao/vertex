use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};

use crate::{Result, SsiError};

/// Codifica bytes em base64url sem padding.
///
/// Este formato é adequado para JSON, URLs e campos de manifesto que precisam
/// transportar chaves, hashes, assinaturas e ciphertexts como texto.
pub fn base64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Codifica bytes em base64 padrão com padding.
pub fn base64_encode(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

/// Decodifica uma string base64url sem padding para bytes.
///
/// Retorna erro quando a entrada não segue o alfabeto base64url esperado.
pub fn base64url_decode(value: &str) -> Result<Vec<u8>> {
    Ok(URL_SAFE_NO_PAD.decode(value)?)
}

/// Codifica bytes em multibase/base58btc.
///
/// O prefixo `z` identifica o alfabeto base58btc, formato usado para DID,
/// fingerprints e chaves públicas expostas em documentos JSON.
pub fn multibase_base58btc_encode(bytes: &[u8]) -> String {
    format!("z{}", bs58::encode(bytes).into_string())
}

/// Decodifica uma string multibase/base58btc para bytes.
///
/// A função exige o prefixo `z`, rejeitando valores que não declararem
/// explicitamente o alfabeto usado.
pub fn multibase_base58btc_decode(value: &str) -> Result<Vec<u8>> {
    let encoded = value
        .strip_prefix('z')
        .ok_or_else(|| SsiError::InvalidMultibase("expected base58btc prefix 'z'".to_string()))?;
    bs58::decode(encoded)
        .into_vec()
        .map_err(|error| SsiError::InvalidMultibase(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_roundtrip_uses_no_padding() {
        let encoded = base64url_encode(b"ssi-pq-core");

        assert!(!encoded.contains('='));
        assert_eq!(base64url_decode(&encoded).unwrap(), b"ssi-pq-core");
    }

    #[test]
    fn multibase_base58btc_roundtrip_uses_z_prefix() {
        let encoded = multibase_base58btc_encode(b"ssi-pq-core");

        assert!(encoded.starts_with('z'));
        assert_eq!(
            multibase_base58btc_decode(&encoded).unwrap(),
            b"ssi-pq-core"
        );
    }
}
