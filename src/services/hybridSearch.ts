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

      console.log("Pagefind loaded")

    } catch (err) {

      console.error("Failed loading Pagefind", err)

    }
  }

  async searchDocuments(query: string) {

    if (!this.pagefind) return []

    const search = await this.pagefind.search(query)

    const results = await Promise.all(
      search.results.slice(0, 5).map((r: any) => r.data())
    )

    return results.map((r: any) => ({
      title: r.meta?.title || "Document",
      category: r.meta?.category || "General",
      content: r.content,
      excerpt: r.excerpt
    }))
  }

  async askGroq(question: string, docs: any[]) {

    const context = docs.map(d => d.content).join("\n\n")

    const prompt = `
Use ONLY the provided SLP documents.

Documents:
${context}

Question:
${question}
`

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
            { role: "user", content: prompt }
          ],
          temperature: 0.2
        })
      }
    )

    const data = await response.json()

    return data.choices?.[0]?.message?.content || "No answer."
  }

  async search(query: string): Promise<HybridSearchResponse> {

    const docs = await this.searchDocuments(query)

    const answer = await this.askGroq(query, docs)

    return {
      answer,
      sources: docs
    }
  }

}