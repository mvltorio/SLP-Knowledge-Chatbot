import mammoth from "mammoth"

export default async function docxExtractor(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer })
  return result.value || ""
}