use libcrux_ml_kem::{self, mlkem512, mlkem768, mlkem1024};
use zeroize::Zeroizing;

use crate::{Result, SsiError, profiles::MlKemProfile, random::random_array};

/// Par de chaves ML-KEM serializado em bytes.
///
/// A chave pública é usada para encapsular um segredo compartilhado destinado
/// ao titular da chave privada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlkemKeyPair {
    /// Perfil ML-KEM usado para gerar o par de chaves.
    pub profile: MlKemProfile,
    /// Chave pública serializada.
    pub public_key: Vec<u8>,
    /// Chave privada serializada.
    pub private_key: Zeroizing<Vec<u8>>,
}

/// Resultado de uma operação de encapsulamento ML-KEM.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlkemEncapsulation {
    /// Perfil ML-KEM usado na operação.
    pub profile: MlKemProfile,
    /// Ciphertext que deve ser enviado ao destinatário.
    pub ciphertext: Vec<u8>,
    /// Segredo compartilhado obtido pelo remetente.
    pub shared_secret: Zeroizing<Vec<u8>>,
}

/// Gera um par de chaves ML-KEM para o perfil informado.
///
/// A aleatoriedade é obtida da fonte segura do sistema operacional e repassada
/// para a implementação `libcrux-ml-kem`.
pub fn keygen(profile: MlKemProfile) -> Result<MlkemKeyPair> {
    let randomness = random_array::<{ libcrux_ml_kem::KEY_GENERATION_SEED_SIZE }>()?;

    let key_pair = match profile {
        MlKemProfile::MlKem512 => {
            let key_pair = mlkem512::generate_key_pair(randomness);
            MlkemKeyPair {
                profile,
                public_key: key_pair.pk().to_vec(),
                private_key: Zeroizing::new(key_pair.sk().to_vec()),
            }
        }
        MlKemProfile::MlKem768 => {
            let key_pair = mlkem768::generate_key_pair(randomness);
            MlkemKeyPair {
                profile,
                public_key: key_pair.pk().to_vec(),
                private_key: Zeroizing::new(key_pair.sk().to_vec()),
            }
        }
        MlKemProfile::MlKem1024 => {
            let key_pair = mlkem1024::generate_key_pair(randomness);
            MlkemKeyPair {
                profile,
                public_key: key_pair.pk().to_vec(),
                private_key: Zeroizing::new(key_pair.sk().to_vec()),
            }
        }
    };

    Ok(key_pair)
}

/// Encapsula um segredo compartilhado para uma chave pública ML-KEM.
///
/// A chave pública é validada antes do encapsulamento, conforme recomendado
/// pelo fluxo FIPS 203 usado pela `libcrux-ml-kem`.
pub fn encapsulate(profile: MlKemProfile, public_key: &[u8]) -> Result<MlkemEncapsulation> {
    let randomness = random_array::<{ libcrux_ml_kem::SHARED_SECRET_SIZE }>()?;

    let encapsulation = match profile {
        MlKemProfile::MlKem512 => {
            let public_key = mlkem512::MlKem512PublicKey::try_from(public_key).map_err(|_| {
                SsiError::InvalidLength {
                    kind: "ML-KEM-512 public key",
                    expected: mlkem512::MlKem512PublicKey::len(),
                    actual: public_key.len(),
                }
            })?;

            if !mlkem512::validate_public_key(&public_key) {
                return Err(SsiError::Crypto(
                    "invalid ML-KEM-512 public key".to_string(),
                ));
            }

            let (ciphertext, shared_secret) = mlkem512::encapsulate(&public_key, randomness);
            MlkemEncapsulation {
                profile,
                ciphertext: ciphertext.as_ref().to_vec(),
                shared_secret: Zeroizing::new(shared_secret.as_slice().to_vec()),
            }
        }
        MlKemProfile::MlKem768 => {
            let public_key = mlkem768::MlKem768PublicKey::try_from(public_key).map_err(|_| {
                SsiError::InvalidLength {
                    kind: "ML-KEM-768 public key",
                    expected: mlkem768::MlKem768PublicKey::len(),
                    actual: public_key.len(),
                }
            })?;

            if !mlkem768::validate_public_key(&public_key) {
                return Err(SsiError::Crypto(
                    "invalid ML-KEM-768 public key".to_string(),
                ));
            }

            let (ciphertext, shared_secret) = mlkem768::encapsulate(&public_key, randomness);
            MlkemEncapsulation {
                profile,
                ciphertext: ciphertext.as_ref().to_vec(),
                shared_secret: Zeroizing::new(shared_secret.as_slice().to_vec()),
            }
        }
        MlKemProfile::MlKem1024 => {
            let public_key = mlkem1024::MlKem1024PublicKey::try_from(public_key).map_err(|_| {
                SsiError::InvalidLength {
                    kind: "ML-KEM-1024 public key",
                    expected: mlkem1024::MlKem1024PublicKey::len(),
                    actual: public_key.len(),
                }
            })?;

            if !mlkem1024::validate_public_key(&public_key) {
                return Err(SsiError::Crypto(
                    "invalid ML-KEM-1024 public key".to_string(),
                ));
            }

            let (ciphertext, shared_secret) = mlkem1024::encapsulate(&public_key, randomness);
            MlkemEncapsulation {
                profile,
                ciphertext: ciphertext.as_ref().to_vec(),
                shared_secret: Zeroizing::new(shared_secret.as_slice().to_vec()),
            }
        }
    };

    Ok(encapsulation)
}

/// Decapsula um segredo compartilhado usando a chave privada ML-KEM.
///
/// A chave privada e o ciphertext são validados antes da decapsulação. O valor
/// retornado deve ser tratado como material sensível de chave.
pub fn decapsulate(
    profile: MlKemProfile,
    private_key: &[u8],
    ciphertext: &[u8],
) -> Result<Zeroizing<Vec<u8>>> {
    let shared_secret = match profile {
        MlKemProfile::MlKem512 => {
            let private_key =
                mlkem512::MlKem512PrivateKey::try_from(private_key).map_err(|_| {
                    SsiError::InvalidLength {
                        kind: "ML-KEM-512 private key",
                        expected: mlkem512::MlKem512PrivateKey::len(),
                        actual: private_key.len(),
                    }
                })?;
            let ciphertext = mlkem512::MlKem512Ciphertext::try_from(ciphertext).map_err(|_| {
                SsiError::InvalidLength {
                    kind: "ML-KEM-512 ciphertext",
                    expected: mlkem512::MlKem512Ciphertext::len(),
                    actual: ciphertext.len(),
                }
            })?;

            if !mlkem512::validate_private_key(&private_key, &ciphertext) {
                return Err(SsiError::Crypto(
                    "invalid ML-KEM-512 private key".to_string(),
                ));
            }

            Zeroizing::new(
                mlkem512::decapsulate(&private_key, &ciphertext)
                    .as_slice()
                    .to_vec(),
            )
        }
        MlKemProfile::MlKem768 => {
            let private_key =
                mlkem768::MlKem768PrivateKey::try_from(private_key).map_err(|_| {
                    SsiError::InvalidLength {
                        kind: "ML-KEM-768 private key",
                        expected: mlkem768::MlKem768PrivateKey::len(),
                        actual: private_key.len(),
                    }
                })?;
            let ciphertext = mlkem768::MlKem768Ciphertext::try_from(ciphertext).map_err(|_| {
                SsiError::InvalidLength {
                    kind: "ML-KEM-768 ciphertext",
                    expected: mlkem768::MlKem768Ciphertext::len(),
                    actual: ciphertext.len(),
                }
            })?;

            if !mlkem768::validate_private_key(&private_key, &ciphertext) {
                return Err(SsiError::Crypto(
                    "invalid ML-KEM-768 private key".to_string(),
                ));
            }

            Zeroizing::new(
                mlkem768::decapsulate(&private_key, &ciphertext)
                    .as_slice()
                    .to_vec(),
            )
        }
        MlKemProfile::MlKem1024 => {
            let private_key =
                mlkem1024::MlKem1024PrivateKey::try_from(private_key).map_err(|_| {
                    SsiError::InvalidLength {
                        kind: "ML-KEM-1024 private key",
                        expected: mlkem1024::MlKem1024PrivateKey::len(),
                        actual: private_key.len(),
                    }
                })?;
            let ciphertext =
                mlkem1024::MlKem1024Ciphertext::try_from(ciphertext).map_err(|_| {
                    SsiError::InvalidLength {
                        kind: "ML-KEM-1024 ciphertext",
                        expected: mlkem1024::MlKem1024Ciphertext::len(),
                        actual: ciphertext.len(),
                    }
                })?;

            if !mlkem1024::validate_private_key(&private_key, &ciphertext) {
                return Err(SsiError::Crypto(
                    "invalid ML-KEM-1024 private key".to_string(),
                ));
            }

            Zeroizing::new(
                mlkem1024::decapsulate(&private_key, &ciphertext)
                    .as_slice()
                    .to_vec(),
            )
        }
    };

    Ok(shared_secret)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mlkem768_encapsulates_and_decapsulates_the_same_secret() {
        let key_pair = keygen(MlKemProfile::MlKem768).unwrap();
        let encapsulation = encapsulate(MlKemProfile::MlKem768, &key_pair.public_key).unwrap();
        let decapsulated = decapsulate(
            MlKemProfile::MlKem768,
            &key_pair.private_key,
            &encapsulation.ciphertext,
        )
        .unwrap();

        assert_eq!(encapsulation.shared_secret, decapsulated);
    }
}
