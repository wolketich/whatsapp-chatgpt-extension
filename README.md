# WhatsApp Chat Copier for ChatGPT

A local Chrome / Edge extension that copies the currently open WhatsApp Web conversation into a ChatGPT-ready prompt.

## Install

1. Extract `whatsapp-chatgpt-extension.zip` to a folder on your computer.
2. In Chrome, open `chrome://extensions` (or `edge://extensions` in Microsoft Edge).
3. Turn on **Developer mode** at the top right.
4. Select **Load unpacked** and choose the **whatsapp-chatgpt-extension** folder containing `manifest.json`.
5. Pin **Chat Copier** to your browser toolbar.

## Use

1. Open `https://web.whatsapp.com/` and click any conversation.
2. Click the Chat Copier extension icon.
3. Choose how many recent messages to include. You may also write instructions for the reply.
4. Click **Copy for ChatGPT** or **Copy and open ChatGPT**.
5. Paste with Ctrl+V (Windows) or Cmd+V (Mac). ChatGPT prepares a reply, but does **not** send it to WhatsApp.

## Limits

- WhatsApp Web loads messages as you scroll. The extension makes a best effort to collect earlier messages, up to 500 per copy. Older history may not be available, especially when WhatsApp has not loaded it yet.
- This extension copies text, timestamps and attachment labels/captions only. It cannot read the actual contents of images, PDFs or voice notes.
- Message formatting may need updates if WhatsApp changes its HTML markup.
- Works with the open conversation only. It does not read or search your other conversations.
- WhatsApp Web may expand the **Read more** parts of long captions while copying.
- If you add your own notes, they become part of the copied prompt.

## Privacy

All extraction is done locally in your browser when you click a button. The extension has no server, analytics, external API or message sending capability. It only puts text on your clipboard. Pasting into ChatGPT is your decision; ensure that you have permission to share customer information.

## Development

Chrome Manifest V3. No build step, third-party scripts, or API keys are required.
