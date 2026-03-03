import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  // Allow only GET requests
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Ensure environment variables exist
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ message: "Missing Supabase environment variables" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const { data, error } = await supabase.auth.admin.listUsers();

    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const ADMIN_EMAIL = "mvltorio@dswd.gov.ph".toLowerCase();

    const users = data.users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.email?.toLowerCase() === ADMIN_EMAIL ? "admin" : "user",
    }));

    return res.status(200).json(users);

  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
}