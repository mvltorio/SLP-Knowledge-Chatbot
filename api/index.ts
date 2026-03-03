import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  );

  try {
    // ✅ Test route
    if (req.method === "GET" && req.url === "/api/test") {
      return res.status(200).json({ message: "Backend is working 🚀" });
    }

    // ✅ Login route
    if (req.method === "POST" && req.url === "/api/login") {
      const { email, password } = req.body;

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      return res.status(200).json({ user: data.user });
    }

    return res.status(404).json({ error: "Route not found" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}