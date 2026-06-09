//! Núcleo criptográfico SSI-PQ.
//!
//! Esta biblioteca concentra as funções determinísticas que serão expostas para
//! Node.js via N-API e reutilizadas futuramente por outros adaptadores.

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
/// Binding N-API exposto para Node.js.
pub mod node;
/// Geração de PDF visual simples para credenciais.
pub mod pdf;
/// Perfis criptográficos suportados pelo projeto.
pub mod profiles;
/// Geração centralizada de aleatoriedade segura.
pub mod random;
/// Schema padronizado para atributos de credenciais.
pub mod schema;
mod time;
/// Wallet SQLite cifrada para armazenar DIDs e chaves privadas.
pub mod wallet;

pub mod pdf_sign;

pub use canonical_json::{canonical_json_bytes, canonical_json_string};
pub use encoding::{
    base64url_decode, base64url_encode, multibase_base58btc_decode, multibase_base58btc_encode,
};
pub use errors::{Result, SsiError};
pub use hash::{canonical_json_sha3_256, sha3_256};
