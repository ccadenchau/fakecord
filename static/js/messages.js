function messageSourceLabel(source, className = '') {
  const label = element('div', 'message-source-label ' + className);
  const guild = typeof guilds !== 'undefined' ? guilds.find(item => String(item.id) === String(source.guild_id)) : null;
  const icon = source.icon ?? guild?.icon;
  const badge = element('span', 'message-source-icon', Array.from(source.guild || 'DM')[0]);
  if (icon && source.guild_id !== 'dm') {
    const image = element('img', '');
    image.src = 'https://cdn.discordapp.com/icons/' + encodeURIComponent(source.guild_id) + '/' + encodeURIComponent(icon) + '.png?size=32';
    image.alt = source.guild || '';
    image.addEventListener('error', () => image.remove());
    badge.append(image);
  }
  label.append(badge, element('span', 'message-source-channel', source.channel));
  return label;
}
function safeMessageURL(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function messageLink(url, label) {
  const link = element('a', '', label);
  const safe = safeMessageURL(url);
  if (safe) { link.href = safe; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  return link;
}
function messageMarkdown(text, message) {
  const body = element('div', 'message-body');
  body.innerHTML = MessageFormat.render(text, message);
  return body;
}
function renderMessages(key, log) {
  const existing = new Map([...log.querySelectorAll('[data-message]')].map(row => [row.dataset.message, row]));
  const nodes = [];
  const items = conversations.get(key) ?? [];
  let previous = null;
  let previousDate = null;
  for (const message of items) {
    const author = message.author ?? {};
    const name = message.member?.nick ?? author.global_name ?? author.username ?? 'Unknown user';
    const date = new Date(message.timestamp);
    const validDate = !Number.isNaN(date.getTime());
    const day = validDate ? date.toLocaleDateString() : '';
    if (day && day !== previousDate) {
      nodes.push(element('div', 'message-date-divider', date.toLocaleDateString([], { month:'long',day:'numeric',year:'numeric' })));
      previousDate = day;
      previous = null;
    }
    const grouped = previous && previous.author?.id === author.id && validDate && date - new Date(previous.timestamp) < 300000 && !message.referenced_message;
    const signature = JSON.stringify([message, Boolean(grouped)]);
    const oldRow = existing.get(String(message.id));
    if (oldRow?.messageSignature === signature) {
      nodes.push(oldRow); previous = message; continue;
    }
    const row = element('article', `message${grouped ? ' grouped' : ''}`);
    row.dataset.message = message.id;
    row.messageSignature = signature;
    const avatar = element('button', 'avatar self profile-avatar-button', Array.from(name)[0]);
    avatar.type = 'button';
    avatar.setAttribute('aria-label', `View ${name}'s profile`);
    bindProfileClick(avatar, () => ({id:author.id,user:author}));
    if (author.avatar && author.id) {
      const image = element('img', 'message-avatar');
      image.src = `https://cdn.discordapp.com/avatars/${encodeURIComponent(author.id)}/${encodeURIComponent(author.avatar)}.png?size=80`;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => image.remove());
      avatar.append(image);
    }

    const content = element('div', 'message-content');
    if (message.referenced_message) {
      const reply = message.referenced_message;
      const replyName = reply.author?.global_name ?? reply.author?.username ?? 'Unknown user';
      content.append(element('div', 'message-reply', `↪ ${replyName}: ${reply.content || 'Attachment'}`));
    }
    const meta = element('div', 'message-meta');
    const time = element('time', '', validDate ? date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : '');
    if (validDate) time.dateTime = date.toISOString();
    meta.append(element('span', 'message-author', name));
    if (author.bot) meta.append(element('span', 'message-bot', 'APP'));
    meta.append(time);
    content.append(meta, messageMarkdown(message.content, message));
    if (message.edited_timestamp) content.append(element('span', 'message-edited', '(edited)'));
    for (const attachment of message.attachments ?? []) {
      const url = safeMessageURL(attachment.proxy_url ?? attachment.url);
      if (!url) continue;
      if (attachment.content_type?.startsWith('image/')) {
        const link = messageLink(attachment.url ?? url);
        const image = element('img', 'message-attachment');
        image.src = url; image.alt = attachment.filename ?? 'Image'; image.loading = 'lazy';
        link.append(image);
        if (attachment.filename?.startsWith('SPOILER_')) {
          const spoiler = element('span', 'message-spoiler message-media-spoiler');
          spoiler.setAttribute('role', 'button'); spoiler.tabIndex = 0;
          spoiler.setAttribute('aria-label', 'Reveal spoiler'); spoiler.setAttribute('aria-expanded', 'false');
          spoiler.append(link); content.append(spoiler);
        } else content.append(link);
      } else if (attachment.content_type?.startsWith('video/') || attachment.content_type?.startsWith('audio/')) {
        const media = element(attachment.content_type.startsWith('video/') ? 'video' : 'audio', 'message-attachment');
        media.src = url; media.controls = true; media.preload = 'metadata'; content.append(media);
      } else content.append(messageLink(attachment.url ?? url, `📎 ${attachment.filename ?? 'Attachment'}`));
    }
    for (const embed of message.embeds ?? []) {
      const card = element('div', 'message-embed');
      if (Number.isInteger(embed.color)) card.style.borderLeftColor = `#${(embed.color & 0xffffff).toString(16).padStart(6,'0')}`;
      if (embed.author?.name) card.append(element('strong', 'embed-author', embed.author.name));
      if (embed.title) card.append(messageLink(embed.url, embed.title));
      if (embed.description) card.append(messageMarkdown(embed.description, message));
      for (const field of embed.fields ?? []) {
        const section = element('div', 'embed-field');
        section.append(element('strong', '', field.name), messageMarkdown(field.value, message)); card.append(section);
      }
      const imageURL = safeMessageURL(embed.image?.proxy_url ?? embed.image?.url ?? embed.thumbnail?.proxy_url ?? embed.thumbnail?.url);
      if (imageURL) { const image=element('img','message-attachment');image.src=imageURL;image.alt=embed.title ?? 'Embed image';image.loading='lazy';card.append(image); }
      if (embed.footer?.text) card.append(element('small', 'embed-footer', embed.footer.text));
      content.append(card);
    }
    if (message.reactions?.length) {
      const reactions = element('div', 'message-reactions');
      for (const reaction of message.reactions) {
        const badge = element('span', 'message-reaction');
        if (reaction.emoji?.id) {
          const image=element('img','custom-emoji');image.src=`https://cdn.discordapp.com/emojis/${encodeURIComponent(reaction.emoji.id)}.png?size=32`;image.alt=reaction.emoji.name ?? '';badge.append(image);
        } else badge.append(document.createTextNode(reaction.emoji?.name ?? ''));
        badge.append(document.createTextNode(` ${reaction.count}`)); reactions.append(badge);
      }
      content.append(reactions);
    }
    row.append(avatar, content); nodes.push(row); previous = message;
  }
  // Leave unchanged rows connected so focused avatars and profile anchors survive.
  for (let index = 0; index < nodes.length; index++) {
    if (log.children[index] !== nodes[index]) log.insertBefore(nodes[index], log.children[index] ?? null);
  }
  while (log.children.length > nodes.length) log.lastElementChild.remove();
}

class MessageFeed {
  constructor(workspace) {
    this.workspace = workspace;
    this.views = new Map();
    this.lastWatch = '';
    this.retry = 0;
    this.connect();
  }
  sync() {
    if (this.workspace.switching) return;
    const windows = [...this.workspace.windows.keys()].filter(key => key !== 'global/feed').map(key => {
      const [guild_id, channel_id] = key.split('/');
      return {guild_id, channel_id};
    });
    const channels = windows.map(window => window.channel_id);
    const output = Boolean(window.gatewayOutput?.visible);
    const signature = JSON.stringify({windows,output});
    if (this.socket?.readyState === WebSocket.OPEN && signature !== this.lastWatch) {
      this.socket.send(JSON.stringify({type:'WATCH',channels,windows,output})); this.lastWatch = signature;
    }
    for (const [key, view] of this.views) if (!this.workspace.windows.has(key)) { this.clearTyping(view); view.controller?.abort(); view.olderController?.abort(); view.resizeObserver?.disconnect(); this.views.delete(key); }
  }
  open(key, log, scroll, typing = null) {
    const view = {log,scroll,loading:false,loadingOlder:false,hasOlder:true,followBottom:true,typing,typers:new Map()};
    this.views.set(key, view);
    scroll.addEventListener('scroll', () => {
      view.followBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
      
      if (scroll.scrollTop < 60 && !view.followBottom) this.older(key);
    }, {passive:true});
    view.resizeObserver = new ResizeObserver(() => this.scrollToBottom(key));
    view.resizeObserver.observe(log);
    MessageFormat.wireSpoilers(log);
    this.sync();
    this.history(key);
  }
  merge(key, items) {
    const merged = new Map((conversations.get(key) ?? []).map(message => [String(message.id), message]));
    for (const message of items) merged.set(String(message.id), message);
    conversations.set(key, [...merged.values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0));
  }
  scrollToBottom(key) {
    const view = this.views.get(key);
    if (!view?.followBottom) return;
    requestAnimationFrame(() => {
      if (this.views.get(key) === view && view.followBottom && this.workspace.windows.has(key)) {
        view.scroll.scrollTop = view.scroll.scrollHeight;
      }
    });
  }
  redraw(key, bottom = false) {
    const view = this.views.get(key);
    if (!view || !this.workspace.windows.has(key)) return;
    const position = view.scroll.scrollTop;
    const nearBottom = view.scroll.scrollHeight - position - view.scroll.clientHeight < 80;
    view.followBottom = bottom || nearBottom;
    renderMessages(key, view.log);
    view.scroll.scrollTop = bottom || nearBottom ? view.scroll.scrollHeight : position;
    this.scrollToBottom(key);
    
  }
  async history(key) {
    const view = this.views.get(key);
    if (!view || view.loading) return;
    view.loading = true;
    view.pending = [];
    view.controller = new AbortController();
    if (!conversations.get(key)?.length) view.log.replaceChildren(element('p','history-status','Loading messages…'));
    try {
      const response = await fetch(`/api/channels/${encodeURIComponent(key.split('/')[1])}/messages`, {cache:'no-store',signal:view.controller.signal});
      if (!response.ok) {
        let detail;
        try { detail = (await response.json()).detail; } catch { /* Non-JSON error. */ }
        const error = new Error(typeof detail === 'string' ? detail : 'Could not load message history');
        error.status = response.status;
        throw error;
      }
      const items = await response.json();
      if (!Array.isArray(items)) throw new Error('Invalid message history');
      if (this.views.get(key) !== view || !this.workspace.windows.has(key)) return;
      // Prefer events received during this request over the history snapshot.
      const live = view.pending;
      view.hasOlder = items.length === 50 || (conversations.get(key)?.length ?? 0) > items.length;
      const oldest = items[0]?.id;
      const older = (conversations.get(key) ?? []).filter(item => oldest && BigInt(item.id) < BigInt(oldest));
      conversations.set(key, items);
      this.merge(key, [...older, ...live]);
      this.redraw(key, true);
    } catch (error) {
      if (error.name !== 'AbortError' && this.views.get(key) === view) {
        this.redraw(key);
        view.log.append(element('p', 'history-status', error.message));
        if (![401, 403, 404].includes(error.status)) {
          const retry = element('button','history-retry','Retry loading messages');
          retry.type='button';retry.addEventListener('click',()=>this.history(key));
          view.log.append(retry);
        }
      }
    } finally { view.loading = false; }
  }
  async older(key) {
    const view = this.views.get(key);
    const before = conversations.get(key)?.[0]?.id;
    if (!view || view.loading || view.loadingOlder || !view.hasOlder || !before) return;
    view.loadingOlder = true;
    view.followBottom = false;
    view.olderController = new AbortController();
    try {
      const response = await fetch(`/api/channels/${encodeURIComponent(key.split('/')[1])}/messages?before=${encodeURIComponent(before)}`, {cache:'no-store',signal:view.olderController.signal});
      if (!response.ok) throw new Error('Could not load older messages');
      const items = await response.json();
      if (!Array.isArray(items)) throw new Error('Invalid message history');
      if (this.views.get(key) !== view || !this.workspace.windows.has(key)) return;
      const anchor = view.log.querySelector(`[data-message="${before}"]`);
      const anchorTop = anchor?.getBoundingClientRect().top;
      const height = view.scroll.scrollHeight;
      const position = view.scroll.scrollTop;
      this.merge(key, items);
      renderMessages(key, view.log);
      view.followBottom = false;
      const restorePosition = () => {
        const replacement = view.log.querySelector(`[data-message="${before}"]`);
        if (anchorTop !== undefined && replacement) {
          view.scroll.scrollTop += replacement.getBoundingClientRect().top - anchorTop;
        } else view.scroll.scrollTop = position + view.scroll.scrollHeight - height;
      };
      restorePosition();
      requestAnimationFrame(() => {
        if (this.views.get(key) === view && !view.followBottom) restorePosition();
      });
      view.hasOlder = items.length === 50 && items.some(item => BigInt(item.id) < BigInt(before));
    } catch (error) {
      if (error.name !== 'AbortError' && this.views.get(key) === view) {
        const retry = element('button','history-retry','Retry older messages');
        retry.type='button';retry.addEventListener('click',()=>{retry.remove();this.older(key);});
        view.log.prepend(retry);
      }
    } finally { view.loadingOlder = false; }
  }
  updateTyping(view) {
    if (!view.typing) return;
    const names = [...view.typers.values()].map(user => user.name);
    view.typing.textContent = names.length === 1 ? `${names[0]} is typing…`
      : names.length === 2 ? `${names[0]} and ${names[1]} are typing…`
      : names.length > 2 ? `${names[0]}, ${names[1]} and ${names.length - 2} others are typing…` : '';
  }
  clearTyping(view, userId = null) {
    if (userId !== null) {
      const user = view.typers.get(String(userId));
      if (user) clearTimeout(user.timer);
      view.typers.delete(String(userId));
    } else {
      for (const user of view.typers.values()) clearTimeout(user.timer);
      view.typers.clear();
    }
    this.updateTyping(view);
  }
  receiveTyping(data) {
    if (!data?.channel_id || !data.user_id) return;
    for (const [key, view] of this.views) {
      if (key.split('/')[1] !== String(data.channel_id) || !view.typing || !this.workspace.windows.has(key)) continue;
      const userId = String(data.user_id);
      const user = data.member?.user
        ?? (typeof dms === 'undefined' ? [] : dms).flatMap(dm => dm.recipients ?? []).find(user => String(user.id) === userId)
        ?? (conversations.get(key) ?? []).find(message => String(message.author?.id) === userId)?.author;
      const name = data.member?.nick ?? user?.global_name ?? user?.username ?? 'Someone';
      this.clearTyping(view, userId);
      const timer = setTimeout(() => {
        if (this.views.get(key) === view) this.clearTyping(view, userId);
      }, 8000);
      view.typers.set(userId, { name, timer });
      this.updateTyping(view);
    }
  }
  connect() {
    this.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/messages`);
    this.socket.addEventListener('open', () => { window.globalFeed?.load();this.retry=0;this.lastWatch='';this.sync();for(const key of this.views.keys())this.history(key); });
    this.socket.addEventListener('message', event => {
      let payload;try {payload=JSON.parse(event.data);} catch {return;}
      if (payload.type === 'GATEWAY_LOG' || payload.type === 'GATEWAY_LOG_HISTORY') {
        window.gatewayOutput?.receive(payload);
      } else if (payload.type === 'TYPING_START') {
        this.receiveTyping(payload.data);
      } else if (payload.type === 'MESSAGE_CREATE') {
        const message=payload.data;
        if (!message?.id || !message.channel_id) return;
        window.messageDots?.receive(message,payload.source);
        window.globalFeed?.receive(message, payload.source);
        for (const key of this.workspace.windows.keys()) {
          if (key.split('/')[1] === String(message.channel_id)) {
            const view = this.views.get(key);
            if (view) this.clearTyping(view, message.author?.id ?? null);
            if (view?.loading) view.pending.push(message);
            this.merge(key,[message]);this.redraw(key);
          }
        }
      } else if (payload.type === 'RESYNC' || payload.type === 'CONNECTION' && payload.connected) {
        
        for (const key of this.views.keys()) this.history(key);
      }
      if(payload.type==='CONNECTION' && !payload.connected) for (const view of this.views.values()) this.clearTyping(view);
      if(payload.type==='CONNECTION') document.getElementById('message-connection').textContent=payload.connected?'':'Gateway disconnected';
    });
    this.socket.addEventListener('close', () => {
      for (const view of this.views.values()) this.clearTyping(view);
      document.getElementById('message-connection').textContent='Reconnecting…';
      setTimeout(()=>this.connect(),Math.min(1000*2**this.retry++,15000));
    });
    this.socket.addEventListener('error', () => this.socket.close());
  }
}
