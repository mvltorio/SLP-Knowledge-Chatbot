// pdf-parse does not export proper types, so we import it like this
const pdf = require("pdf-parse")

export default async function pdfExtractor(buffer: Buffer) {
  const data = await pdf(buffer)
  return data.text || ""
}