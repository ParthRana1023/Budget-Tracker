import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "https://clfeauivpjqwkbsqcwiq.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY || "sb_publishable_qUCtsDH2mNhVuzP1aV9Dqg_uXW2wiGk";

export const supabase = createClient(supabaseUrl, supabaseKey);

