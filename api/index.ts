import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase.from("users").select("*").limit(1);

    if (error) throw error;

    res.status(200).json({ message: "Supabase connected ✅", data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}