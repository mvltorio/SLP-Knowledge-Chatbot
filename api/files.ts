import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: VercelRequest, res: VercelResponse) {

  const supabase = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );

  try {

    if (req.method === "GET") {

      const { data, error } = await supabase
        .from("files")
        .select("*");

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json(data);
    }

    if (req.method === "POST") {

      const { name, category, content, type } = req.body;

      const { data, error } = await supabase
        .from("files")
        .insert([{ name, category, content, type }])
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json(data);
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err: any) {

    return res.status(500).json({
      error: err.message
    });

  }
}