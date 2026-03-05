import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export default async function handler(req: VercelRequest, res: VercelResponse) {

  try {

    // ============================
    // GET FILES
    // ============================
    if (req.method === "GET") {

      const { data, error } = await supabase
        .from("files")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(500).json({
          error: error.message
        });
      }

      return res.status(200).json(data);
    }


    // ============================
    // UPLOAD FILE
    // ============================
    if (req.method === "POST") {

      const { name, category, content, type } = req.body;

      if (!name || !category || !content) {
        return res.status(400).json({
          error: "Missing required fields"
        });
      }

      const { data, error } = await supabase
        .from("files")
        .insert([
          {
            name,
            category,
            content,
            type
          }
        ])
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          error: error.message
        });
      }

      return res.status(200).json(data);
    }


    // ============================
    // DELETE FILE
    // ============================
    if (req.method === "DELETE") {

      const { id } = req.query;

      if (!id) {
        return res.status(400).json({
          error: "File id is required"
        });
      }

      const { error } = await supabase
        .from("files")
        .delete()
        .eq("id", id);

      if (error) {
        return res.status(500).json({
          error: error.message
        });
      }

      return res.status(200).json({
        success: true,
        message: "File deleted successfully"
      });
    }


    // ============================
    // UPDATE FILE
    // ============================
    if (req.method === "PUT") {

      const { id } = req.query;
      const { name, category } = req.body;

      if (!id) {
        return res.status(400).json({
          error: "File id is required"
        });
      }

      const { data, error } = await supabase
        .from("files")
        .update({
          name,
          category
        })
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          error: error.message
        });
      }

      return res.status(200).json(data);
    }


    // ============================
    // METHOD NOT ALLOWED
    // ============================
    return res.status(405).json({
      error: "Method not allowed"
    });

  } catch (err: any) {

    console.error("FILES API ERROR:", err);

    return res.status(500).json({
      error: err.message || "Server crashed"
    });

  }

}