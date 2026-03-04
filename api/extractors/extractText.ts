import pdfExtractor from "./pdfExtractor"
import docxExtractor from "./docxExtractor"
import excelExtractor from "./excelExtractor"
import csvExtractor from "./csvExtractor"
import pptxExtractor from "./pptxExtractor"
import imageOCR from "./imageOCR"

export default async function extractText(buffer: Buffer, mimeType: string) {

  if (mimeType.includes("pdf")) {
    return pdfExtractor(buffer)
  }

  if (mimeType.includes("word") || mimeType.includes("docx")) {
    return docxExtractor(buffer)
  }

  if (
    mimeType.includes("excel") ||
    mimeType.includes("spreadsheet") ||
    mimeType.includes("sheet")
  ) {
    return excelExtractor(buffer)
  }

  if (mimeType.includes("csv")) {
    return csvExtractor(buffer)
  }

  if (
    mimeType.includes("presentation") ||
    mimeType.includes("pptx")
  ) {
    return pptxExtractor(buffer)
  }

  if (
    mimeType.includes("image") ||
    mimeType.includes("png") ||
    mimeType.includes("jpeg") ||
    mimeType.includes("jpg")
  ) {
    return imageOCR(buffer)
  }

  return ""
}