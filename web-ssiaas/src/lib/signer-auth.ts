// Valida a autenticação máquina-a-máquina (M2M) entre a plataforma
// web e o App Mobile Signer. Compara o Bearer token do header
// Authorization com o segredo compartilhado em SIGNER_SECRET.
//
// Retorna true se o token é válido, false caso contrário.
// Nunca expõe o valor real do segredo em logs ou mensagens de erro.
export function validateSignerToken(
  authorizationHeader: string | null
): boolean {
  const secret = process.env.SIGNER_SECRET;

  // Se o segredo não estiver configurado no servidor, nenhum
  // request externo pode ser autorizado — falha segura.
  if (!secret) {
    console.error(
      "[signer-auth] SIGNER_SECRET is not configured in environment variables"
    );
    return false;
  }

  if (!authorizationHeader) return false;

  // Formato esperado: "Bearer <token>"
  const parts = authorizationHeader.split(" ");

  if (parts.length !== 2 || parts[0] !== "Bearer") return false;

  // Comparação direta — em produção, usar crypto.timingSafeEqual
  // para prevenir timing attacks. Aceitável no MVP.
  return parts[1] === secret;
}