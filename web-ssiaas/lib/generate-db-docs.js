const fs = require('fs');
const path = require('path');

function parsePrismaSchema(schemaStr) {
  const lines = schemaStr.split('\n');
  const models = [];
  const enums = [];
  
  let currentBlock = null;
  let accumulatedComments = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Ignore empty lines
    if (!trimmed) {
      // If we hit an empty line, usually we keep accumulating comments 
      // but in some conventions it resets. We'll keep them for simplicity.
      continue;
    }
    
    // Check for comments
    if (trimmed.startsWith('//')) {
      accumulatedComments.push(trimmed.replace(/^\/\/\s*/, ''));
      continue;
    }
    
    // Check for model or enum start
    const blockMatch = trimmed.match(/^(model|enum)\s+(\w+)\s*\{/);
    if (blockMatch) {
      const type = blockMatch[1];
      const name = blockMatch[2];
      
      currentBlock = {
        type,
        name,
        description: accumulatedComments.join(' '),
        fields: []
      };
      
      if (type === 'model') models.push(currentBlock);
      else enums.push(currentBlock);
      
      accumulatedComments = [];
      continue;
    }
    
    // Check for block end
    if (trimmed === '}') {
      currentBlock = null;
      accumulatedComments = [];
      continue;
    }
    
    // Inside a block (fields)
    if (currentBlock) {
      if (trimmed.startsWith('@@')) {
        accumulatedComments = [];
        continue;
      }
      
      // Parse field
      const fieldParts = trimmed.split(/\s+/);
      const fieldName = fieldParts[0];
      const fieldType = currentBlock.type === 'model' ? fieldParts[1] : null;
      const attributes = currentBlock.type === 'model' ? fieldParts.slice(2).join(' ') : null;
      
      currentBlock.fields.push({
        name: fieldName,
        type: fieldType,
        attributes: attributes,
        description: accumulatedComments.join(' ')
      });
      
      accumulatedComments = [];
    }
  }
  
  return { models, enums };
}

function generateHTML(parsed) {
  let html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Estrutura do Banco de Dados - Vertex SSIaaS</title>
  <style>
    :root { --bg: #0f172a; --text: #e2e8f0; --card: #1e293b; --border: #334155; --accent: #6366f1; --highlight: #818cf8; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; background-color: var(--bg); color: var(--text); line-height: 1.6; margin: 0; padding: 2rem; }
    h1 { color: #fff; text-align: center; margin-bottom: 2rem; }
    h2 { color: var(--highlight); border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; margin-top: 2.5rem; }
    .table-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    .table-desc { color: #94a3b8; font-style: italic; margin-bottom: 1.5rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { text-align: left; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); }
    th { background-color: rgba(0,0,0,0.2); color: #cbd5e1; font-weight: 600; text-transform: uppercase; font-size: 0.85rem; }
    tr:last-child td { border-bottom: none; }
    .field-name { font-weight: 600; color: #fff; }
    .field-type { color: var(--highlight); font-family: monospace; font-size: 0.9rem; }
    .field-desc { color: #94a3b8; font-size: 0.95rem; }
    .badge { display: inline-block; padding: 0.2rem 0.5rem; border-radius: 4px; background: rgba(99, 102, 241, 0.2); color: var(--highlight); font-size: 0.75rem; margin-left: 0.5rem; }
  </style>
</head>
<body>
  <h1>Estrutura do Banco de Dados (PostgreSQL)</h1>
  <p style="text-align: center; color: #94a3b8; margin-top: -1.5rem; margin-bottom: 3rem;">Documentação gerada automaticamente a partir do Prisma Schema</p>
`;

  // Models
  html += `<h2>Tabelas Principais</h2>`;
  for (const model of parsed.models) {
    html += `
  <div class="table-card">
    <h3 style="margin-top: 0; color: #fff; font-size: 1.5rem;">${model.name}</h3>
    ${model.description ? `<p class="table-desc">${model.description}</p>` : ''}
    <table>
      <thead>
        <tr>
          <th width="20%">Campo</th>
          <th width="20%">Tipo</th>
          <th width="60%">Descrição / Atributos</th>
        </tr>
      </thead>
      <tbody>
`;
    for (const field of model.fields) {
      let desc = field.description || '-';
      let attrs = field.attributes ? `<span class="badge">${field.attributes}</span>` : '';
      html += `
        <tr>
          <td class="field-name">${field.name}</td>
          <td class="field-type">${field.type}${attrs}</td>
          <td class="field-desc">${desc}</td>
        </tr>`;
    }
    html += `
      </tbody>
    </table>
  </div>`;
  }

  // Enums
  if (parsed.enums.length > 0) {
    html += `<h2>Tipos Enumerados (Enums)</h2>`;
    for (const e of parsed.enums) {
      html += `
  <div class="table-card">
    <h3 style="margin-top: 0; color: #fff; font-size: 1.25rem;">Enum: ${e.name}</h3>
    ${e.description ? `<p class="table-desc">${e.description}</p>` : ''}
    <table>
      <thead>
        <tr>
          <th width="30%">Valor</th>
          <th width="70%">Descrição</th>
        </tr>
      </thead>
      <tbody>
`;
      for (const val of e.fields) {
        html += `
        <tr>
          <td class="field-name" style="color: var(--highlight)">${val.name}</td>
          <td class="field-desc">${val.description || '-'}</td>
        </tr>`;
      }
      html += `
      </tbody>
    </table>
  </div>`;
    }
  }

  html += `
</body>
</html>`;
  
  return html;
}

function main() {
  const schemaPath = path.join(__dirname, '../prisma/schema.prisma');
  const outPath = path.join(__dirname, 'database_structure.html');
  
  try {
    const schemaStr = fs.readFileSync(schemaPath, 'utf8');
    const parsed = parsePrismaSchema(schemaStr);
    const html = generateHTML(parsed);
    
    fs.writeFileSync(outPath, html, 'utf8');
    console.log('✅ Arquivo gerado com sucesso: ' + outPath);
  } catch (error) {
    console.error('❌ Erro ao gerar documentação:', error);
  }
}

main();
