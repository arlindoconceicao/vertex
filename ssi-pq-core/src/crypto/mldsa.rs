use libcrux_ml_dsa::{self, ml_dsa_44, ml_dsa_65, ml_dsa_87};
use zeroize::Zeroizing;

use crate::{Result, SsiError, crypto::fixed_bytes, profiles::MlDsaProfile, random::random_array};

/// Par de chaves ML-DSA serializado em bytes.
///
/// A chave pública é usada para verificação, enquanto a chave privada deve
/// permanecer protegida pela wallet ou por outro armazenamento seguro.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MldsaKeyPair {
    /// Perfil ML-DSA usado para gerar o par de chaves.
    pub profile: MlDsaProfile,
    /// Chave pública serializada.
    pub public_key: Vec<u8>,
    /// Chave privada serializada.
    pub private_key: Zeroizing<Vec<u8>>,
}

/// Assinatura ML-DSA serializada em bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MldsaSignature {
    /// Perfil ML-DSA usado para produzir a assinatura.
    pub profile: MlDsaProfile,
    /// Assinatura serializada.
    pub signature: Vec<u8>,
}

/// Gera um par de chaves ML-DSA para o perfil informado.
///
/// A aleatoriedade é obtida da fonte segura do sistema operacional e repassada
/// para a implementação `libcrux-ml-dsa`.
pub fn keygen(profile: MlDsaProfile) -> Result<MldsaKeyPair> {
    let randomness = random_array::<{ libcrux_ml_dsa::KEY_GENERATION_RANDOMNESS_SIZE }>()?;

    let key_pair = match profile {
        MlDsaProfile::MlDsa44 => {
            let key_pair = ml_dsa_44::generate_key_pair(randomness);
            MldsaKeyPair {
                profile,
                public_key: key_pair.verification_key.as_slice().to_vec(),
                private_key: Zeroizing::new(key_pair.signing_key.as_slice().to_vec()),
            }
        }
        MlDsaProfile::MlDsa65 => {
            let key_pair = ml_dsa_65::generate_key_pair(randomness);
            MldsaKeyPair {
                profile,
                public_key: key_pair.verification_key.as_slice().to_vec(),
                private_key: Zeroizing::new(key_pair.signing_key.as_slice().to_vec()),
            }
        }
        MlDsaProfile::MlDsa87 => {
            let key_pair = ml_dsa_87::generate_key_pair(randomness);
            MldsaKeyPair {
                profile,
                public_key: key_pair.verification_key.as_slice().to_vec(),
                private_key: Zeroizing::new(key_pair.signing_key.as_slice().to_vec()),
            }
        }
    };

    Ok(key_pair)
}

/// Assina uma mensagem usando uma chave privada ML-DSA serializada.
///
/// O parâmetro `context` deve ser usado como separador de domínio, por exemplo
/// `SSI_CREDENTIAL_SIGNATURE_V1` ou `SSI_PDF_DOCUMENT_BINDING_V1`.
pub fn sign(
    profile: MlDsaProfile,
    private_key: &[u8],
    message: &[u8],
    context: &[u8],
) -> Result<MldsaSignature> {
    let randomness = random_array::<{ libcrux_ml_dsa::SIGNING_RANDOMNESS_SIZE }>()?;

    let signature = match profile {
        MlDsaProfile::MlDsa44 => {
            let signing_key = ml_dsa_44::MLDSA44SigningKey::new(fixed_bytes(
                private_key,
                "ML-DSA-44 private key",
            )?);
            ml_dsa_44::sign(&signing_key, message, context, randomness)
                .map_err(|error| SsiError::Crypto(format!("{error:?}")))?
                .as_slice()
                .to_vec()
        }
        MlDsaProfile::MlDsa65 => {
            let signing_key = ml_dsa_65::MLDSA65SigningKey::new(fixed_bytes(
                private_key,
                "ML-DSA-65 private key",
            )?);
            ml_dsa_65::sign(&signing_key, message, context, randomness)
                .map_err(|error| SsiError::Crypto(format!("{error:?}")))?
                .as_slice()
                .to_vec()
        }
        MlDsaProfile::MlDsa87 => {
            let signing_key = ml_dsa_87::MLDSA87SigningKey::new(fixed_bytes(
                private_key,
                "ML-DSA-87 private key",
            )?);
            ml_dsa_87::sign(&signing_key, message, context, randomness)
                .map_err(|error| SsiError::Crypto(format!("{error:?}")))?
                .as_slice()
                .to_vec()
        }
    };

    Ok(MldsaSignature { profile, signature })
}

/// Verifica uma assinatura ML-DSA contra uma mensagem e uma chave pública.
///
/// Retorna `Ok(true)` quando a assinatura é válida, `Ok(false)` quando a
/// assinatura não confere, e erro quando os buffers recebidos são malformados.
pub fn verify(
    profile: MlDsaProfile,
    public_key: &[u8],
    message: &[u8],
    context: &[u8],
    signature: &[u8],
) -> Result<bool> {
    let valid = match profile {
        MlDsaProfile::MlDsa44 => {
            let verification_key = ml_dsa_44::MLDSA44VerificationKey::new(fixed_bytes(
                public_key,
                "ML-DSA-44 public key",
            )?);
            let signature =
                ml_dsa_44::MLDSA44Signature::new(fixed_bytes(signature, "ML-DSA-44 signature")?);
            ml_dsa_44::verify(&verification_key, message, context, &signature).is_ok()
        }
        MlDsaProfile::MlDsa65 => {
            let verification_key = ml_dsa_65::MLDSA65VerificationKey::new(fixed_bytes(
                public_key,
                "ML-DSA-65 public key",
            )?);
            let signature =
                ml_dsa_65::MLDSA65Signature::new(fixed_bytes(signature, "ML-DSA-65 signature")?);
            ml_dsa_65::verify(&verification_key, message, context, &signature).is_ok()
        }
        MlDsaProfile::MlDsa87 => {
            let verification_key = ml_dsa_87::MLDSA87VerificationKey::new(fixed_bytes(
                public_key,
                "ML-DSA-87 public key",
            )?);
            let signature =
                ml_dsa_87::MLDSA87Signature::new(fixed_bytes(signature, "ML-DSA-87 signature")?);
            ml_dsa_87::verify(&verification_key, message, context, &signature).is_ok()
        }
    };

    Ok(valid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mldsa65_signs_and_rejects_changed_message() {
        let key_pair = keygen(MlDsaProfile::MlDsa65).unwrap();
        let signature = sign(
            MlDsaProfile::MlDsa65,
            &key_pair.private_key,
            b"credential payload",
            b"SSI_CREDENTIAL_SIGNATURE_V1",
        )
        .unwrap();

        assert!(
            verify(
                MlDsaProfile::MlDsa65,
                &key_pair.public_key,
                b"credential payload",
                b"SSI_CREDENTIAL_SIGNATURE_V1",
                &signature.signature,
            )
            .unwrap()
        );
        assert!(
            !verify(
                MlDsaProfile::MlDsa65,
                &key_pair.public_key,
                b"changed payload",
                b"SSI_CREDENTIAL_SIGNATURE_V1",
                &signature.signature,
            )
            .unwrap()
        );
    }
}
