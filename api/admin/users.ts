import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ message: "Missing Supabase environment variables" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, role, status");

    if (error) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
}