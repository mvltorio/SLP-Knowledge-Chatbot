// src/services/hybridSearch.ts

export interface HybridSearchResponse {
  answer: string
  sources: any[]
}

interface SearchOptions {
  category?: string
}

export default class HybridSearchService {

  private apiKey: string
  private pagefind: any = null

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  // Initialize Pagefind
  async initPagefind() {
    try {

      this.pagefind = await import(/* @vite-ignore */ "/pagefind/pagefind.js")

      console.log("✅ Pagefind loaded")

    } catch (err) {

      console.error("❌ Pagefind failed to load", err)

    }
  }

  // Pagefind search
  async searchDocuments(query: string, options?: SearchOptions) {

    if (!this.pagefind) {
      console.warn("Pagefind not ready")
      return []
    }

    const search = await this.pagefind.search(query)

    if (!search?.results) return []

    const results = []

    for (const r of search.results.slice(0, 5)) {

      const data = await r.data()

      if (options?.category && options.category !== "ALL") {

        if (data.meta?.category !== options.category) continue

      }

      results.push({
        fileName: data.meta?.title || "Document",
        category: data.meta?.category || "General",
        excerpt: data.excerpt || "",
        content: data.content || ""
      })

    }

    return results
  }

  // Ask Groq using document context
  async askGroq(question: string, sources: any[]): Promise<string> {

    if (!this.apiKey) {
      return "⚠️ Groq API key missing."
    }

    const context = sources
      .map(s => s.content)
      .join("\n\n")

    const prompt = `
Answer the question using ONLY the provided documents.

Documents:
${context}

Question:
${question}
`

    try {

      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: "llama3-70b-8192",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.2
        })
      })

      const data = await res.json()

      return data.choices?.[0]?.message?.content || "No response."

    } catch (err) {

      console.error("Groq error:", err)

      return "⚠️ Failed to query Groq."

    }
  }

  // Full hybrid search
  async search(question: string, options?: SearchOptions): Promise<HybridSearchResponse> {

    const docs = await this.searchDocuments(question, options)

    const answer = await this.askGroq(question, docs)

    return {
      answer,
      sources: docs
    }

  }

  // Retry wrapper
  async searchWithRetry(question: string, options?: SearchOptions) {

    try {

      return await this.search(question, options)

    } catch {

      console.warn("Retrying search...")

      return await this.search(question, options)

    }

  }

}