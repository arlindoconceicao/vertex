const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

function getPdfHash(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`[ERRO] Arquivo não encontrado: ${filePath}`);
        process.exit(1);
    }

    try {
        const fileBuffer = fs.readFileSync(filePath);
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        
        console.log("=================================================");
        console.log(`📄 Arquivo: ${path.basename(filePath)}`);
        console.log(`🔒 Hash (SHA-256): ${hash}`);
        console.log("=================================================");
        console.log("Copie este hash e cole na ferramenta de verificação.");
        
        return hash;
    } catch (error) {
        console.error(`[ERRO] Falha ao processar arquivo:`, error.message);
        process.exit(1);
    }
}

// Execução a partir do terminal
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error("Uso: node get-pdf-hash.js <caminho_do_pdf>");
        process.exit(1);
    }
    
    const filePath = path.resolve(args[0]);
    getPdfHash(filePath);
}

module.exports = { getPdfHash };
