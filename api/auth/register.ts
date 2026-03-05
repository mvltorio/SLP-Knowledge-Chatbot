import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // IMPORTANT: service role
  );

  try {
    const { email, password } = req.body;

    // 1️⃣ Create user in Supabase Auth
    const { data, error: authError } = await supabase.auth.admin.createUser({
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

    // 2️⃣ Insert into users table with PENDING status
    const { error: insertError } = await supabase.from("users").insert({
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

  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}