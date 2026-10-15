'use strict';

// WhatsApp Web is not a public export API. This script reads only the open
// conversation's rendered DOM and scrolls the message list to load older rows.
// It never sends a message, changes the draft, or uploads chat data.

async function extractConversation(requestedLimit) {
  const limit = Math.min(500, Math.max(1, Number(requestedLimit) || 50));
  const main = document.querySelector('#main[data-testid="conversation-panel-wrapper"]') ||
               document.querySelector('[data-testid="conversation-panel-wrapper"]');
  if (!main) return {ok:false, error:'Open a WhatsApp conversation before copying.'};

  const title = main.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
                main.querySelector('[data-testid="conversation-header"] [title]');
  const chatName = (title?.getAttribute('title') || title?.textContent || 'Current WhatsApp chat').trim();
  const panel = main.querySelector('[data-testid="conversation-panel-messages"]');
  if (!panel) return {ok:false, error:'Cannot find the messages for this chat. Refresh WhatsApp Web and try again.'};

  const seen = new Map();
  const order = [];
  let readMoreFound = false;
  let hitScrollLimit = false;

  function readableText(element) {
    if (!element) return '';
    return (element.innerText || element.textContent || '')
      .replace(/\u200e|\u200f|\u2060/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  function parseMessage(wrapper) {
    const message = wrapper.querySelector('[data-testid="msg-container"]');
    if (!message) return null;
    const metadataNode = message.querySelector('[data-pre-plain-text]');
    const header = metadataNode?.getAttribute('data-pre-plain-text') || '';
    let timestamp = '';
    let sender = '';
    if (header.startsWith('[') && header.includes(']')) {
      const pos = header.indexOf(']');
      timestamp = header.slice(1, pos).trim();
      sender = header.slice(pos + 1).trim().replace(/:\s*$/, '');
    }

    const mine = Boolean(message.querySelector('[aria-label="You:"]') ||
                         message.querySelector('[data-testid="tail-out"]'));

    // Capture message content only, not WhatsApp button labels, read receipts or menus.
    const contentParts = [];
    const textNodes = message.querySelectorAll(
      '[data-testid="selectable-text"], [data-testid="document-caption selectable-text"], ' +
      '[data-testid="image-caption selectable-text"], [data-testid="video-caption selectable-text"], ' +
      '[data-testid="document-caption"], [data-testid="image-caption"], [data-testid="video-caption"], span.selectable-text'
    );
    for (const node of textNodes) {
      const text = readableText(node);
      if (text && !contentParts.includes(text)) contentParts.push(text);
    }

    const extras = [];
    const docThumbs = message.querySelectorAll('[data-testid="document-thumb"]');
    docThumbs.forEach(el => {
      const match = (el.getAttribute('title') || '').match(/View\s+["“](.+?)["”]/);
      const fileName = match ? match[1] : 'file';
      extras.push(`[Document attached: ${fileName}. Contents not extracted.]`);
    });
    const images = message.querySelectorAll('[data-testid="image-thumb"]');
    if (images.length) extras.push(`[Image attachment${images.length > 1 ? 's' : ''}. Visual contents not extracted.]`);
    const videos = message.querySelectorAll('[data-testid="video-thumb"]');
    if (videos.length) extras.push('[Video attachment. Contents not extracted.]');
    const audio = message.querySelectorAll('[data-testid="audio-play"], [data-testid="audio-message"], audio, [data-testid="ptt-play-pause"]');
    if (audio.length) extras.push('[Voice/audio attachment. Not transcribed.]');
    const stickers = message.querySelectorAll('[data-testid="sticker-thumb"]');
    if (stickers.length) extras.push('[Sticker attached.]');

    if (contentParts.length === 0) {
      // Some media captions have different markup. Prefer useful alt text
      // to the whole bubble, which includes buttons and read receipts.
      const alt = message.querySelector('[data-testid="media-url-provider"] img[alt], [data-testid="image-thumb"] img[alt]');
      const altText = alt?.getAttribute('alt')?.trim() || '';
      if (altText && !/^(image|photo|picture|media|video)$/i.test(altText)) contentParts.push(altText);
    }
    if (contentParts.length === 0 && extras.length === 0) return null;
    if (!timestamp) {
      const time = readableText(message.querySelector('[data-testid="msg-meta"]')).match(/\b\d{1,2}:\d{2}\b/);
      if (time) timestamp = time[0];
    }
    const truncated = Boolean(message.querySelector('[data-testid="caption-read-more-button"]'));
    const fullText = [...extras, ...contentParts].join('\n').trim();
    return {sender, timestamp, isMine: mine, text: fullText, truncated};
  }

  function scan() {
    // WhatsApp virtualizes older messages. Each pass can reveal different rows.
    const wrappers = Array.from(panel.querySelectorAll('[data-testid^="conv-msg-"]'))
      .filter(node => node.querySelector('[data-testid="msg-container"]'));
    const ids = [];
    for (const wrapper of wrappers) {
      const id = wrapper.getAttribute('data-id') || wrapper.getAttribute('data-testid');
      if (!id) continue;
      const parsed = parseMessage(wrapper);
      if (!parsed) continue;
      if (parsed.truncated) readMoreFound = true;
      ids.push(id);
      // Replace previously incomplete records if WhatsApp has expanded them.
      if (!seen.has(id) || (seen.get(id).truncated && !parsed.truncated)) seen.set(id, parsed);
    }

    // Merge each snapshot into a chronological list using overlapping IDs.
    // Older snapshots are collected while scrolling upwards.
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i];
      if (order.includes(id)) continue;
      const nextId = ids.slice(i + 1).find(candidate => order.includes(candidate));
      const prevId = ids.slice(0, i).reverse().find(candidate => order.includes(candidate));
      if (nextId) order.splice(order.indexOf(nextId), 0, id);
      else if (prevId) order.splice(order.indexOf(prevId) + 1, 0, id);
      else order.unshift(id);
    }
  }

  function expandVisibleCaptions() {
    // The text is genuinely truncated in WhatsApp's DOM until 'Read more' is clicked.
    // This changes only the local presentation of messages, not their content.
    const buttons = panel.querySelectorAll('[data-testid="caption-read-more-button"]');
    for (const btn of buttons) {
      if (btn.getAttribute('data-wa-copy-expanded') === '1') continue;
      btn.setAttribute('data-wa-copy-expanded', '1');
      btn.click();
    }
  }

  function scrollContainer() {
    // On WhatsApp versions that use a nested scrolling viewport, follow its
    // ancestors before falling back to a scrollable descendant.
    const candidates = [];
    for (let e = panel; e && e !== main.parentElement; e = e.parentElement) candidates.push(e);
    const inner = panel.querySelectorAll('[data-scrolltracepolicy], [role="application"]');
    for (const e of inner) if (!candidates.includes(e)) candidates.push(e);
    return candidates.find(el => {
      const computed = window.getComputedStyle(el);
      return el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(computed.overflowY);
    }) || candidates.find(el => el.scrollHeight > el.clientHeight + 20) || null;
  }

  const scroller = scrollContainer();
  const originalTop = scroller?.scrollTop ?? 0;
  const originalBottom = scroller ? (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) : 0;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  try {
    // Start at the most recent messages regardless of the user's previous scroll.
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
      await delay(230);
    }
    expandVisibleCaptions();
    await delay(110);
    scan();
    if (scroller) {
      let noMovement = 0;
      const maxPasses = Math.min(160, Math.max(30, Math.ceil(limit / 2)));
      for (let pass = 0; pass < maxPasses && order.length < limit; pass++) {
        const before = scroller.scrollTop;
        const countBefore = order.length;
        const distance = Math.max(350, Math.floor(scroller.clientHeight * 0.78));
        scroller.scrollTop = Math.max(0, before - distance);
        await delay(175);
        expandVisibleCaptions();
        scan();
        if (Math.abs(scroller.scrollTop - before) <= 1) {
          // Loading the next history batch may take longer than a scroll.
          await delay(600);
          expandVisibleCaptions();
          scan();
          if (order.length === countBefore) {
            noMovement++;
            if (noMovement >= 2) break;
          } else noMovement = 0;
        } else {
          noMovement = 0;
        }
        if (pass === maxPasses - 1 && order.length < limit) hitScrollLimit = true;
      }
    }
  } finally {
    if (scroller) {
      scroller.scrollTop = originalBottom <= 40 ? scroller.scrollHeight : originalTop;
    }
  }

  let messages = order.map(id => seen.get(id)).filter(Boolean).slice(-limit);
  // Infer which outgoing account name to use for grouped outbound bubbles.
  const selfNames = new Set(messages.filter(m => m.isMine && m.sender).map(m => m.sender));
  const visibleDates = messages.map(m => m.timestamp.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/)?.[0] || null);
  // Some media messages omit their full pre-plain-text metadata. Attach only
  // a nearby known date, never invent an exact time.
  for (let i = messages.length - 1, nearbyDate = ''; i >= 0; i--) {
    if (visibleDates[i]) nearbyDate = visibleDates[i];
    else if (nearbyDate && /^\d{1,2}:\d{2}$/.test(messages[i].timestamp)) {
      messages[i].timestamp = `${messages[i].timestamp}, ${nearbyDate}`;
    }
  }
  messages = messages.map(m => ({...m, isMine: m.isMine || (m.sender !== '' && selfNames.has(m.sender))}));

  const remainingPlaceholders = panel.querySelectorAll('[data-testid^="conv-msg-"]').length >
    panel.querySelectorAll('[data-testid="msg-container"]').length;
  return {
    ok: true,
    chatName,
    messages,
    partial: hitScrollLimit || (!scroller && remainingPlaceholders) || (readMoreFound && messages.some(m => m.truncated))
  };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage && !globalThis.__waCopyListenerInstalled) {
  globalThis.__waCopyListenerInstalled = true;
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (request?.type !== 'WA_CHAT_COPY_EXTRACT') return false;
    extractConversation(request.limit)
      .then(result => respond(result))
      .catch(err => respond({ok:false, error: err?.message || 'WhatsApp chat extraction failed.'}));
    return true;
  });
}
