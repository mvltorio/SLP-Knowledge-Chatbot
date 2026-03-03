import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  );

  try {
    // ✅ Test route
    if (req.method === "GET" && req.url?.includes("/api/test")) {
      return res.status(200).json({ message: "Backend is working 🚀" });
    }

    // ✅ Login route (matches your frontend)
    if (req.method === "POST" && req.url?.includes("/api/auth/login")) {
      const { email, password } = req.body;

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(200).json({
        success: true,
        user: data.user,
      });
    }

    return res.status(404).json({ message: "Route not found" });

  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}