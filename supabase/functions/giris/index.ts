// Edge Function `giris`: kullanıcı adı + parola -> Supabase oturumu.
// verify_jwt=false supabase/config.toml'da sabitlenmiştir (oturum öncesi
// çağrılır; publishable key JWT değildir). Ortam: DEPLOYMENT-SECURITY bölüm 11.
import { configFromEnv, createAuthBoundary, supabaseDepsFromEnv } from "../_shared/kimlik_siniri.mjs";

const env = (k: string) => Deno.env.get(k) ?? "";
const sinir = createAuthBoundary(supabaseDepsFromEnv(env, fetch), configFromEnv(env));

Deno.serve((req: Request) => sinir.handleLogin(req));
