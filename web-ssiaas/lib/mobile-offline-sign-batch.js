/**
 * Script de Simulação do Aplicativo Móvel: Assinatura Offline de Credenciais em Lote
 *
 * NOTA: Este script agora delega diretamente para lib/sign-batch-credentials.js,
 * unificando o comportamento da assinatura móvel em um único fluxo consistente.
 *
 * Uso:
 *   node lib/mobile-offline-sign-batch.js [batchId]
 */

require("./sign-batch-credentials");
