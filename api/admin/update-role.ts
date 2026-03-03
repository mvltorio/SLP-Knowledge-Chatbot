import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { userId, role } = req.body;

  if (!userId) {
    return res.status(400).json({ message: "Missing userId" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const { error } = await supabase
      .from("users")
      .update({
        role: role || "user",
        status: "approved",
      })
      .eq("id", userId);

    if (error) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(200).json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
}