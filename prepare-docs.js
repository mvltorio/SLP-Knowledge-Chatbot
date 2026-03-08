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

// Check if there are any files in the directory
const files = fs.readdirSync(docsDir);
console.log(`📁 Found ${files.length} files in slp-documents directory`);

// If no files, create a sample file
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
  <span data-pagefind-filter="type:fish"></span>
  
  <h1 data-pagefind-meta="title">Sample Fish Vending Proposal</h1>
  
  <div data-pagefind-body>
    <h2>Seed Capital Fund Request</h2>
    <p><strong>Amount:</strong> ₱150,000.00</p>
    <p><strong>Business Type:</strong> Fish Vending</p>
    <p><strong>Location:</strong> Barangay Poblacion</p>
    
    <h3>Business Description</h3>
    <p>This proposal seeks funding for a fish vending business that will purchase fresh fish from local fishermen and sell in the public market. The business will employ 3 members of the association.</p>
    
    <h3>Financial Projections</h3>
    <p>Monthly revenue: ₱25,000<br>Monthly expenses: ₱15,000<br>Net profit: ₱10,000</p>
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
    <p>The Punla phase is the initial stage of the program where associations are organized and prepared for livelihood interventions. This includes orientation, social preparation, and capability building activities.</p>
    
    <h3>PHASE TWO (USBONG)</h3>
    <p>The Usbong phase focuses on enterprise development and seed capital fund release. Associations receive their SCF and begin implementing their livelihood projects.</p>
    
    <h3>PHASE THREE (TUKLAS)</h3>
    <p>Tuklas involves monitoring and evaluation of implemented projects. Technical assistance is provided to ensure project sustainability.</p>
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(docsDir, 'mc-03-guidelines.html'), guidelinesContent);
  console.log('✅ Created sample guidelines');
  
  // Create sample index
  const indexContent = `<!DOCTYPE html>
<html>
<head>
  <title>SLP Knowledge Base</title>
  <meta name="pagefind" content="pagefind-specific">
</head>
<body>
  <h1 data-pagefind-meta="title">SLP Documents</h1>
  
  <div data-pagefind-body>
    <p>Welcome to the SLP Knowledge Base. Use the search above to find documents about proposals, guidelines, and more.</p>
    
    <h2>Available Documents:</h2>
    <ul>
      <li><a href="sample-fish-proposal.html">Sample Fish Proposal</a></li>
      <li><a href="mc-03-guidelines.html">MC-03 Guidelines</a></li>
    </ul>
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(docsDir, 'index.html'), indexContent);
  console.log('✅ Created index.html');
  
  console.log('✅ Sample files created successfully!');
} else {
  console.log('✅ Documents already exist. Skipping sample creation.');
  
  // Create an index file if it doesn't exist
  const indexPath = path.join(docsDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    const indexContent = `<!DOCTYPE html>
<html>
<head>
  <title>SLP Knowledge Base</title>
  <meta name="pagefind" content="pagefind-specific">
</head>
<body>
  <h1 data-pagefind-meta="title">SLP Documents</h1>
  
  <div data-pagefind-body>
    <p>Welcome to the SLP Knowledge Base. Use the search above to find documents.</p>
    <p>Total documents: ${files.length}</p>
  </div>
</body>
</html>`;
    
    fs.writeFileSync(indexPath, indexContent);
    console.log('✅ Created index.html');
  }
}

console.log('✅ Document preparation complete!');