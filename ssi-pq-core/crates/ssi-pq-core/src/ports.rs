use chrono::{SecondsFormat, Utc};

use crate::{Result, SsiError};

/// Relógio fornecido pelo adaptador de plataforma.
pub trait Clock: Send + Sync {
    fn now_rfc3339(&self) -> Result<String>;
}

/// Fonte de aleatoriedade fornecida pelo adaptador de plataforma.
pub trait Randomness: Send + Sync {
    fn fill_random(&self, dest: &mut [u8]) -> Result<()>;
}

/// Armazenamento chave-valor abstrato para implementações de wallet futuras.
pub trait Storage: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>>;
    fn put(&self, key: &str, value: &[u8]) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
}

/// Provedor de segredos do host, por exemplo KeyStore, Keychain ou vault.
pub trait SecureKeyProvider: Send + Sync {
    fn get_secret(&self, key_id: &str) -> Result<Vec<u8>>;
}

/// Implementação padrão usando o relógio do sistema.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_rfc3339(&self) -> Result<String> {
        Ok(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true))
    }
}

/// Implementação padrão usando a fonte de aleatoriedade do sistema operacional.
#[derive(Debug, Clone, Copy, Default)]
pub struct OsRandomness;

impl Randomness for OsRandomness {
    fn fill_random(&self, dest: &mut [u8]) -> Result<()> {
        getrandom::fill(dest).map_err(|error| SsiError::Randomness(error.to_string()))
    }
}
