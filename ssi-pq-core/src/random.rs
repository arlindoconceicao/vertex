use sha3::{
    Shake256,
    digest::{ExtendableOutput, Update, XofReader},
};
use zeroize::Zeroizing;

use crate::{Result, SsiError};

const DIRECT_RANDOM_KEY_MAX_SIZE: usize = 32;
const SECURE_RANDOM_KEY_MAX_SIZE: usize = 1024 * 1024;
const SECURE_RANDOM_KEY_DOMAIN: &[u8] = b"ssi-pq-core secure-random-key v1";

/// Gera um array de bytes aleatórios usando a fonte segura do sistema operacional.
///
/// Esta função centraliza a geração de seeds usadas pelas primitivas
/// criptográficas, mantendo a origem de entropia fácil de auditar.
pub fn random_array<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|error| SsiError::Randomness(error.to_string()))?;
    Ok(bytes)
}

/// Gera material de chave seguro com o tamanho solicitado.
///
/// Para chaves de até 32 bytes, os bytes vêm diretamente da fonte segura do
/// sistema operacional. Para tamanhos maiores, a função coleta um seed
/// aleatório de 32 bytes e o expande com SHAKE256, preservando uma única
/// origem auditável de entropia e mantendo a geração rápida para Node.js.
pub fn secure_random_key(length: usize) -> Result<Zeroizing<Vec<u8>>> {
    if length == 0 {
        return Err(SsiError::Crypto(
            "secure random key length must be greater than zero".to_string(),
        ));
    }
    if length > SECURE_RANDOM_KEY_MAX_SIZE {
        return Err(SsiError::Crypto(format!(
            "secure random key length must be at most {SECURE_RANDOM_KEY_MAX_SIZE} bytes"
        )));
    }

    let mut key = Zeroizing::new(vec![0u8; length]);

    if length <= DIRECT_RANDOM_KEY_MAX_SIZE {
        getrandom::fill(&mut key).map_err(|error| SsiError::Randomness(error.to_string()))?;
        return Ok(key);
    }

    let seed = Zeroizing::new(random_array::<DIRECT_RANDOM_KEY_MAX_SIZE>()?);
    let mut hasher = Shake256::default();
    hasher.update(SECURE_RANDOM_KEY_DOMAIN);
    hasher.update(&(length as u64).to_le_bytes());
    hasher.update(seed.as_ref());
    hasher.finalize_xof().read(&mut key);

    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secure_random_key_returns_requested_size() {
        assert_eq!(secure_random_key(16).unwrap().len(), 16);
        assert_eq!(secure_random_key(32).unwrap().len(), 32);
        assert_eq!(secure_random_key(64).unwrap().len(), 64);
    }

    #[test]
    fn secure_random_key_rejects_zero_length() {
        assert!(secure_random_key(0).is_err());
    }

    #[test]
    fn secure_random_key_generates_fresh_material() {
        let first = secure_random_key(64).unwrap();
        let second = secure_random_key(64).unwrap();

        assert_ne!(first.as_slice(), second.as_slice());
    }
}
