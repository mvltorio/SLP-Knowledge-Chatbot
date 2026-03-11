import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ 
      success: false,
      message: "Method not allowed" 
    });
  }

  const body =
  typeof req.body === "string"
    ? JSON.parse(req.body)
    : req.body || {};

const { email, password } = body;

  // Validate required fields
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required"
    });
  }

  try {
    // Check if environment variables exist
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing environment variables');
      return res.status(500).json({
        success: false,
        message: "Server configuration error"
      });
    }

    // Try to login first
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // If sign in successful -> LOGIN
    if (!signInError && authData?.user) {
      // Fetch user data from users table
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("email, role, status")
        .eq("id", authData.user.id)
        .single();

      if (userError || !userData) {
        return res.status(403).json({
          success: false,
          message: "User profile not found",
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
          status: userData.status
        }
      });
    }

    // If sign in failed with "Invalid login credentials", try to register
    if (signInError?.message === "Invalid login credentials") {
      // Use service role key for registration
      const adminSupabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );

      // Check if user already exists in your users table
      const { data: existingUser } = await adminSupabase
        .from("users")
        .select("email")
        .eq("email", email)
        .single();

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "User with this email already exists but login failed. Please check your password."
        });
      }

      // Create user with admin API
      const { data: newUser, error: createError } = await adminSupabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });

      if (createError || !newUser?.user) {
        console.error('Registration error:', createError);
        return res.status(400).json({
          success: false,
          message: createError?.message || "Registration failed"
        });
      }

      // Insert into users table
      const { error: insertError } = await adminSupabase
        .from("users")
        .insert({
          id: newUser.user.id,
          email,
          role: "user",
          status: "pending",
          created_at: new Date().toISOString()
        });

      if (insertError) {
        console.error('Insert error:', insertError);
        // Try to rollback: delete the auth user if insert fails
        try {
          await adminSupabase.auth.admin.deleteUser(newUser.user.id);
        } catch (e) {
          console.error('Rollback failed:', e);
        }
        
        return res.status(500).json({
          success: false,
          message: "Failed to create user profile"
        });
      }

      return res.status(200).json({
        success: true,
        message: "Registration successful! Your account is pending admin approval."
      });
    }

    // If it's some other error (wrong password, etc.)
    return res.status(401).json({
      success: false,
      message: signInError?.message || "Authentication failed"
    });

  } catch (err: any) {
    console.error('API Error:', err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Internal server error"
    });
  }
}