import crypto from "crypto";

/**
 * Retorna as senhas M2M ativas a partir de SIGNER_SECRETS ou SIGNER_SECRET (fallback local).
 * Aceita array separado por vírgulas para rotação de chaves sem downtime.
 */
function getActiveSecrets(): string[] {
  const secretsStr = process.env.SIGNER_SECRETS || process.env.SIGNER_SECRET;
  if (!secretsStr) return [];
  return secretsStr.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Gera um Bearer Token M2M personalizado e único para o usuário.
 * Retorna uma string hexadecimal de 256-bits (64 caracteres) gerada via HMAC.
 */
export function generateSignerToken(userDid: string): string | null {
  const secrets = getActiveSecrets();
  if (secrets.length === 0) return null;
  const primarySecret = secrets[0]; // Usa sempre a primeira para geração (mais recente)
  return crypto.createHmac("sha256", primarySecret).update(userDid).digest("hex");
}

/**
 * Valida a autenticação máquina-a-máquina (M2M) Bearer (HMAC Personalizado).
 * Compara o Bearer token do header com o HMAC esperado para o DID fornecido.
 *
 * @param authorizationHeader O header HTTP "Authorization: Bearer <hex>"
 * @param userDid O DID extraído e previamente validado pela Prova de Posse (PoP)
 */
export function validateSignerToken(
  authorizationHeader: string | null,
  userDid: string
): boolean {
  const secrets = getActiveSecrets();

  if (secrets.length === 0) {
    console.error(
      "[signer-auth] SIGNER_SECRETS is not configured in environment variables"
    );
    return false;
  }

  if (!authorizationHeader) return false;

  // Formato esperado: "Bearer <token_hex>"
  const parts = authorizationHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return false;

  const tokenProvided = parts[1];
  const tokenProvidedBuffer = Buffer.from(tokenProvided, 'utf8');

  // Testa o token fornecido contra o HMAC de cada senha ativa do servidor
  for (const secret of secrets) {
    const expectedToken = crypto.createHmac("sha256", secret).update(userDid).digest("hex");
    const expectedTokenBuffer = Buffer.from(expectedToken, 'utf8');

    // Prevenção de timing attacks (segurança)
    if (expectedTokenBuffer.length === tokenProvidedBuffer.length) {
      if (crypto.timingSafeEqual(expectedTokenBuffer, tokenProvidedBuffer)) {
        return true; // Autenticado com sucesso!
      }
    }
  }

  return false;
}