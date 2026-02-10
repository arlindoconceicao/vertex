// src/modules/wallets.rs
use crate::modules::common::napi_err; // Importa o utilitário que movemos
use crate::IndyAgent;
use aes_gcm::{aead::Aead, aead::KeyInit, Aes256Gcm};
use aries_askar::{PassKey, Store, StoreKeyMethod};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use napi::Result;
use napi_derive::napi;
use rand::rngs::OsRng;
use rand::RngCore;
use std::fs;
use std::path::Path;

// Re-importando tipos internos necessários para a lógica de KDF
use crate::modules::common::{
    cleanup_wallet_files, default_argon2_sidecar, derive_raw_key_argon2id,
    derive_raw_key_from_sidecar, derive_raw_key_legacy, is_wallet_auth_error, read_sidecar,
    sidecar_path_for, write_sidecar, WalletKdfSidecar,
};

#[napi]
impl IndyAgent {
    // --- MÉTODOS DE WALLET (Askar) ---
    #[napi]
    pub async unsafe fn wallet_create(&mut self, path: String, pass: String) -> Result<String> {
        // 1) Validação básica
        if path.trim().is_empty() {
            return Err(napi_err("WalletPathInvalid", "wallet path vazio"));
        }

        let wallet_db_path = Path::new(&path);
        let sidecar_path = sidecar_path_for(&path);

        // Garante que o diretório existe
        if let Some(parent) = wallet_db_path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)
                    .map_err(|e| napi_err("WalletPathCreateDirFailed", e.to_string()))?;
            }
        }

        // Evita sobrescrever wallet existente
        if wallet_db_path.exists() || Path::new(&sidecar_path).exists() {
            return Err(napi_err(
                "WalletAlreadyExists",
                "wallet já existe (db e/ou sidecar já presentes)",
            ));
        }

        // 2) Gera KDF (Argon2id) + raw key
        let (sc, salt) = default_argon2_sidecar();
        let raw_key_string = derive_raw_key_argon2id(
            &pass,
            &salt,
            sc.m_cost_kib.unwrap_or(65536),
            sc.t_cost.unwrap_or(3),
            sc.p_cost.unwrap_or(1),
        )?;

        // 3) Cria o SQLite cifrado (Askar)
        let config_uri = format!("sqlite://{}", path);
        Store::provision(
            &config_uri,
            StoreKeyMethod::RawKey,
            PassKey::from(raw_key_string),
            None,
            false, // não recriar por cima
        )
        .await
        .map_err(|e| napi_err("WalletCreateFailed", e.to_string()))?;

        // 4) Persiste sidecar (salt + params)
        if let Err(e) = write_sidecar(&sidecar_path, &sc) {
            // Evita ficar com DB criada sem sidecar (inconsistência)
            cleanup_wallet_files(&path, &sidecar_path);
            return Err(e);
        }

        Ok("Carteira criada com sucesso!".to_string())
    }

    #[napi]
    pub async unsafe fn wallet_open(&mut self, path: String, pass: String) -> Result<String> {
        if path.trim().is_empty() {
            return Err(napi_err("WalletPathInvalid", "wallet path vazio"));
        }

        // Se o DB não existe, não faz sentido cair em KdfParamsMissing.
        // Retorna um erro claro de "wallet não encontrada".
        let wallet_db_path = std::path::Path::new(&path);
        if !wallet_db_path.exists() {
            return Err(napi_err(
                "WalletNotFound",
                format!("wallet db não encontrada ({})", path),
            ));
        }

        let config_uri = format!("sqlite://{}", path);
        self.connection_uri = config_uri.clone();

        let sidecar_path = sidecar_path_for(&path);
        let sc = if Path::new(&sidecar_path).exists() {
            Some(read_sidecar(&sidecar_path)?)
        } else {
            None
        };

        // 1) Deriva raw key a partir do sidecar (ou tenta modo legado para migração)
        let (raw_key_string, opened_with_legacy) = if let Some(sc) = &sc {
            (derive_raw_key_from_sidecar(&pass, sc)?, false)
        } else {
            // Compatibilidade: tenta abrir como legacy (wallets antigas)
            (derive_raw_key_legacy(&pass, 128), true)
        };

        // 2) Abre store
        let store_res = Store::open(
            &config_uri,
            Some(StoreKeyMethod::RawKey),
            PassKey::from(raw_key_string),
            None,
        )
        .await;

        let store = match store_res {
            Ok(s) => s,
            Err(e) => {
                let emsg = e.to_string();

                // Se NÃO há sidecar, a política principal é: sidecar obrigatório.
                // Não misture com "detalhe de decrypt", porque isso só confunde.
                if sc.is_none() {
                    return Err(napi_err(
                        "KdfParamsMissing",
                        format!(
        "sidecar ausente ({}). Para wallets criadas nesta versão, o sidecar é obrigatório.",
        sidecar_path
      ),
                    ));
                }

                // Se HÁ sidecar e deu AEAD decryption error => senha errada (ou chave derivada errada)
                if is_wallet_auth_error(&emsg) {
                    return Err(napi_err(
                        "WalletAuthFailed",
                        "Senha incorreta (falha na decifragem da chave da wallet).",
                    ));
                }

                // Outros erros reais de abertura
                return Err(napi_err("WalletOpenFailed", emsg));
            }
        };

        // 3) Migração automática: se abriu como legacy e sidecar não existia, cria sidecar legacy
        if opened_with_legacy && sc.is_none() {
            let legacy_sc = WalletKdfSidecar {
                version: 1,
                kdf: "legacy_sha256_sha3".to_string(),
                salt_b64: None,
                m_cost_kib: None,
                t_cost: None,
                p_cost: None,
                dk_len: None,
                rounds: Some(128),
            };
            // Best-effort: se falhar, não impede a abertura
            let _ = write_sidecar(&sidecar_path, &legacy_sc);
        }

        // Sessão global removida corretamente aqui
        self.store = Some(store);

        Ok("Conectado ao SQLite nativo com sucesso!".to_string())
    }

    #[napi]
    pub async unsafe fn wallet_close(&mut self) -> Result<bool> {
        // REMOVIDO: self.session = None; (Campo não existe mais)

        // Fecha o Store (libera o handle do arquivo SQLite)
        self.store = None;

        // Libera o Pool de conexão com o Ledger
        self.pool = None;

        Ok(true)
    }

    // ---------------------------------------------------------------------
    // BACKUP DE SENHA DA WALLET (arquivo separado cifrado com AES-256-GCM)
    // ---------------------------------------------------------------------
    #[napi]
    pub fn wallet_backup_create(
        &self,
        wallet_pass: String,
        backup_pass: String,
        backup_file_path: String,
    ) -> Result<bool> {
        if backup_file_path.trim().is_empty() {
            return Err(napi_err("BackupPathInvalid", "backup_file_path vazio"));
        }

        // 1) KDF (Argon2id) para chave de backup
        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);
        let key_b58 = derive_raw_key_argon2id(&backup_pass, &salt, 65536, 3, 1)?;

        // key_b58 é base58 de 32 bytes; decodificamos para bytes
        let key_bytes = bs58::decode(key_b58)
            .into_vec()
            .map_err(|e| napi_err("BackupKeyDecodeFailed", e.to_string()))?;
        if key_bytes.len() != 32 {
            return Err(napi_err(
                "BackupKeyInvalid",
                "chave derivada não tem 32 bytes",
            ));
        }

        // 2) AES-256-GCM
        let cipher = Aes256Gcm::new_from_slice(&key_bytes)
            .map_err(|e| napi_err("BackupCipherInitFailed", e.to_string()))?;
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);

        let ciphertext = cipher
            .encrypt((&nonce).into(), wallet_pass.as_bytes())
            .map_err(|e| napi_err("BackupEncryptFailed", e.to_string()))?;

        // 3) Persistência (JSON)
        let payload = serde_json::json!({
            "version": 1,
            "kdf": "argon2id",
            "salt_b64": B64.encode(salt),
            "m_cost_kib": 65536,
            "t_cost": 3,
            "p_cost": 1,
            "nonce_b64": B64.encode(nonce),
            "ct_b64": B64.encode(ciphertext),
        });

        let tmp = format!("{}.tmp", backup_file_path);
        let bytes = serde_json::to_vec_pretty(&payload)
            .map_err(|e| napi_err("BackupSerializeFailed", e.to_string()))?;
        fs::write(&tmp, bytes).map_err(|e| napi_err("BackupWriteFailed", e.to_string()))?;
        fs::rename(&tmp, &backup_file_path)
            .map_err(|e| napi_err("BackupRenameFailed", e.to_string()))?;

        Ok(true)
    }

    #[napi]
    pub fn wallet_backup_recover(
        &self,
        backup_pass: String,
        backup_file_path: String,
    ) -> Result<String> {
        let content =
            fs::read(&backup_file_path).map_err(|e| napi_err("BackupReadFailed", e.to_string()))?;
        let v: serde_json::Value = serde_json::from_slice(&content)
            .map_err(|e| napi_err("BackupParseFailed", e.to_string()))?;

        let salt_b64 = v["salt_b64"]
            .as_str()
            .ok_or_else(|| napi_err("BackupFormatInvalid", "salt_b64 ausente"))?;
        let nonce_b64 = v["nonce_b64"]
            .as_str()
            .ok_or_else(|| napi_err("BackupFormatInvalid", "nonce_b64 ausente"))?;
        let ct_b64 = v["ct_b64"]
            .as_str()
            .ok_or_else(|| napi_err("BackupFormatInvalid", "ct_b64 ausente"))?;

        let salt = B64
            .decode(salt_b64)
            .map_err(|e| napi_err("BackupFormatInvalid", e.to_string()))?;
        let nonce = B64
            .decode(nonce_b64)
            .map_err(|e| napi_err("BackupFormatInvalid", e.to_string()))?;
        let ct = B64
            .decode(ct_b64)
            .map_err(|e| napi_err("BackupFormatInvalid", e.to_string()))?;

        if nonce.len() != 12 {
            return Err(napi_err("BackupNonceInvalid", "nonce deve ter 12 bytes"));
        }

        // Deriva key e decripta
        let key_b58 = derive_raw_key_argon2id(&backup_pass, &salt, 65536, 3, 1)?;
        let key_bytes = bs58::decode(key_b58)
            .into_vec()
            .map_err(|e| napi_err("BackupKeyDecodeFailed", e.to_string()))?;
        if key_bytes.len() != 32 {
            return Err(napi_err(
                "BackupKeyInvalid",
                "chave derivada não tem 32 bytes",
            ));
        }
        let cipher = Aes256Gcm::new_from_slice(&key_bytes)
            .map_err(|e| napi_err("BackupCipherInitFailed", e.to_string()))?;

        let pt = cipher
            .decrypt((&nonce[..]).into(), ct.as_ref())
            .map_err(|e| napi_err("BackupDecryptFailed", e.to_string()))?;

        String::from_utf8(pt).map_err(|e| napi_err("BackupPlaintextInvalid", e.to_string()))
    }
}
