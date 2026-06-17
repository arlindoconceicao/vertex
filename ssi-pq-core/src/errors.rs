use thiserror::Error;

/// Resultado padrão usado pelas funções do core SSI-PQ.
pub type Result<T> = std::result::Result<T, SsiError>;

/// Erros padronizados retornados pelo core SSI-PQ.
#[derive(Debug, Error)]
pub enum SsiError {
    /// O JSON recebido não pode ser analisado.
    #[error("invalid JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),

    /// Um arquivo solicitado pelo core não pôde ser lido.
    #[error("file operation failed: {0}")]
    Io(#[from] std::io::Error),

    /// A string base64url recebida não pode ser decodificada.
    #[error("invalid base64url value: {0}")]
    InvalidBase64Url(#[from] base64::DecodeError),

    /// Uma operação SQLite/SQLCipher falhou.
    #[error("sqlite/sqlcipher operation failed: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// O perfil criptográfico informado ainda não é suportado.
    #[error("unsupported profile: {0}")]
    UnsupportedProfile(String),

    /// Um valor multibase recebido não segue o formato esperado.
    #[error("invalid multibase value: {0}")]
    InvalidMultibase(String),

    /// Um DID Document recebido não possui a chave esperada.
    #[error("missing DID key: {0}")]
    MissingDidKey(String),

    /// Um DID Document recebido não possui assinatura.
    #[error("missing DID signature")]
    MissingDidSignature,

    /// Um DID Document recebido é inconsistente ou malformado.
    #[error("invalid DID document: {0}")]
    InvalidDidDocument(String),

    /// Um Schema recebido é inconsistente ou malformado.
    #[error("invalid schema: {0}")]
    InvalidSchema(String),

    /// Uma credencial recebida é inconsistente ou malformada.
    #[error("invalid credential: {0}")]
    InvalidCredential(String),

    /// Um PDF recebido é inconsistente ou malformado.
    #[error("invalid PDF: {0}")]
    InvalidPdf(String),

    /// Uma wallet recebida é inconsistente, inacessível ou malformada.
    #[error("invalid wallet: {0}")]
    InvalidWallet(String),

    /// Um atributo obrigatório não foi encontrado.
    #[error("missing attribute: {0}")]
    MissingAttribute(String),

    /// O tipo de um atributo não corresponde ao Schema.
    #[error("attribute type mismatch for {path}: expected {expected}, got {actual}")]
    AttributeTypeMismatch {
        /// Caminho do atributo validado.
        path: String,
        /// Tipo esperado pelo Schema.
        expected: String,
        /// Tipo encontrado no JSON de atributos.
        actual: String,
    },

    /// Um buffer recebido não possui o tamanho exigido pela primitiva criptográfica.
    #[error("invalid length for {kind}: expected {expected} bytes, got {actual}")]
    InvalidLength {
        /// Nome lógico do valor cujo tamanho foi validado.
        kind: &'static str,
        /// Tamanho esperado em bytes.
        expected: usize,
        /// Tamanho recebido em bytes.
        actual: usize,
    },

    /// A fonte de aleatoriedade do sistema operacional falhou.
    #[error("randomness source failed: {0}")]
    Randomness(String),

    /// Uma operação criptográfica falhou.
    #[error("cryptographic operation failed: {0}")]
    Crypto(String),
}
