export default async function csvExtractor(buffer: Buffer): Promise<string> {
  return buffer.toString("utf-8")
}