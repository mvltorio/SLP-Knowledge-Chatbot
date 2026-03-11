import fs from "fs"
import path from "path"

console.log("📄 Preparing documents for Pagefind...")

const docsDir = path.join(process.cwd(), "dist", "docs")

if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true })
}

const docs = [
  {
    title: "Fish Vending Proposal",
    category: "PROPOSAL",
    content: `
The Sustainable Livelihood Program (SLP) provides livelihood assistance
to low-income households including fish vending proposals.
`
  },
  {
    title: "SLP Guidelines",
    category: "GUIDELINES",
    content: `
The Sustainable Livelihood Program (SLP) is a capability-building
program of the Department of Social Welfare and Development (DSWD).
`
  },
  {
    title: "URA Fishpond Project",
    category: "PROPOSAL",
    content: `
URA Fishpond is a livelihood project aimed at improving fish production
through community aquaculture management.
`
  }
]

docs.forEach((doc, i) => {

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${doc.title}</title>
</head>

<body data-pagefind-body>

<h1 data-pagefind-meta="title">${doc.title}</h1>

<p data-pagefind-meta="category">${doc.category}</p>

<div>
${doc.content}
</div>

</body>
</html>`

  fs.writeFileSync(
    path.join(docsDir, `doc-${i + 1}.html`),
    html
  )

})

console.log(`✅ Created ${docs.length} searchable HTML documents`)