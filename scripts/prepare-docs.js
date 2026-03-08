// scripts/prepare-docs.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('📄 Preparing documents for Pagefind...');

// Ensure the docs directory exists
const publicDir = path.join(__dirname, '../public');
const docsDir = path.join(publicDir, 'slp-documents');

if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
  console.log('✅ Created slp-documents directory');
}

// Create sample files if directory is empty
const files = fs.readdirSync(docsDir);
if (files.length === 0) {
  console.log('⚠️ No documents found. Creating sample files...');
  
  // Create sample proposal
  const proposalContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Sample Fish Proposal</title>
  <meta name="pagefind" content="pagefind-specific">
</head>
<body>
  <span data-pagefind-filter="category:PROPOSAL"></span>
  
  <h1 data-pagefind-meta="title">Sample Fish Vending Proposal</h1>
  
  <div data-pagefind-body>
    <h2>Seed Capital Fund Request</h2>
    <p><strong>Amount:</strong> ₱150,000.00</p>
    <p><strong>Business Type:</strong> Fish Vending</p>
    <p><strong>Location:</strong> Barangay Poblacion</p>
    
    <h3>Business Description</h3>
    <p>This proposal seeks funding for a fish vending business.</p>
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(docsDir, 'sample-fish-proposal.html'), proposalContent);
  console.log('✅ Created sample fish proposal');
  
  // Create sample guidelines
  const guidelinesContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MC-03 Guidelines</title>
  <meta name="pagefind" content="pagefind-specific">
</head>
<body>
  <span data-pagefind-filter="category:GUIDELINES"></span>
  
  <h1 data-pagefind-meta="title">MC-No.-03-S-2025 SLP Omnibus Guidelines</h1>
  
  <div data-pagefind-body>
    <h2>IMPLEMENTATION PHASES</h2>
    
    <h3>PHASE ONE (PUNLA)</h3>
    <p>The Punla phase is the initial stage where associations are organized.</p>
    
    <h3>PHASE TWO (USBONG)</h3>
    <p>The Usbong phase focuses on enterprise development.</p>
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(docsDir, 'mc-03-guidelines.html'), guidelinesContent);
  console.log('✅ Created sample guidelines');
  
  // Create index
  const indexContent = `<!DOCTYPE html>
<html>
<head>
  <title>SLP Knowledge Base</title>
  <meta name="pagefind" content="pagefind-specific">
</head>
<body>
  <h1 data-pagefind-meta="title">SLP Documents</h1>
  <div data-pagefind-body>
    <p>Welcome to the SLP Knowledge Base.</p>
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(docsDir, 'index.html'), indexContent);
  console.log('✅ Created index.html');
}

console.log('✅ Document preparation complete!');