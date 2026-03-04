import XLSX from "xlsx"

export default async function excelExtractor(buffer: Buffer) {

  const workbook = XLSX.read(buffer)

  let text = ""

  workbook.SheetNames.forEach(name => {
    const sheet = XLSX.utils.sheet_to_csv(workbook.Sheets[name])
    text += sheet
  })

  return text
}