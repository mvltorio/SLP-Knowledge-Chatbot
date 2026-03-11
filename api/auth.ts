import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { email, password, action } = req.body;

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  );

  try {

    // LOGIN
    if (action === "login") {

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        return res.status(401).json({
          success: false,
          message: error.message
        });
      }

      const { data: user } = await supabase
        .from("users")
        .select("*")
        .eq("email", email)
        .maybeSingle();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User record missing"
        });
      }

      if (user.status !== "approved") {
        return res.status(403).json({
          success: false,
          message: "Account pending admin approval"
        });
      }

      return res.json({
        success: true,
        user
      });

    }

    // REGISTER
    if (action === "register") {

      const admin = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });

      if (error) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      await admin.from("users").insert({
        id: data.user.id,
        email,
        role: "user",
        status: "pending"
      });

      return res.json({
        success: true,
        message: "Registration successful. Waiting for admin approval."
      });

    }

    return res.status(400).json({ message: "Invalid action" });

  } catch (e: any) {

    console.error("AUTH ERROR:", e);

    return res.status(500).json({
      success: false,
      message: e.message
    });

  }
}