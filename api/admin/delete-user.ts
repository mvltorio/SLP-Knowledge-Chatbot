import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId } = req.body;

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await supabase
    .from("users")
    .delete()
    .eq("id", userId);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json({ success: true });
}