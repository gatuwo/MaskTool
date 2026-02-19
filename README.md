# Masktool

画像の任意範囲にモザイクまたは黒ベタマスクを適用するデスクトップアプリです。

## 利用者向け（ターミナル不要）

- インストール手順: `docs/INSTALL_GUIDE_JA.md`
- リリースノート雛形: `docs/RELEASE_NOTES_JA_TEMPLATE.md`

## 開発者向け起動

```bash
npm install
npm start
```

`npm start` で Electron アプリとして起動します（ローカルサーバ不要）。

## 操作

- macOS: `COMMAND + ホイール` でズーム
- Windows: `CTRL + ホイール` でズーム

## Webモード（任意）

```bash
npm run start:web
```

ブラウザで確認したい場合のみ使用します。

## GitHub配布（Windows/macOS）

このリポジトリには GitHub Actions のビルド設定（`.github/workflows/release.yml`）が含まれています。

1. GitHub に push
2. `v1.0.0` のようなタグを作成して push
3. Actions が macOS/Windows をビルドして GitHub Releases に成果物を添付

ローカルで手動ビルドする場合:

```bash
npm run dist:mac
npm run dist:win
```

## 主な機能

- 画像ファイル読み込み（ファイル選択 / ドラッグ&ドロップ）
- マスクタイプ切り替え（モザイク / 黒ベタ）
- ドラッグで範囲指定してマスクレイヤーを作成
- レイヤーの移動・リサイズ（黒ベタは回転対応）
- モザイク細かさスライダー
- 黒ベタ本数（1〜5）とピクセル間隔の指定
- 選択中の黒ベタレイヤーへ本数/間隔変更を即時反映
- 全マスク削除ボタン
- macOSは COMMAND + ホイール、Windowsは CTRL + ホイールで編集領域ズーム
- リセットボタン
- ダークモード / ホワイトモード切り替え
- PNG出力時のファイル名指定
- 保存フォルダ指定（デスクトップ保存ダイアログ）
- 同名ファイルがある場合は連番サフィックスを付与して上書き防止
- UNDO / REDO
- 表示レイヤーを合成してPNG出力
