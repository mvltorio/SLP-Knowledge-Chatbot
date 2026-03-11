export interface HybridSearchResponse {
  answer: string
  sources: any[]
}

export default class HybridSearchService {

  private apiKey: string
  private pagefind: any = null

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async initPagefind() {
    try {

      this.pagefind = await import(
        /* @vite-ignore */ "/pagefind/pagefind.js"
      )

      console.log("✅ Pagefind loaded")

    } catch (err) {

      console.error("❌ Failed loading Pagefind", err)

    }
  }

  // Retrieve multiple documents from Pagefind
  async searchDocuments(query: string) {

    if (!this.pagefind) return []

    const search = await this.pagefind.search(query)

    if (!search.results.length) {
      return []
    }

    const results = await Promise.all(
      search.results.slice(0, 6).map((r: any) => r.data())
    )

    return results.map((r: any) => ({
      fileName: r.meta?.title || "Document",
      category: r.meta?.category || "General",
      content: r.content,
      excerpt: r.excerpt
    }))
  }

  // Ask Groq using retrieved documents
  async askGroq(question: string, docs: any[]) {

    if (!docs.length) {
      return "I could not find relevant information in the SLP documents."
    }

    // Build structured context from multiple sources
    const context = docs
      .map((doc, i) => `
SOURCE ${i + 1}: ${doc.fileName}
CATEGORY: ${doc.category}

${doc.content}
`)
      .join("\n\n")

    const prompt = `
You are an expert assistant for the Sustainable Livelihood Program (SLP).

Your task is to answer the user's question using ONLY the provided SLP documents.

Important rules:
- You may combine information from multiple documents.
- If several sources contain related information, merge them into one clear explanation.
- If the documents do not contain the answer, say:
  "The information is not available in the SLP documents."

DOCUMENTS:
${context}

QUESTION:
${question}

Provide a clear and helpful answer based on the documents.
`

    try {

      const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama3-70b-8192",
            messages: [
              {
                role: "system",
                content: "You are a knowledgeable assistant for SLP program documents."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            temperature: 0.2
          })
        }
      )

      const data = await response.json()

      return data.choices?.[0]?.message?.content || "No answer."

    } catch (error) {

      console.error("Groq request failed:", error)

      return "⚠️ Unable to generate answer from the AI model."

    }

  }

  // Main hybrid search pipeline
  async search(query: string): Promise<HybridSearchResponse> {

    const docs = await this.searchDocuments(query)

    const answer = await this.askGroq(query, docs)

    return {
      answer,
      sources: docs
    }
  }

}