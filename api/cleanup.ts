export default function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  return res.status(200).json({ message: "Cleanup successful" });
}