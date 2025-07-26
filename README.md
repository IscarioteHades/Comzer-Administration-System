# Comzer-Administration-System
コムザール行政システム（Comzer Administration System）  
**Discord自動入国審査BOT + ブラックリスト管理**
---
## 概要
このリポジトリは、コムザール連邦共和国（Minecraft仮想国家）の入国審査業務を**Discord上で自動化**するためのBOTを管理・開発するものです。  
GoogleスプレッドシートとOpenAI APIを利用し、**ユーザー申請内容の自動整形・ブラックリスト判定・承認/却下通知まで全自動化**しています。
---
## 審査フロー
```mermaid
graph TD
  User[申請者_Discordユーザー]
  Ticket[Discord_Ticketチャンネル_ID:CAS]
  StartFlow[申請フロー開始]
  Version[ゲーム版選択_Java/BE]
  Input1[MCID入力]
  Input2[国籍入力]
  Input3[目的・期間入力]
  Input4[同行者入力]
  Input5[合流者入力]
  Confirm[内容確認→確定]

  GPT[GPTで整形]
  CheckBL[ブラックリスト照合]
  CheckJoiner[合流者認証_WP_API]
  MojangAPI[MCID存在チェック]
  Result[承認/却下Embed生成]

  Notify[Discord通知]
  Publish[公示チャンネル投稿]

  User -->|チケット作成| Ticket
  Ticket --> StartFlow --> Version --> Input1 --> Input2 --> Input3 --> Input4 --> Input5 --> Confirm
  Confirm --> GPT --> CheckBL --> MojangAPI --> CheckJoiner --> Result
  Result --> Notify --> Publish
```
---
## システムフロー
```mermaid
sequenceDiagram
  participant User as User (Discord)
  participant Bot as Discord (CAS BOT)
  participant OpenAI as OpenAI API
  participant Sheet as Google Sheets (Blacklist)
  participant WP as WordPress API (Lollipop)
  participant Mojang as Mojang API
  participant PlayerDB as PlayerDB API
  participant Koyeb as Koyeb Platform
  participant Lollipop as Lollipop Server (MySQL+WP)

  User->>Bot: チケットで @CAS + ID
  Bot-->>User: フォーム表示 (MCID・国籍・目的・同行者 etc)
  User->>Bot: 入力・確定

  Bot->>OpenAI: 自然文 → JSON構造化
  OpenAI-->>Bot: 解析結果（start_datetime等）

  Bot->>Sheet: ブラックリスト照合 (MCID, 国籍, 同行者)
  Sheet-->>Bot: 判定結果

  Bot->>Mojang: Java版MCID照合
  Mojang-->>Bot: 結果
  Bot->>PlayerDB: Bedrockユーザー照合
  PlayerDB-->>Bot: 結果

  Bot->>WP: 合流者存在確認 (/wp-json/czr/v1/healthz)
  WP-->>Bot: 合流者存在 or 失敗

  alt 承認または却下
    Bot-->>User: 審査Embed通知
    Bot->>Lollipop: citizen_id登録（INSERT/UPDATE）
  end

  Note over Koyeb, Bot: /shutdown 実行で Pause API 呼び出し
  Bot->>Koyeb: POST /apps/:id/actions/pause
  Koyeb-->>Bot: ステータス 200

  Note over Koyeb, Bot: /start 実行で Resume API 呼び出し
  Bot->>Koyeb: POST /apps/:id/actions/resume
  Koyeb-->>Bot: ステータス 200
```

【ファイル構成】
index.js … メインBOT本体（申請フロー・審査ロジック・通知・ログ管理）
blacklistCommands.js … ブラックリスト（国・MCID）操作コマンド管理
prompts.js … OpenAI GPT向けプロンプト定義・審査項目抽出
config.json … 設定ファイル
package.json … 依存管理
README.md … このドキュメント

【主要依存パッケージ】
discord.js
axios
openai
google-spreadsheet
node-fetch
（バージョン詳細はpackage.json参照）

【申請～審査プロセス】
1.審査スタート（Discordでボタン押下）
2.ゲーム版選択（Java/BEセレクト）
3.MCID入力
4.国籍入力
5.目的・期間入力（日本語自由文OK）
6.同行者入力（複数可、なしもOK）
7.合流者入力（コムザール国民のみ任意入力）
8.内容確認 → 確定ボタン
9.審査結果Embedで返信（承認/却下・申請内容明示）

【技術概要】
・審査開始判定
→Ticket toolカテゴリかつBOTにメンションされ、"ID:CAS"のトリガーワードをすべて含む場合に起動
・申請内容の整形
→自然言語→prompts.jsにてOpenAI GPTで構造化JSONへ自動変換
　例：「観光で6日間」→purpose: "観光", start/end_datetime, companions, …
・ブラックリスト照合
Googleスプレッドシートblacklist(CAS連携)を参照
→status列Activeのみ有効判定
→登録・削除手続きはDiscordコマンドにて実施
→申請者MCID・国籍・同行者全員を判定
・Discord通知
→承認/却下時はEmbed形式で申請内容をすべて明示（項目ごとにフィールド分割）

【管理者用コマンド】
/add_country・/add_player … ブラックリストに追加
/remove_country・/remove_player … ブラックリストから削除
/list_blacklist … Embedでブラックリスト全件表示

【環境変数】
ADMIN_IDS=610641751652171820
ADMIN_KEYWORD=**********
CONFIG_PATH=./config.json
DISCORD_TOKEN=************
GOOGLE_PRIVATE_KEY=**********
GOOGLE_SERVICE_ACCOUNT_EMAIL=comzer-administration-system@comzer.iam.gserviceaccount.com
GOOGLE_SHEET_ID=1YiZnMrfraQqDA5AqT-vdptqHjzHDqOBi33_nM9rhry0
LOG_CHANNEL_ID=1253309169780391937
OPENAI_API_KEY=sk-**********
TICKET_CAT=1251176946205986827
注：一部変数は非公開

【必須カラム】
・Type(Country/Player)
・status(Active/invalid)
・value
・reason
・date
・status （※物理削除はしない）

よくあるトラブル
todayなど日付変換がうまくいかない → prompts.js/コード内__TODAY__置換を再確認
セッションの硬直 → runInspectionでawait詰まりやAPIキー上限を要確認
ブラックリスト反映が遅い → シート名・列名・status間違い多発注意！

【ライセンス】
（LICENSEファイル参照）
