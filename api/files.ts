import { supabase } from "../src/db";

export default async function handler(req: any, res: any) {

  if (req.method === "GET") {
    try {

      const { data, error } = await supabase
        .from("files")
        .select("*")
        .order("uploaded_at", { ascending: false });

      if (error) throw error;

      return res.status(200).json(data);

    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Failed to fetch files" });
    }
  }

  if (req.method === "POST") {
    try {

      const { name, category, content, type } = req.body;

      const { data, error } = await supabase
        .from("files")
        .insert([{ name, category, content, type }])
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json(data);

    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Upload failed" });
    }
  }

  return res.status(405).json({ message: "Method not allowed" });
}