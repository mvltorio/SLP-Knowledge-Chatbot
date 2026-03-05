export default async function handler(req, res) {
  try {

    return res.status(200).json({
      status: "ok",
      message: "Backend connected"
    });

  } catch (error) {

    return res.status(500).json({
      status: "error",
      message: "Health check failed"
    });

  }
}