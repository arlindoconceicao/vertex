const fs = require('fs');
const path = require('path');

const indexHtmlPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(indexHtmlPath, 'utf8');

// Encontra todas as tags de imagem com src local (terminando em .png, .jpg, etc)
const regex = /src="([^"]+\.(png|jpg|jpeg|gif|svg))"/gi;

html = html.replace(regex, (match, p1, ext) => {
  // Ignora se for uma URL externa ou se já for base64
  if (p1.startsWith('http') || p1.startsWith('data:')) {
    return match;
  }

  let imagePath = path.join(__dirname, p1);
  if (!fs.existsSync(imagePath)) {
    imagePath = path.join(__dirname, 'public', p1);
  }
  if (fs.existsSync(imagePath)) {
    const extName = path.extname(imagePath).toLowerCase().substring(1);
    const mimeType = extName === 'svg' ? 'image/svg+xml' : `image/${extName}`;
    const base64Data = fs.readFileSync(imagePath).toString('base64');
    console.log(`Convertendo e embutindo: ${p1}`);
    return `src="data:${mimeType};base64,${base64Data}"`;
  } else {
    console.warn(`Aviso: Arquivo não encontrado: ${p1}`);
    return match;
  }
});

fs.writeFileSync(indexHtmlPath, html);
console.log('Todas as imagens locais foram embutidas no index.html com sucesso.');
