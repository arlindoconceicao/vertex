use ::aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};

use crate::{Result, SsiError, random::random_array};

use super::fixed_bytes;

pub const AES256_GCM_KEY_SIZE: usize = 32;
pub const AES256_GCM_NONCE_SIZE: usize = 12;
pub const AES256_GCM_AUTH_TAG_SIZE: usize = 16;

/// Resultado de cifragem AES-256-GCM com campos separados para transporte.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Aes256GcmEncryption {
    /// Bytes cifrados sem o tag de autenticação.
    pub ciphertext: Vec<u8>,
    /// Nonce de 96 bits usado pela operação.
    pub nonce: [u8; AES256_GCM_NONCE_SIZE],
    /// Tag de autenticação GCM de 128 bits.
    pub auth_tag: [u8; AES256_GCM_AUTH_TAG_SIZE],
}

/// Cifra bytes usando AES-256-GCM e gera um nonce aleatório de 96 bits.
pub fn encrypt(key: &[u8], plaintext: &[u8], aad: &[u8]) -> Result<Aes256GcmEncryption> {
    let nonce = random_array::<AES256_GCM_NONCE_SIZE>()?;
    encrypt_with_nonce(key, plaintext, aad, &nonce)
}

/// Cifra bytes usando AES-256-GCM e um nonce fornecido pelo chamador.
pub fn encrypt_with_nonce(
    key: &[u8],
    plaintext: &[u8],
    aad: &[u8],
    nonce: &[u8],
) -> Result<Aes256GcmEncryption> {
    let key = fixed_bytes::<AES256_GCM_KEY_SIZE>(key, "AES-256-GCM key")?;
    let nonce = fixed_bytes::<AES256_GCM_NONCE_SIZE>(nonce, "AES-256-GCM nonce")?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|error| SsiError::Crypto(format!("AES-256-GCM key failed: {error}")))?;
    let mut sealed = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| SsiError::Crypto("AES-256-GCM encryption failed".to_string()))?;

    if sealed.len() < AES256_GCM_AUTH_TAG_SIZE {
        return Err(SsiError::Crypto(
            "AES-256-GCM encryption returned an invalid payload".to_string(),
        ));
    }

    let auth_tag = sealed.split_off(sealed.len() - AES256_GCM_AUTH_TAG_SIZE);
    let auth_tag = fixed_bytes::<AES256_GCM_AUTH_TAG_SIZE>(&auth_tag, "AES-256-GCM auth tag")?;

    Ok(Aes256GcmEncryption {
        ciphertext: sealed,
        nonce,
        auth_tag,
    })
}

/// Decifra bytes usando AES-256-GCM e valida o tag de autenticação.
pub fn decrypt(
    key: &[u8],
    ciphertext: &[u8],
    nonce: &[u8],
    auth_tag: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>> {
    let key = fixed_bytes::<AES256_GCM_KEY_SIZE>(key, "AES-256-GCM key")?;
    let nonce = fixed_bytes::<AES256_GCM_NONCE_SIZE>(nonce, "AES-256-GCM nonce")?;
    let auth_tag = fixed_bytes::<AES256_GCM_AUTH_TAG_SIZE>(auth_tag, "AES-256-GCM auth tag")?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|error| SsiError::Crypto(format!("AES-256-GCM key failed: {error}")))?;

    let mut sealed = Vec::with_capacity(ciphertext.len() + AES256_GCM_AUTH_TAG_SIZE);
    sealed.extend_from_slice(ciphertext);
    sealed.extend_from_slice(&auth_tag);

    cipher
        .decrypt(Nonce::from_slice(&nonce), Payload { msg: &sealed, aad })
        .map_err(|_| SsiError::Crypto("AES-256-GCM decryption failed".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aes256_gcm_encrypts_and_decrypts_with_aad() {
        let key = [7u8; AES256_GCM_KEY_SIZE];
        let plaintext = b"ssi-pq plaintext";
        let aad = b"ssi-pq aad";

        let encrypted = encrypt(&key, plaintext, aad).unwrap();
        let decrypted = decrypt(
            &key,
            &encrypted.ciphertext,
            &encrypted.nonce,
            &encrypted.auth_tag,
            aad,
        )
        .unwrap();

        assert_eq!(decrypted, plaintext);
        assert_ne!(encrypted.ciphertext, plaintext);
    }

    #[test]
    fn aes256_gcm_rejects_tampered_ciphertext() {
        let key = [11u8; AES256_GCM_KEY_SIZE];
        let encrypted = encrypt(&key, b"secret", b"").unwrap();
        let mut tampered_ciphertext = encrypted.ciphertext.clone();
        tampered_ciphertext[0] ^= 0x01;

        assert!(
            decrypt(
                &key,
                &tampered_ciphertext,
                &encrypted.nonce,
                &encrypted.auth_tag,
                b""
            )
            .is_err()
        );
    }

    #[test]
    fn aes256_gcm_rejects_tampered_aad() {
        let key = [13u8; AES256_GCM_KEY_SIZE];
        let encrypted = encrypt(&key, b"secret", b"aad-one").unwrap();

        assert!(
            decrypt(
                &key,
                &encrypted.ciphertext,
                &encrypted.nonce,
                &encrypted.auth_tag,
                b"aad-two"
            )
            .is_err()
        );
    }

    #[test]
    fn aes256_gcm_validates_lengths() {
        let key = [17u8; AES256_GCM_KEY_SIZE];
        let encrypted = encrypt(&key, b"secret", b"").unwrap();

        assert!(encrypt(&key[..31], b"secret", b"").is_err());
        assert!(
            decrypt(
                &key,
                &encrypted.ciphertext,
                &encrypted.nonce[..11],
                &encrypted.auth_tag,
                b""
            )
            .is_err()
        );
        assert!(
            decrypt(
                &key,
                &encrypted.ciphertext,
                &encrypted.nonce,
                &encrypted.auth_tag[..15],
                b""
            )
            .is_err()
        );
    }
}
