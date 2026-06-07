import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// Endereço remetente configurado no .env
const FROM = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

// URL base da plataforma (para links nos e-mails)
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

type EmailResult =
  | { success: true; messageId: string }
  | { success: false; error: string };

type NotifyNewCredentialParams = {
  holderName: string | null;
  holderEmail: string;
  issuerName: string | null;
  schemaName: string;
};

type InviteExternalUserParams = {
  recipientEmail: string;
  issuerName: string | null;
  schemaName: string;
};


// Templates HTML simples. Posteriormente, templates mais elaborados podem ser criados usando uma biblioteca como Handlebars ou EJS.
function templateNewCredential({
  holderName,
  issuerName,
  schemaName,
}: NotifyNewCredentialParams): string {
  const name = holderName ?? "usuário";
  const issuer = issuerName ?? "Um usuário";

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head><meta charset="UTF-8" /></head>
      <body style="font-family: sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
        <div style="max-width: 520px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 16px; padding: 32px;">

          <div style="display:inline-block; background:#4f46e5; border-radius:10px; padding:10px 14px; margin-bottom:24px;">
            <span style="color:white; font-weight:700; font-size:14px;">Vertex SSIaaS</span>
          </div>

          <h1 style="font-size:20px; font-weight:700; margin:0 0 8px;">
            You have received a new credential. ✅
          </h1>
          <p style="color:#a3a3a3; font-size:14px; margin:0 0 24px;">
            Hello, <strong style="color:#e5e5e5;">${name}</strong>!
            <strong style="color:#e5e5e5;">${issuer}</strong> has issued a
            <strong style="color:#e5e5e5;">${schemaName}</strong> for you
            on the Vertex SSIaaS platform.
          </p>

          
            href="${APP_URL}/dashboard"
            style="display:inline-block; background:#4f46e5; color:white; text-decoration:none; font-size:14px; font-weight:600; padding:12px 24px; border-radius:10px;"
          >
            View my credential →
          </a>

          <hr style="border:none; border-top:1px solid #222; margin:32px 0;" />
          <p style="color:#525252; font-size:12px; margin:0;">
            Vertex Web SSIaaS · UNIFESP · Research funded by FAPESP
          </p>

        </div>
      </body>
    </html>
  `;
}

function templateInviteExternal({
  recipientEmail,
  issuerName,
  schemaName,
}: InviteExternalUserParams): string {
  const issuer = issuerName ?? "Um usuário";
  const registerUrl = `${APP_URL}/login?invite=${encodeURIComponent(recipientEmail)}`;

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head><meta charset="UTF-8" /></head>
      <body style="font-family: sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
        <div style="max-width: 520px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 16px; padding: 32px;">

          <div style="display:inline-block; background:#4f46e5; border-radius:10px; padding:10px 14px; margin-bottom:24px;">
            <span style="color:white; font-weight:700; font-size:14px;">Vertex SSIaaS</span>
          </div>

          <h1 style="font-size:20px; font-weight:700; margin:0 0 8px;">
            You have been invited to receive a credential 🎓
          </h1>
          <p style="color:#a3a3a3; font-size:14px; margin:0 0 8px;">
            <strong style="color:#e5e5e5;">${issuer}</strong> wants to issue a
            <strong style="color:#e5e5e5;">${schemaName}</strong> for
            <strong style="color:#e5e5e5;">${recipientEmail}</strong>.
          </p>
          <p style="color:#a3a3a3; font-size:14px; margin:0 0 24px;">
            To accept, sign up for free on the Vertex SSIaaS platform using this email.
          </p>

          
            href="${registerUrl}"
            style="display:inline-block; background:#4f46e5; color:white; text-decoration:none; font-size:14px; font-weight:600; padding:12px 24px; border-radius:10px;"
          >
            Register and accept credentials →
          </a>

          <hr style="border:none; border-top:1px solid #222; margin:32px 0;" />
          <p style="color:#525252; font-size:12px; margin:0;">
            Vertex Web SSIaaS · UNIFESP · Research funded by FAPESP<br/>
            If you were not expecting this email, you can safely ignore it.
          </p>

        </div>
      </body>
    </html>
  `;
}


// FUNÇÕES PÚBLICAS DO SERVIÇO

/**
 * Notifica um Holder (já cadastrado na plataforma) que recebeu
 * uma nova Credencial Verificável.
 * Chamado por: issueCredential() no credentialService (Sprint 2)
 */
export async function notifyNewCredential(
  params: NotifyNewCredentialParams
): Promise<EmailResult> {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: params.holderEmail,
      subject: `You have received a new credential.: ${params.schemaName}`,
      html: templateNewCredential(params),
    });

    if (error) {
      console.error("[emailService] notifyNewCredential error:", error);
      return { success: false, error: error.message };
    }

    console.log("[emailService] notifyNewCredential enviado:", data?.id);
    return { success: true, messageId: data?.id ?? "" };

  } catch (err) {
    console.error("[emailService] notifyNewCredential exception:", err);
    return { success: false, error: "Unexpected error while sending email." };
  }
}

/**
 * Convida um e-mail externo (não cadastrado na plataforma) a se
 * registrar para receber uma credencial.
 * Chamado por: issueCredential() no credentialService (Sprint 2)
 */
export async function inviteExternalUser(
  params: InviteExternalUserParams
): Promise<EmailResult> {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: params.recipientEmail,
      subject: `${params.issuerName ?? "Someone"} wants to send you a verifiable credential`,
      html: templateInviteExternal(params),
    });

    if (error) {
      console.error("[emailService] inviteExternalUser error:", error);
      return { success: false, error: error.message };
    }

    console.log("[emailService] inviteExternalUser enviado:", data?.id);
    return { success: true, messageId: data?.id ?? "" };

  } catch (err) {
    console.error("[emailService] inviteExternalUser exception:", err);
    return { success: false, error: "Unexpected error while sending email." };
  }
}