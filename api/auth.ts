import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {

  const url = req.url || "";

  try {

    // =============================
    // LOGIN
    // =============================
    if (url.includes("/login")) {

      if (req.method !== "POST") {
        return res.status(405).json({ success: false, message: "Method not allowed" });
      }

      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_ANON_KEY!
      );

      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: "Email and password are required."
        });
      }

      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email,
          password
        });

      if (authError || !authData.user) {
        return res.status(400).json({
          success: false,
          message: authError?.message || "Invalid login credentials."
        });
      }

      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("id,email,role,status")
        .eq("id", authData.user.id)
        .single();

      if (userError || !userData) {
        return res.status(404).json({
          success: false,
          message: "User record not found."
        });
      }

      if (userData.status !== "approved") {
        return res.status(403).json({
          success: false,
          message: "Your account is still waiting for admin approval."
        });
      }

      return res.status(200).json({
        success: true,
        user: {
          email: userData.email,
          role: userData.role
        }
      });

    }

    // =============================
    // REGISTER
    // =============================
    if (url.includes("/register")) {

      if (req.method !== "POST") {
        return res.status(405).json({ message: "Method not allowed" });
      }

      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      const { email, password } = req.body;

      const { data, error: authError } =
        await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true
        });

      if (authError || !data.user) {
        return res.status(400).json({
          success: false,
          message: authError?.message || "Registration failed"
        });
      }

      const { error: insertError } =
        await supabase.from("users").insert({
          id: data.user.id,
          email,
          role: "user",
          status: "pending"
        });

      if (insertError) {
        return res.status(400).json({
          success: false,
          message: insertError.message
        });
      }

      return res.status(200).json({
        success: true,
        message: "Registration successful. Waiting for admin approval."
      });

    }

    // =============================
    // NOT FOUND
    // =============================
    return res.status(404).json({
      success: false,
      message: "Auth route not found"
    });

  } catch (err: any) {

    return res.status(500).json({
      success: false,
      message: err.message || "Internal server error"
    });

  }

}