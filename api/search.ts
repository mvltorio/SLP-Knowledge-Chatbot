import { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {

    const { limit = 6 } = req.body

    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .limit(limit)

    if (error) {
      console.error(error)
      return res.status(500).json({ error: "Database query failed" })
    }

    res.status(200).json(data)

  } catch (error: any) {

    console.error("Search error:", error)

    res.status(500).json({
      error: error.message
    })

  }
}