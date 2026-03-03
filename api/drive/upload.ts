import { google } from "googleapis";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { name, content, type } = req.body;

    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    auth.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    const drive = google.drive({ version: "v3", auth });

    await drive.files.create({
      requestBody: {
        name,
        parents: ["1gD2-yPxfUVazMp3jycUxBnHvLtGt7jy_"]
      },
      media: {
        mimeType: type || "text/plain",
        body: Buffer.from(content)
      },
      fields: "id"
    });

    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
}