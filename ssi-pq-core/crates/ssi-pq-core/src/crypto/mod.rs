/// Cifragem autenticada AES-256-GCM.
pub mod aes_gcm;
/// Wrappers para assinaturas digitais ML-DSA.
pub mod mldsa;
/// Wrappers para encapsulamento de chave ML-KEM.
pub mod mlkem;

/// Converte uma fatia de bytes em um array de tamanho fixo.
///
/// Essa validação é necessária porque as crates criptográficas recebem chaves
/// e assinaturas serializadas com tamanhos definidos em tempo de compilação.
fn fixed_bytes<const N: usize>(bytes: &[u8], kind: &'static str) -> crate::Result<[u8; N]> {
    bytes
        .try_into()
        .map_err(|_| crate::SsiError::InvalidLength {
            kind,
            expected: N,
            actual: bytes.len(),
        })
}
