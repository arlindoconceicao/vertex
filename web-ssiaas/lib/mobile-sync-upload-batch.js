/**
 * Script de Simulação do Aplicativo Móvel: Sincronização e Upload de Credenciais
 *
 * NOTA: Este script agora delega diretamente para lib/upload-batch-credentials.js,
 * unificando o comportamento de upload na plataforma via multipart/form-data.
 *
 * Uso:
 *   node lib/mobile-sync-upload-batch.js
 */

require("./upload-batch-credentials");
