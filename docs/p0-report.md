# P0 完了報告 — 環境構築と API-Football 取得可否確認

作成日: 2026-09-30

---

## 実施内容

| # | 内容 | 結果 |
|---|------|------|
| 1 | create-next-app でプロジェクト作成 (TypeScript / App Router / Tailwind CSS / ESLint / `src/` / `@/*`) | 完了 |
| 2 | `package.json` に `typecheck`・`test` スクリプト追加、Vitest・tsx 導入 | 完了 |
| 3 | `.gitignore` に `.env*`(`.env.example` 除く)・`*.pem`・`*.key`・`.cache/` 追加 | 完了 |
| 4 | `.env.example` をダミー値で作成 | 完了 |
| 5 | `src/lib/supabase/client.ts`(ブラウザ用)・`server.ts`(サーバー用)作成 | 完了 |
| 6 | `scripts/check-supabase.ts` 作成・実行(Supabase Auth API 疎通確認) | 完了 |
| 7 | `scripts/check-api-football.ts` 作成・実行(API-Football 取得可否確認) | 完了 |
| 8 | shadcn/ui 初期化(`npx shadcn@latest init --yes --defaults`) | 完了 |
| 9 | lint / typecheck / build / test 全通過確認 | 完了 |

---

## 確認結果

### Supabase 疎通確認

| 項目 | 結果 |
|------|------|
| Auth API 疎通 | 成功 |
| 現在のセッション | なし(未ログイン、想定どおり) |

### API-Football 確認結果

| 項目 | 結果 |
|------|------|
| プラン | Free |
| 有効期限 | 2027-09-21 |
| 1日あたりのリクエスト上限 | 100 |
| season=2026 の利用可否 | **不可**（無料プランは 2022〜2024 のみ対応） |
| season=2024 の利用可否 | 可 |
| 合計リクエスト数(実測) | 3 回（/status × 1、/leagues × 1、/teams × 1）※ /players/squads はキャッシュなしで +1 |

### 4リーグのID・coverage(season=2024)

| リーグ | ID | 取得可否 | standings | players | fixtures(events/lineups/統計) |
|--------|----|----------|-----------|---------|-------------------------------|
| Premier League | 39 | ○ | ○ | ○ | ○ / ○ / ○ |
| Championship | 40 | ○ | ○ | ○ | ○ / ○ / ○ |
| League One | 41 | ○ | ○ | ○ | ○ / ○ / ○ |
| League Two | 42 | ○ | ○ | ○ | ○ / ○ / ○ |

### League Two クラブ・選手取得確認(season=2024)

| 項目 | 結果 |
|------|------|
| League Two クラブ数 | 24(想定どおり) |
| /players/squads (team=1333) 取得選手数 | 28名 |

---

## API-Football の結論

**API で取込可能（ただしシーズンは 2024 が上限）**

- 無料プランで **season=2024** のデータは取得可能。4リーグのクラブ・選手スクアッドともに問題なく取得できる。
- season=2026 は無料プランの対象外。**P2 の初期データ取込は season=2024 を使用する。**
  FC26/FC27 のゲーム内データとの差異（実際のチームロスター等）は、取込後に管理画面で手動修正する運用とする。
- 1日100リクエストの上限があるため、取込処理はキャッシュを活用し、中断再開に対応した設計とする(P2で実装)。

---

## 未解決事項

| # | 内容 |
|---|------|
| 1 | Supabase プロジェクトにテーブルはまだ存在しない(P1 で作成予定) |
| 2 | OWNER_USER_ID は Supabase ダッシュボードで認証ユーザーを作成後に確定する(P1 作業) |
| 3 | season=2026 データは有料プランへのアップグレードで取得可能だが、season=2024 で代替できるため現時点では不要 |

---

## P1 への申し送り

- **DB テーブル設計**：`leagues`・`clubs`・`careers`・`players`・`seasons` など設計書に従い作成。RLS は全テーブルに設定し、`OWNER_USER_ID` 本人のみ操作可とする。
- **認証画面**：Supabase Auth を使ったログイン画面(A-01)を実装。ログイン後は `OWNER_USER_ID` と照合して本人確認を行う。
- **seed.sql**：リーグ定義(tier・クラブ数・昇格降格枠)を固定データとして投入する。リーグ ID は上記の値(39/40/41/42)を使用。
- **API-Football の利用シーズン**：初期データ取込では season=2024 を使用することを前提に実装する。
