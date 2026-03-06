import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { action, email, password } = req.body;

  try {

    // LOGIN
    if (action === "login") {

      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_ANON_KEY!
      );

      const { data: authData, error } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });

      if (error || !authData.user) {
        return res.status(400).json({
          success: false,
          message: error?.message || "Invalid credentials",
        });
      }

      const { data: userData } = await supabase
        .from("users")
        .select("email, role, status")
        .eq("id", authData.user.id)
        .single();

      if (!userData || userData.status !== "approved") {
        return res.status(403).json({
          success: false,
          message: "Account not approved by admin.",
        });
      }

      return res.status(200).json({
        success: true,
        user: userData
      });
    }

    // REGISTER
    if (action === "register") {

      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });

      if (error || !data.user) {
        return res.status(400).json({
          success: false,
          message: error?.message || "Registration failed"
        });
      }

      await supabase.from("users").insert({
        id: data.user.id,
        email,
        role: "user",
        status: "pending"
      });

      return res.status(200).json({
        success: true,
        message: "Registration successful. Awaiting admin approval."
      });
    }

    return res.status(400).json({ message: "Invalid action" });

  } catch (err: any) {

    return res.status(500).json({
      success: false,
      message: err.message
    });

  }

}