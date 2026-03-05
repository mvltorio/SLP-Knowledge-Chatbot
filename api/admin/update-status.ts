import { supabase } from "../../src/db";

export default async function handler(req:any,res:any){

  if(req.method !== "POST"){
    return res.status(405).json({message:"Method not allowed"});
  }

  const { userId, role, status } = req.body;

  const { error } = await supabase
    .from("users")
    .update({
      role,
      status: status || "approved"
    })
    .eq("id", userId);

  if(error){
    return res.status(500).json({success:false,message:error.message});
  }

  return res.json({success:true});
}