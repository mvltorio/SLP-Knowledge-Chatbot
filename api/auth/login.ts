import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY! // login uses anon key
  );

  try {
    const { email, password } = req.body;

    // 1️⃣ Authenticate with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      return res.status(400).json({
        success: false,
        message: error?.message || "Invalid login credentials.",
      });
    }

    // 2️⃣ Check user approval status in users table
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", data.user.id)
      .single();

    if (userError || !userData) {
      return res.status(400).json({
        success: false,
        message: "User record not found.",
      });
    }

    // 3️⃣ Block if not approved
    if (userData.status !== "approved") {
      return res.status(403).json({
        success: false,
        message: "Your account is still waiting for admin approval.",
      });
    }

    // 4️⃣ Allow login
    return res.status(200).json({
      success: true,
      user: {
        email: userData.email,
        role: userData.role,
      },
    });

  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}