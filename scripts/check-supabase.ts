/**
 * Supabase への接続確認スクリプト。
 * テーブルは未作成のため、Auth API への疎通のみを確認する。
 * 実行: npx tsx scripts/check-supabase.ts
 */
import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local が無い場合はそのまま進み、下の未設定チェックに任せる。
}

function mask(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return value.slice(0, 4) + "*".repeat(value.length - 4);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が .env.local に設定されていません。",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`接続先: ${url}`);
  console.log(`anon key: ${mask(anonKey)}`);

  const supabase = createClient(url, anonKey);

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error("Supabase Auth API への接続に失敗しました:", error.message);
    process.exitCode = 1;
    return;
  }

  console.log("Supabase Auth API への疎通に成功しました。");
  console.log(`現在のセッション: ${data.session ? "あり" : "なし(未ログイン、想定どおり)"}`);
}

main();
