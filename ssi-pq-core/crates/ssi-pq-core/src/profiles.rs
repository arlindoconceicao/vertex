use serde::{Deserialize, Serialize};
use std::str::FromStr;

use crate::{Result, SsiError};

/// Perfil de segurança ML-DSA usado para assinaturas digitais pós-quânticas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MlDsaProfile {
    /// Perfil ML-DSA-44.
    #[serde(rename = "ML-DSA-44")]
    MlDsa44,
    /// Perfil ML-DSA-65, recomendado como padrão inicial do projeto.
    #[serde(rename = "ML-DSA-65")]
    MlDsa65,
    /// Perfil ML-DSA-87.
    #[serde(rename = "ML-DSA-87")]
    MlDsa87,
}

/// Perfil de segurança ML-KEM usado para encapsulamento de segredo compartilhado.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MlKemProfile {
    /// Perfil ML-KEM-512.
    #[serde(rename = "ML-KEM-512")]
    MlKem512,
    /// Perfil ML-KEM-768, recomendado como padrão inicial do projeto.
    #[serde(rename = "ML-KEM-768")]
    MlKem768,
    /// Perfil ML-KEM-1024.
    #[serde(rename = "ML-KEM-1024")]
    MlKem1024,
}

impl MlDsaProfile {
    /// Retorna o identificador textual usado nos documentos JSON do core.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MlDsa44 => "ML-DSA-44",
            Self::MlDsa65 => "ML-DSA-65",
            Self::MlDsa87 => "ML-DSA-87",
        }
    }
}

impl MlKemProfile {
    /// Retorna o identificador textual usado nos documentos JSON do core.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MlKem512 => "ML-KEM-512",
            Self::MlKem768 => "ML-KEM-768",
            Self::MlKem1024 => "ML-KEM-1024",
        }
    }
}

impl FromStr for MlDsaProfile {
    type Err = SsiError;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "ML-DSA-44" => Ok(Self::MlDsa44),
            "ML-DSA-65" => Ok(Self::MlDsa65),
            "ML-DSA-87" => Ok(Self::MlDsa87),
            _ => Err(SsiError::UnsupportedProfile(value.to_string())),
        }
    }
}

impl FromStr for MlKemProfile {
    type Err = SsiError;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "ML-KEM-512" => Ok(Self::MlKem512),
            "ML-KEM-768" => Ok(Self::MlKem768),
            "ML-KEM-1024" => Ok(Self::MlKem1024),
            _ => Err(SsiError::UnsupportedProfile(value.to_string())),
        }
    }
}
