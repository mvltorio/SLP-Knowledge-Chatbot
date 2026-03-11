import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  try {

    // Allow GET so visiting /api/auth in browser does not crash
    if (req.method === "GET") {
      return res.status(200).json({
        status: "Auth API working"
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        message: "Method not allowed"
      });
    }

    const { email, password, action } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    // Validate environment variables
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      return res.status(500).json({
        success: false,
        message: "Supabase environment variables missing"
      });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // ---------------- LOGIN ----------------

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
          message: "User record not found"
        });
      }

      if (user.status !== "approved") {
        return res.status(403).json({
          success: false,
          message: "Your account is pending admin approval"
        });
      }

      return res.status(200).json({
        success: true,
        user: {
          email: user.email,
          role: user.role
        }
      });

    }

    // ---------------- REGISTER ----------------

    if (action === "register") {

      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({
          success: false,
          message: "Missing SUPABASE_SERVICE_ROLE_KEY"
        });
      }

      const adminSupabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );

      const { data: existingUser } = await adminSupabase
        .from("users")
        .select("email")
        .eq("email", email)
        .maybeSingle();

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "User already exists"
        });
      }

      const { data: newUser, error } =
        await adminSupabase.auth.admin.createUser({
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

      await adminSupabase.from("users").insert({
        id: newUser.user.id,
        email,
        role: "user",
        status: "pending"
      });

      return res.status(200).json({
        success: true,
        message: "Registration successful. Waiting for admin approval."
      });

    }

    return res.status(400).json({
      success: false,
      message: "Invalid action"
    });

  } catch (error: any) {

    console.error("AUTH ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error"
    });

  }
}