import { google } from "googleapis"
import { createClient } from "@supabase/supabase-js"
import { GoogleGenAI } from "@google/genai"

import extractText from "../../src/extractors/extractText.ts"

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID!

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!
})

function chunkText(text: string, size = 1000) {
  const chunks: string[] = []

  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size))
  }

  return chunks
}

export default async function handler(req: any, res: any) {
  try {

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n")
      },
      scopes: ["https://www.googleapis.com/auth/drive.readonly"]
    })

    const drive = google.drive({
      version: "v3",
      auth
    })

    const folderResponse = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder'`,
      fields: "files(id,name)"
    })

    const folders = folderResponse.data.files || []

    let processedFiles = 0

    for (const folder of folders) {

      const filesResponse = await drive.files.list({
        q: `'${folder.id}' in parents and trashed=false`,
        fields: "files(id,name,mimeType)"
      })

      const files = filesResponse.data.files || []

      for (const file of files) {

        const { data: existing } = await supabase
          .from("files")
          .select("id")
          .eq("drive_file_id", file.id)
          .single()

        if (existing) continue

        const fileData = await drive.files.get(
          { fileId: file.id!, alt: "media" },
          { responseType: "arraybuffer" }
        )

        const buffer = Buffer.from(fileData.data as ArrayBuffer)

        const text = await extractText(buffer, file.mimeType || "")

        if (!text || text.length < 20) continue

        const chunks = chunkText(text)

        for (const chunk of chunks) {

          const embeddingResponse = await ai.models.embedContent({
            model: "embedding-004",
            contents: chunk
          })

          const embedding = (embeddingResponse as any).embedding.values

          await supabase.from("files").insert({
            name: file.name,
            category: folder.name,
            content: chunk,
            type: file.mimeType,
            drive_file_id: file.id,
            embedding
          })
        }

        processedFiles++
      }
    }

    return res.status(200).json({
      success: true,
      processedFiles
    })

  } catch (error: any) {

    console.error("Drive sync error:", error)

    return res.status(500).json({
      success: false,
      message: error.message
    })
  }
}