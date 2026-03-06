import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {

  const path = req.url || "";

  try {

    // ================= LOGIN =================
    if (path.includes("/login")) {

      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_ANON_KEY!
      );

      const { email, password } = req.body;

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

      const { data: userData } = await supabase
        .from("users")
        .select("email, role, status")
        .eq("id", authData.user.id)
        .single();

      if (!userData) {
        return res.status(404).json({
          success: false,
          message: "User record not found.",
        });
      }

      if (userData.status !== "approved") {
        return res.status(403).json({
          success: false,
          message: "Your account is still waiting for admin approval.",
        });
      }

      return res.status(200).json({
        success: true,
        user: {
          email: userData.email,
          role: userData.role,
        },
      });

    }

    // ================= REGISTER =================
    if (path.includes("/register")) {

      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      const { email, password } = req.body;

      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });

      if (error || !data.user) {
        return res.status(400).json({
          success: false,
          message: error?.message || "Registration failed",
        });
      }

      await supabase.from("users").insert({
        id: data.user.id,
        email,
        role: "user",
        status: "pending",
      });

      return res.status(200).json({
        success: true,
        message: "Registration successful. Waiting for admin approval."
      });

    }

    return res.status(404).json({ message: "Auth route not found" });

  } catch (err: any) {

    return res.status(500).json({
      success: false,
      message: err.message
    });

  }

}