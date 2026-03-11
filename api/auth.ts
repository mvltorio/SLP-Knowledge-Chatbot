import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  try {

    if (req.method !== "POST") {
      return res.status(405).json({ success:false, message:"Method not allowed" });
    }

    const { email, password, action } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success:false,
        message:"Email and password required"
      });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_ANON_KEY as string
    );

    // LOGIN
    if (action === "login") {

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        return res.status(401).json({
          success:false,
          message:error.message
        });
      }

      const { data:user } = await supabase
        .from("users")
        .select("*")
        .eq("email",email)
        .maybeSingle();

      if (!user) {
        return res.status(404).json({
          success:false,
          message:"User record not found"
        });
      }

      if (user.status !== "approved") {
        return res.status(403).json({
          success:false,
          message:"Account waiting for admin approval"
        });
      }

      return res.status(200).json({
        success:true,
        user:{
          email:user.email,
          role:user.role
        }
      });

    }

    // REGISTER
    if (action === "register") {

      const admin = createClient(
        process.env.SUPABASE_URL as string,
        process.env.SUPABASE_SERVICE_ROLE_KEY as string
      );

      const { data:existing } = await admin
        .from("users")
        .select("email")
        .eq("email",email)
        .maybeSingle();

      if (existing) {
        return res.status(400).json({
          success:false,
          message:"User already exists"
        });
      }

      const { data:newUser, error } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm:true
        });

      if (error) {
        return res.status(400).json({
          success:false,
          message:error.message
        });
      }

      await admin.from("users").insert({
        id:newUser.user.id,
        email,
        role:"user",
        status:"pending"
      });

      return res.status(200).json({
        success:true,
        message:"Registration successful. Waiting for admin approval."
      });

    }

    return res.status(400).json({
      success:false,
      message:"Invalid action"
    });

  } catch (err:any) {

    console.error("AUTH ERROR:",err);

    return res.status(500).json({
      success:false,
      message:err.message
    });

  }
}