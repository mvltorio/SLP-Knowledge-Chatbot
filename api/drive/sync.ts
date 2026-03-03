import { google } from "googleapis";

const FOLDER_ID = "1gD2-yPxfUVazMp3jycUxBnHvLtGt7jy_";

export default async function handler(req: any, res: any) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });

    const drive = google.drive({ version: "v3", auth });

    // 1️⃣ Get subfolders
    const folderResponse = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder'`,
      fields: "files(id, name)",
    });

    const folders = folderResponse.data.files || [];

    let totalFiles = 0;

    // 2️⃣ Loop each subfolder
    for (const folder of folders) {
      const filesResponse = await drive.files.list({
        q: `'${folder.id}' in parents and trashed=false`,
        fields: "files(id, name, mimeType)",
      });

      const files = filesResponse.data.files || [];
      totalFiles += files.length;
    }

    return res.status(200).json({
      success: true,
      newFilesCount: totalFiles,
    });
  } catch (error: any) {
    console.error("Drive sync error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}