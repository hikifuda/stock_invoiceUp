📄 README – 請求書アップロードフォーム（LIFF × Vercel × kintone）
概要

本プロジェクトは Vercel 上にホストされた LIFF アプリです。
ユーザーは LINE 上から請求書アップロード画面を開き、
CL入荷フォーム の対象レコードを選択 → 請求書ファイルを添付 → 送信します。

送信後は Vercel API → kintone REST API を経由して、
対象レコードにファイルが添付され、アップロード済フラグ（済）が更新されます。

📂 ディレクトリ構成

project-root/ 

├── index.html            # 請求書アップロードフォーム（LIFF対応）

├── api/

│   └── invoice-attach.js # ファイルアップロード処理 (Next.js API Routes)

├── package.json          # busboy 依存関係など

└── README.md             # 本ドキュメント

⚙️ 動作仕様
1. フロントエンド（index.html）

LIFF SDK で userId を取得し、UIDマスタから companyId を解決

「対象レコード選択」ボタン押下時にモーダルを開き、リアルタイムでレコードを検索表示

表示内容：

入荷予定日（baseDate）

商品名 × 数量

ロット指定（designLot）

レコード選択後、選択内容が画面に反映される

ファイル選択後、アップロードボタンで /api/invoice-attach に送信

処理中はスピナー表示（モーダル内はミニスピナー）

2. API（/api/invoice-attach.js）

multipart/form-data を busboy で受信

recordId, file, origName を取得

origName を優先して利用（スマホ環境での文字化け回避）

kintone REST API /k/v1/file.json にアップロード

filename* に RFC5987 (UTF-8)

filename に ASCII フォールバック

kintone レコードを更新

添付ファイルフィールドに fileKey を登録（追記 or 置換）

uploadFlag フィールドに「済」を設定

🛠️ 必要な環境変数（Vercel Project Settings）
変数名	説明	例
KINTONE_BASE_URL	kintone サイトURL	https://xxxxx.cybozu.com

KINTONE_INBOUND_APP_ID	CL入荷アプリのID	123

KINTONE_INBOUND_API_TOKEN	CL入荷アプリ用APIトークン（読み書き権限）	xxxxxxxx

KINTONE_FILE_FIELD	添付ファイルフィールドのフィールドコード	invoiceFile

KINTONE_UPLOADED_FIELD	アップ済フラグ用フィールドコード	uploadFlag

KINTONE_UPLOADED_VALUE	フラグに記録する文字列	済

KINTONE_FILE_APPEND	既存ファイルに追記するか（true/false）	true

LIFF_ID	LINE Developers で発行された LIFF ID	2008xxxxxx-xxxx

📦 依存パッケージ
{
  "dependencies": {
    "busboy": "^1.6.0"
  }
}

🚀 セットアップ & デプロイ

GitHub リポジトリにプッシュ

Vercel に接続して自動デプロイ

Vercel プロジェクト設定から環境変数を登録

LIFF のエンドポイントURLを Vercel デプロイURLに設定

LINE ミニアプリから起動して動作確認

✅ 主な仕様ポイント

入荷フォーム・出荷フォームと同様に レコード選択 → 送信 の流れ

UIDマスタから companyId を解決して対象レコードを絞り込み

アップロード済みレコードはリストに表示しない

スマホ環境でもファイル名文字化けを防止

uploadFlag = 済 を自動で更新
