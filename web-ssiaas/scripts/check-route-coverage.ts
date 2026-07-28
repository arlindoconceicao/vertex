/**
 * ==============================================================================
 * SCRIPT DE VERIFICAÇÃO DE COBERTURA DE TRADUÇÃO DE ROTAS (i18n Route Coverage)
 * ==============================================================================
 * 
 * FINALIDADE:
 * Este script varre dinamicamente a estrutura de arquivos da aplicação Next.js
 * no diretório `src/app/` buscando todas as páginas (`page.tsx`, `page.jsx`, etc).
 * Em seguida, compara as rotas encontradas contra o arquivo de controle de cobertura
 * `src/locales/routes-manifest.json`.
 * 
 * Se alguma nova tela/rota for criada na aplicação e ainda não constar no arquivo
 * de controle de i18n, este script alertará quais rotas estão sem tradução.
 * 
 * COMO USAR:
 *   1. Executar via npm:
 *      npm run i18n:check-routes
 * 
 *   2. Ou executar diretamente com tsx:
 *      npx tsx scripts/check-route-coverage.ts
 * 
 * COMO ATUALIZAR AO CRIAR UMA NOVA TELA:
 *   1. Crie sua página em `src/app/minha-nova-tela/page.tsx`.
 *   2. Adicione as chaves de tradução em `src/locales/messages/en.json` (canônico).
 *   3. Execute `npm run i18n:sync` para gerar as chaves nos outros idiomas (pt, es).
 *   4. Registre a nova rota no arquivo `src/locales/routes-manifest.json`.
 *   5. Rode `npm run i18n:check-routes` para confirmar a aprovação!
 * 
 * ==============================================================================
 */

import fs from "fs";
import path from "path";

const APP_DIR = path.join(process.cwd(), "src", "app");
const MANIFEST_PATH = path.join(process.cwd(), "src", "locales", "routes-manifest.json");

interface CoveredRoute {
  route: string;
  file: string;
  description: string;
  namespace: string;
}

interface RoutesManifest {
  coveredRoutes: CoveredRoute[];
}

/**
 * Varre recursivamente o diretório `src/app` procurando por páginas do Next.js App Router
 */
function findAppPages(dir: string, baseDir = dir): string[] {
  let pages: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Ignora pasta de rotas de API (api/)
      if (entry.name === "api") continue;
      pages = pages.concat(findAppPages(fullPath, baseDir));
    } else if (entry.isFile() && /^page\.(tsx|jsx|ts|js)$/.test(entry.name)) {
      // Converte o caminho de arquivo relativo para o formato de rota Next.js
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      let routePath = "/" + relativePath.replace(/\/page\.(tsx|jsx|ts|js)$/, "");
      if (routePath === "/page.tsx" || routePath === "/page.jsx" || routePath === "/page.ts" || routePath === "/page.js") {
        routePath = "/";
      }
      pages.push(routePath);
    }
  }

  return pages;
}

function checkRouteCoverage() {
  console.log("🔍 Verificando cobertura de tradução nas rotas do Next.js (src/app)...\n");

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`❌ Arquivo de controle não encontrado em ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const manifest: RoutesManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  const coveredSet = new Set(manifest.coveredRoutes.map((r) => r.route));

  // Descobre todas as páginas existentes no projeto
  const discoveredRoutes = findAppPages(APP_DIR);

  console.log(`📌 Total de telas/páginas encontradas no código: ${discoveredRoutes.length}`);
  console.log(`📌 Total de telas registradas no controle i18n: ${manifest.coveredRoutes.length}\n`);

  const missingRoutes: string[] = [];
  const coveredRoutesFound: string[] = [];

  for (const route of discoveredRoutes) {
    if (coveredSet.has(route)) {
      coveredRoutesFound.push(route);
    } else {
      missingRoutes.push(route);
    }
  }

  console.log("--------------------------------------------------");
  console.log("✅ TELAS COBERTAS POR TRADUÇÃO:");
  coveredRoutesFound.forEach((r) => console.log(`   [✓] ${r}`));

  if (missingRoutes.length > 0) {
    console.log("\n--------------------------------------------------");
    console.error(`❌ ATENÇÃO! ENCONTRADAS ${missingRoutes.length} TELA(S) SEM COBERTURA DE TRADUÇÃO:`);
    missingRoutes.forEach((r) => console.error(`   [!] ${r}`));
    console.log("\n--------------------------------------------------");
    console.log("👉 Para resolver:");
    console.log("   1. Adicione as chaves da nova tela em 'src/locales/messages/en.json'");
    console.log("   2. Execute 'npm run i18n:sync' para atualizar pt.json e es.json");
    console.log("   3. Adicione a rota em 'src/locales/routes-manifest.json'\n");
    process.exit(1);
  } else {
    console.log("\n--------------------------------------------------");
    console.log("✨ Excelente! 100% das telas da aplicação possuem cobertura de tradução no i18n.\n");
  }
}

checkRouteCoverage();
