import { supabase } from "../src/db";

export default async function handler(req: any, res: any) {

  try {

    if (req.method === "GET") {

      const { data, error } = await supabase
        .from("files")
        .select("*");

      if (error) {
        console.error("SUPABASE ERROR:", error);
        return res.status(500).json(error);
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
        console.error("SUPABASE INSERT ERROR:", error);
        return res.status(500).json(error);
      }

      return res.status(200).json(data);
    }

    return res.status(405).json({ message: "Method not allowed" });

  } catch (err: any) {

    console.error("FILES API CRASH:", err);

    return res.status(500).json({
      message: "Server crashed",
      error: err.message
    });

  }
}