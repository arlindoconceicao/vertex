import { Project, SyntaxKind, JsxText, StringLiteral } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';

const project = new Project({
    tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json')
});

const sourceFiles = project.getSourceFiles([
    'src/app/**/*.tsx',
    'src/components/**/*.tsx'
]);

let totalHardcoded = 0;

console.log(`Auditoria de i18n iniciada... Analisando ${sourceFiles.length} arquivos .tsx\n`);

function isHardcodedString(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    
    // Ignora strings muito curtas (menos de 2 caracteres) caso não sejam palavras
    if (trimmed.length < 2 && !/[a-zA-Z]/.test(trimmed)) return false;

    // Ignora se for apenas números, símbolos ou caracteres especiais comuns de layout
    if (/^[\d\s\W]+$/.test(trimmed)) return false;

    // Ignora códigos que se pareçam com links ou interpolações residuais
    if (trimmed.startsWith('http')) return false;

    // Se passou, é uma string hardcoded
    return true;
}

sourceFiles.forEach(sourceFile => {
    const filePath = sourceFile.getFilePath();
    const relativePath = path.relative(process.cwd(), filePath);
    
    // Varrer JsxText (ex: <div>Meu Texto</div>)
    const jsxTextNodes = sourceFile.getDescendantsOfKind(SyntaxKind.JsxText);
    
    jsxTextNodes.forEach(node => {
        const text = node.getText();
        if (isHardcodedString(text)) {
            const line = sourceFile.getLineAndColumnAtPos(node.getStart()).line;
            console.log(`[JSX TEXT] ${relativePath}:${line} -> "${text.trim()}"`);
            totalHardcoded++;
        }
    });

    // Varrer atributos JSX que usam string direta (ex: placeholder="Meu texto")
    const jsxAttributes = sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute);
    
    jsxAttributes.forEach(attr => {
        const name = attr.getNameNode().getText();
        // Atributos comuns que costumam precisar de tradução
        const translatableAttrs = ['placeholder', 'title', 'aria-label', 'alt'];
        
        if (translatableAttrs.includes(name)) {
            const initializer = attr.getInitializer();
            if (initializer && initializer.getKind() === SyntaxKind.StringLiteral) {
                const text = (initializer as StringLiteral).getLiteralValue();
                if (isHardcodedString(text)) {
                    const line = sourceFile.getLineAndColumnAtPos(attr.getStart()).line;
                    console.log(`[JSX ATTR] ${relativePath}:${line} -> Atributo '${name}="${text}"'`);
                    totalHardcoded++;
                }
            }
        }
    });
});

console.log(`\nAuditoria concluída. ${totalHardcoded} strings suspeitas encontradas.`);
if (totalHardcoded > 0) {
    console.log(`\nDICA: Mova essas strings para os dicionários em 'src/locales/messages/' e utilize o hook useTranslation().`);
}
