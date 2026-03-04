import Tesseract from "tesseract.js"

export default async function imageOCR(buffer: Buffer) {

  const result = await Tesseract.recognize(buffer, "eng")

  return result.data.text || ""
}