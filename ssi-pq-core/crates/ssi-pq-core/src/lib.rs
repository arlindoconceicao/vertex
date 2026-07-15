//! Núcleo criptográfico SSI-PQ.
//!
//! Esta biblioteca concentra as funções determinísticas compartilhadas pelos
//! adaptadores Node.js, mobile e WebAssembly.

/// API JSON/bytes comum para adaptadores multiplataforma.
pub mod api;
/// Canonicalização de JSON usada antes de hash e assinatura.
pub mod canonical_json;
/// Emissão e verificação de credenciais assinadas.
pub mod credential;
/// Fachadas seguras sobre primitivas criptográficas.
pub mod crypto;
/// Geração e validação de DID Documents SSI-PQ.
pub mod did;
/// Codificações de transporte usadas nos documentos JSON do core.
pub mod encoding;
/// Tipos de erro compartilhados pelo core.
pub mod errors;
/// Funções de hash criptográfico.
pub mod hash;
/// Árvore de Merkle para compromisso de atributos.
pub mod merkle;
/// Geração de PDF visual simples para credenciais.
pub mod pdf;
/// Portas abstratas para recursos fornecidos pelo host.
pub mod ports;
/// Perfis criptográficos suportados pelo projeto.
pub mod profiles;
/// Geração centralizada de aleatoriedade segura.
pub mod random;
/// Schema padronizado para atributos de credenciais.
pub mod schema;
mod time;
/// Wallet SQLite cifrada para armazenar DIDs e chaves privadas.
#[cfg(feature = "wallet")]
pub mod wallet;
/// Regras portaveis de wallet, sem backend de armazenamento concreto.
#[cfg(feature = "wallet-core")]
pub mod wallet_core;
/// Backend de wallet sobre armazenamento chave-valor abstrato.
#[cfg(feature = "wallet-core")]
pub mod wallet_storage;

pub mod pdf_sign;

pub use canonical_json::{canonical_json_bytes, canonical_json_string};
pub use encoding::{
    base64url_decode, base64url_encode, multibase_base58btc_decode, multibase_base58btc_encode,
};
pub use errors::{CoreError, Result, SsiError};
pub use hash::{canonical_json_sha3_256, sha3_256};
