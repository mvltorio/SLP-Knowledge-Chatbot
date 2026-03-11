import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed",
    });
  }

  try {
    // Safely parse body (important for Vercel)
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { email, password } = body;

    console.log("Login attempt for email:", email);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Check environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.error("Missing Supabase environment variables");
      return res.status(500).json({
        success: false,
        message: "Server configuration error - missing environment variables",
      });
    }

    // Create Supabase clients
    const supabase = createClient(supabaseUrl, anonKey);
    const adminSupabase = createClient(supabaseUrl, serviceKey);

    // Attempt to sign in
    const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // If sign in successful
    if (!signInError && authData?.user) {
      try {
        // Get user profile from database
        const { data: userData, error: userError } = await adminSupabase
          .from("users")
          .select("email, role, status")
          .eq("id", authData.user.id)
          .maybeSingle();

        if (userError) {
          console.error("Error fetching user profile:", userError);
          return res.status(500).json({
            success: false,
            message: "Error fetching user profile",
          });
        }

        if (!userData) {
          return res.status(403).json({
            success: false,
            message: "User profile not found in database",
          });
        }

        if (userData.status !== "approved") {
          return res.status(403).json({
            success: false,
            message: "Account not approved by admin. Please wait for approval.",
          });
        }

        return res.status(200).json({
          success: true,
          user: {
            email: userData.email,
            role: userData.role,
            status: userData.status,
          },
        });
      } catch (profileError) {
        console.error("Error processing user profile:", profileError);
        return res.status(500).json({
          success: false,
          message: "Error processing user profile",
        });
      }
    }

    // If login failed due to invalid credentials, try to register
    if (signInError?.message === "Invalid login credentials") {
      try {
        // Check if user exists in database
        const { data: existingUser, error: checkError } = await adminSupabase
          .from("users")
          .select("email")
          .eq("email", email)
          .maybeSingle();

        if (checkError) {
          console.error("Error checking existing user:", checkError);
          return res.status(500).json({
            success: false,
            message: "Error checking user existence",
          });
        }

        if (existingUser) {
          return res.status(400).json({
            success: false,
            message: "User already exists. Please check your password or contact admin.",
          });
        }

        // Create auth user
        const { data: newUser, error: createError } = await adminSupabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });

        if (createError || !newUser?.user) {
          console.error("Create user error:", createError);
          return res.status(400).json({
            success: false,
            message: createError?.message || "Registration failed",
          });
        }

        // Insert profile
        const { error: insertError } = await adminSupabase.from("users").insert({
          id: newUser.user.id,
          email,
          role: "user",
          status: "pending",
          created_at: new Date().toISOString(),
        });

        if (insertError) {
          console.error("Insert error:", insertError);

          // Rollback - delete the auth user
          try {
            await adminSupabase.auth.admin.deleteUser(newUser.user.id);
          } catch (e) {
            console.error("Rollback failed:", e);
          }

          return res.status(500).json({
            success: false,
            message: "Failed to create user profile",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Registration successful! Waiting for admin approval.",
        });
      } catch (regError) {
        console.error("Registration error:", regError);
        return res.status(500).json({
          success: false,
          message: "Registration failed due to server error",
        });
      }
    }

    // Handle other auth errors
    return res.status(401).json({
      success: false,
      message: signInError?.message || "Authentication failed",
    });
  } catch (err: any) {
    console.error("AUTH API ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Internal server error",
    });
  }
}