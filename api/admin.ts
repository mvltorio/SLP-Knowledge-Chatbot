import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: any, res: any) {

  const { action } = req.query

  try {

    if (action === "users") {

      const { data, error } = await supabase
        .from("users")
        .select("*")

      if (error) throw error

      return res.status(200).json(data)
    }

    if (action === "create") {

      const { email, password, role } = req.body

      const { data, error } = await supabase
        .from("users")
        .insert({ email, password, role })

      if (error) throw error

      return res.status(200).json(data)
    }

    if (action === "delete") {

      const { id } = req.body

      const { data, error } = await supabase
        .from("users")
        .delete()
        .eq("id", id)

      if (error) throw error

      return res.status(200).json(data)
    }

    if (action === "update-role") {

      const { id, role } = req.body

      const { data, error } = await supabase
        .from("users")
        .update({ role })
        .eq("id", id)

      if (error) throw error

      return res.status(200).json(data)
    }

    return res.status(400).json({ error: "Invalid action" })

  } catch (error: any) {

    console.error(error)

    return res.status(500).json({
      error: error.message
    })

  }
}