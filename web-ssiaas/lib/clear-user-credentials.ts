import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as readline from 'readline';

// We need to use the adapter just like in the app
const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/vertex_db?schema=public";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.trim().toLowerCase());
        });
    });
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error("Uso: npx tsx lib/clear-user-credentials.ts <email_do_usuario>");
        process.exit(1);
    }

    const email = args[0];

    try {
        const user = await prisma.user.findUnique({
            where: { email },
            select: { id: true, name: true, email: true }
        });

        if (!user) {
            console.error(`[ERRO] Usuário com e-mail ${email} não encontrado.`);
            process.exit(1);
        }

        console.log(`\n======================================================`);
        console.log(`Usuário encontrado: ${user.name || 'Sem nome'} (${user.email})`);
        console.log(`======================================================`);
        
        // Verifica quantas credenciais serão apagadas
        const issuedCount = await prisma.verifiableCredential.count({
            where: { issuerId: user.id }
        });
        
        const receivedCount = await prisma.verifiableCredential.count({
            where: { holderId: user.id }
        });

        console.log(`- Credenciais EMITIDAS por este usuário: ${issuedCount}`);
        console.log(`- Credenciais RECEBIDAS por este usuário: ${receivedCount}`);
        console.log(`Total a ser excluído: ${issuedCount + receivedCount}\n`);

        if (issuedCount + receivedCount === 0) {
            console.log("Nenhuma credencial para excluir. Encerrando.");
            process.exit(0);
        }

        const answer = await prompt(`[AVISO] Você tem certeza que deseja apagar TODAS estas credenciais? (s/n): `);

        if (answer === 's' || answer === 'sim' || answer === 'y' || answer === 'yes') {
            console.log("\nIniciando exclusão...");
            
            const result = await prisma.verifiableCredential.deleteMany({
                where: {
                    OR: [
                        { issuerId: user.id },
                        { holderId: user.id }
                    ]
                }
            });

            console.log(`[SUCESSO] ${result.count} credenciais foram apagadas permanentemente do banco de dados.`);
        } else {
            console.log("\nOperação cancelada pelo usuário.");
        }
    } catch (error) {
        console.error("[ERRO] Falha na operação:", error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
