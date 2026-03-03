export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    // Return empty array instead of object
    return res.status(200).json([]);
  }

  return res.status(405).json({ message: 'Method not allowed' });
}