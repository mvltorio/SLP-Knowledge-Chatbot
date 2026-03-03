import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY! // login uses anon key
  );

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    // 1️⃣ Authenticate with Supabase Auth
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (authError || !authData.user) {
      return res.status(400).json({
        success: false,
        message: authError?.message || "Invalid login credentials.",
      });
    }

    // 2️⃣ Check user approval in custom users table
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, email, role, status")
      .eq("id", authData.user.id)
      .single();

    if (userError || !userData) {
      return res.status(404).json({
        success: false,
        message: "User record not found. Please contact administrator.",
      });
    }

    // 3️⃣ Block if not approved
    if (userData.status !== "approved") {
      return res.status(403).json({
        success: false,
        message: "Your account is still waiting for admin approval.",
      });
    }

    // 4️⃣ Success
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
      message: err.message || "Internal server error.",
    });
  }
}