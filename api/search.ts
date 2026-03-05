import { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from "@google/genai"

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {

    const { query, limit = 6, apiKey } = req.body

    if (!query) {
      return res.status(400).json({ error: "Query is required" })
    }

    const ai = new GoogleGenAI({ apiKey })

    // Generate embedding for user query
    const embeddingResponse = await ai.models.embedContent({
      model: "embedding-004",
      contents: query
    })

    const embedding = (embeddingResponse as any).embedding.values

    // Search similar documents
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0.70,
      match_count: limit
    })

    if (error) {
      console.error(error)
      return res.status(500).json({ error: "Vector search failed" })
    }

    res.status(200).json(data)

  } catch (error: any) {

    console.error("Search error:", error)

    res.status(500).json({
      error: error.message
    })

  }
}