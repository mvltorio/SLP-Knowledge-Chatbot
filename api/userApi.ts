import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // ⚠️ IMPORTANT
  );

  try {
    const { data, error } = await supabase.auth.admin.listUsers();

    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const users = data.users.map((u) => ({
      id: u.id,
      email: u.email,
      role: "user"
    }));

    return res.status(200).json(users);

  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
}