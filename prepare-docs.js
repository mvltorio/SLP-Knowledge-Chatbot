import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const DOCS_SOURCE = path.join(__dirname, '../public/slp-documents');
const DOCS_OUTPUT = path.join(__dirname, '../dist/slp-docs');

// Ensure output directory exists
if (!fs.existsSync(DOCS_OUTPUT)) {
  fs.mkdirSync(DOCS_OUTPUT, { recursive: true });
}

// Read all document files
const files = fs.readdirSync(DOCS_SOURCE);

files.forEach(file => {
  const filePath = path.join(DOCS_SOURCE, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Extract category from folder structure or filename
  const category = file.includes('PROPOSAL') ? 'PROPOSAL' : 
                   file.includes('GUIDELINES') ? 'GUIDELINES' : 'OTHER';
  
  // Create HTML wrapper for Pagefind
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${file}</title>
  <meta name="pagefind" content="pagefind-specific">
</head>
<body>
  <!-- Add folder/category as filterable metadata -->
  <span data-pagefind-filter="category:${category}"></span>
  <span data-pagefind-filter="filename:${file}"></span>
  
  <!-- Document title -->
  <h1 data-pagefind-meta="title">${file}</h1>
  
  <!-- Document content wrapped for indexing -->
  <div data-pagefind-body>
    ${content.replace(/\n/g, '<br>')}
  </div>
</body>
</html>
  `;
  
  // Save HTML file
  const outputFile = path.join(DOCS_OUTPUT, file.replace(/\.[^/.]+$/, '') + '.html');
  fs.writeFileSync(outputFile, htmlContent);
  console.log(`✅ Prepared: ${file} -> ${outputFile}`);
});

console.log('🎉 All documents prepared for Pagefind!');