import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {

  try {

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { userId, status } = req.body;

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase
      .from("users")
      .update({ status })
      .eq("id", userId)
      .select();

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data);

  } catch (err) {

    console.error("Server error:", err);
    return res.status(500).json({ error: "Server error" });

  }
}