let guilds = [];
let dms = [];
let sidebarMode = "guild";
const guildList = document.getElementById("guild-list");
const channelList = document.getElementById("channel-list");
const conversations = new Map();
let currentGuild = null;
let channelWorkspace;
let guildSelection = 0;
let messageFeed;
let workspaceTabs;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function updateChannels() {
  if (channelWorkspace?.switching) return;
  window.messageDots?.focus();
  messageFeed?.sync();
  window.globalFeed?.sync();
  if (!channelWorkspace) return;
  for (const button of channelList.querySelectorAll("button[data-channel]")) {
    const key = `${sidebarMode === "dms" ? "dm" : currentGuild?.id}/${button.dataset.channel}`;
    const opened = channelWorkspace.windows.has(key);
    button.classList.toggle("active", channelWorkspace.focused === key);
    button.setAttribute("aria-label", `${button.dataset.name}, ${opened ? "focus window" : "open channel"}`);

  }
}
function openChannel(guild, channel) {
  const key = `${guild.id}/${channel.id}`;
  if (channelWorkspace.windows.has(key)) { channelWorkspace.focus(key, true); return; }
  const content = element("article", "channel-window");
  content.setAttribute("aria-label", `${guild.name}, ${channel.name}`);
  const titlebar = element("header", "window-titlebar");
  titlebar.tabIndex = 0;
  titlebar.setAttribute("aria-label", `${guild.name}, ${channel.name}. Arrow keys move; Shift and arrows resize.`);
  const title = element("div", "window-title");
  const isDM = guild.id === "dm";
  const icon = element("span", "window-guild-icon", Array.from(isDM ? channel.name : guild.name)[0]);
  icon.setAttribute("aria-hidden", "true");
  const recipient = channel.recipients?.[0];
  const iconURL = !isDM && guild.icon
    ? `https://cdn.discordapp.com/icons/${encodeURIComponent(guild.id)}/${encodeURIComponent(guild.icon)}.png?size=64`
    : isDM && channel.icon
      ? `https://cdn.discordapp.com/channel-icons/${encodeURIComponent(channel.id)}/${encodeURIComponent(channel.icon)}.png?size=64`
      : isDM && recipient?.avatar
        ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(recipient.id)}/${encodeURIComponent(recipient.avatar)}.png?size=64`
        : null;
  if (iconURL) {
    const image = element("img");
    image.src = iconURL;
    image.alt = "";
    image.addEventListener("error", () => image.remove());
    icon.append(image);
  }
  title.append(icon);
  if (!isDM) title.append(channelIcon(channel.type));
  title.append(element("strong", "", channel.name));
  const actions = element("div", "window-actions");
  const maximize = element("button", "maximize-window", "□");
  maximize.type = "button";
  maximize.setAttribute("aria-label", "Maximize window");
  maximize.title = "Maximize";
  maximize.addEventListener("click", () => channelWorkspace.maximize(key));
  const close = element("button", "close-window", "×");
  close.type = "button";
  close.setAttribute("aria-label", `Close ${guild.name}, ${channel.name}`);
  close.title = "Close";
  close.addEventListener("click", () => { channelWorkspace.close(key); if (!channelWorkspace.windows.size) channelList.querySelector("button")?.focus(); });
  actions.append(maximize, close);
  titlebar.append(title, actions);
  const scroll = element("div", "chat-scroll");
  const log = element("div", "messages");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-label", `${guild.name}, ${channel.name} messages`);
  scroll.append(log);
  const form = element("form", "composer");
  const input = element("input");
  input.placeholder = `Message ${guild.id === "dm" ? "" : "#"}${channel.name}`;
  input.setAttribute("aria-label", `Message ${guild.name}, ${channel.name}`);
  input.maxLength = 2000;
  input.autocomplete = "off";
  const send = element("button", "", "➤");
  send.type = "submit";
  send.setAttribute("aria-label", "Send message");
  send.title = "Send";
  form.append(input, send);
  const sendStatus = element("p", "send-status");
  sendStatus.setAttribute("role", "status");
  let sending = false;
  let attempt = null;
  let cooldownUntil = 0;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const text = input.value;
    if (sending || !text.trim()) return;
    if (Date.now() < cooldownUntil) {
      sendStatus.textContent = "Wait a moment before sending again";
      return;
    }
    if (!attempt || attempt.content !== text) {
      const random = new Uint32Array(1);
      crypto.getRandomValues(random);
      attempt = { content: text, nonce: `${Date.now()}${random[0]}` };
    }
    form.dataset.sending = "true";
    sending = true; send.disabled = true; input.disabled = true;
    sendStatus.textContent = "Sending…";
    try {
      const response = await fetch(`/api/channels/${encodeURIComponent(channel.id)}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(attempt),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 429) cooldownUntil = Date.now() + Number(response.headers.get("Retry-After") || 2) * 1000;
        throw new Error(data.detail || "Could not send message");
      }
      const view = messageFeed.views.get(key);
      if (view?.loading) view.pending.push(data);
      messageFeed.merge(key, [data]);
      messageFeed.redraw(key, true);
      input.value = ""; attempt = null; sendStatus.textContent = "";
    } catch (error) {
      sendStatus.textContent = error.message || "Could not send message. Your draft is preserved";
    } finally {
      form.dataset.sending = "false";
      sending = false; send.disabled = false; input.disabled = false;
      if (content.isConnected) input.focus();
    }
  });
  const typing = element("div", "typing-indicator");
  typing.setAttribute("role", "status");
  typing.setAttribute("aria-live", "polite");
  content.append(titlebar, scroll, typing, sendStatus, form);
  channelWorkspace.add(key, content);
  channelWorkspace.windows.get(key).conversation = {
    guild: {id:guild.id,name:guild.name,icon:guild.icon},
    channel: {id:channel.id,name:channel.name,type:channel.type,icon:channel.icon,recipients:channel.recipients},
  };
  channelWorkspace.save();
  messageFeed.open(key, log, scroll, typing);
}
async function fetchChannels(guild) {
  const response = await fetch(`/api/guilds/${encodeURIComponent(guild.id)}/channels`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Channel request failed: ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Invalid channel response");
  guild.categories = data.filter(channel => channel.type === 4)
    .map(category => ({ ...category, id: String(category.id) }))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  guild.channels = data.filter(channel => [0, 2, 5, 10, 11, 12, 13, 15, 16].includes(channel.type))
    .map(channel => ({ ...channel, id: String(channel.id) }))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}
async function selectGuild(guild) {
  const banner = document.getElementById("guild-banner");
  banner.hidden = !guild.banner;
  const categoryControls = document.querySelector(".category-controls");
  (guild.banner ? banner : document.querySelector(".guild-header")).append(categoryControls);
  document.getElementById("guild-banner-name").textContent = guild.name;
  document.getElementById("guild-name").hidden = Boolean(guild.banner);
  document.getElementById("channel-sidebar").classList.toggle("has-banner", Boolean(guild.banner));
  banner.style.backgroundImage = guild.banner ? `url("https://cdn.discordapp.com/banners/${encodeURIComponent(guild.id)}/${encodeURIComponent(guild.banner)}.${guild.banner.startsWith("a_") ? "gif" : "png"}?size=600")` : "";
  sidebarMode = "guild";
  document.getElementById("dm-home").setAttribute("aria-pressed", "false");
  document.getElementById("refresh-dms").hidden = true;
  document.querySelector(".category-controls").hidden = false;
  channelList.setAttribute("aria-label", "Channels");
  channelTooltip.hide();
  document.getElementById("collapse-categories").disabled = true;
  document.getElementById("expand-categories").disabled = true;
  const selection = ++guildSelection;
  currentGuild = guild;
  document.getElementById("guild-name").textContent = guild.name;
  for (const button of guildList.children) {
    const active = button.dataset.guild === guild.id;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  channelList.replaceChildren(element("p", "sidebar-status", "Loading channels…"));
  try {
    await fetchChannels(guild);
    if (selection !== guildSelection) return;
    renderChannelList(guild, channelList, openChannel);
    updateChannels();
  } catch (error) {
    if (selection !== guildSelection) return;
    const retry = element("button", "channel-button", "Retry loading channels");
    retry.type = "button";
    retry.addEventListener("click", () => selectGuild(guild));
    channelList.replaceChildren(element("p", "sidebar-status", "Couldn’t load channels"), retry);
    console.error(error);
  }
}
async function refreshServerList(force = false) {
  const control = document.getElementById("refresh-guilds");
  control.disabled = true;
  try {
    const response = await fetch(`/api/guilds${force ? "?refresh=true" : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load servers");
    document.getElementById("refresh-guilds").dataset.updated = response.headers?.get("X-Cache-Last-Updated") || "";
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Invalid guild response");
    guilds = data.map(guild => ({ ...guild, channels: guilds.find(old => old.id === guild.id)?.channels ?? [] }));
    guildList.replaceChildren();
    for (const guild of guilds) {
      const initials = guild.name.trim().split(/\s+/u).slice(0, 2).map(word => Array.from(word)[0]).join("").toUpperCase() || "#";
      const button = element("button", "guild-button", initials);
      button.type = "button";
      button.dataset.guild = guild.id;
      button.addEventListener("pointerenter", () => channelTooltip.show(button, guild.name));
      button.addEventListener("pointerleave", () => channelTooltip.deferHide());
      button.addEventListener("focus", () => channelTooltip.show(button, guild.name));
      button.addEventListener("blur", () => channelTooltip.hide());
      button.addEventListener("click", () => channelTooltip.hide());
      button.setAttribute("aria-label", guild.name);
      const active = sidebarMode === "guild" && currentGuild?.id === guild.id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      if (guild.icon) {
        const image = element("img", "guild-icon");
        image.src = `https://cdn.discordapp.com/icons/${encodeURIComponent(guild.id)}/${encodeURIComponent(guild.icon)}.png?size=96`;
        image.alt = ""; image.loading = "lazy";
        image.addEventListener("error", () => image.remove()); button.append(image);
      }
      button.addEventListener("click", () => selectGuild(guild)); guildList.append(button);
    }
    if (force && sidebarMode === "guild") {
      const selected = guilds.find(guild => guild.id === currentGuild?.id) ?? guilds[0];
      if (selected) await selectGuild(selected);
      else { currentGuild = null; document.getElementById("guild-name").textContent = ""; channelList.replaceChildren(element("p", "sidebar-status", "No servers")); }
    }
    control.setAttribute("aria-label", "Refresh server list");
  } catch (error) {
    control.setAttribute("aria-label", "Server refresh failed. Retry refresh");
    const status = element("p", "sidebar-status", "Couldn’t refresh servers");
    guildList.querySelector(".server-error")?.remove(); status.classList.add("server-error"); guildList.append(status);
    throw error;
  } finally { control.disabled = false; }
}
async function fetchDMs(force = false) {
  const response = await fetch(`/api/dms${force ? "?refresh=true" : ""}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load DMs");
  document.getElementById("refresh-dms").dataset.updated = response.headers?.get("X-Cache-Last-Updated") || "";
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Invalid DM response");
  return data.filter(dm => [1, 3].includes(dm.type)).map(dm => ({
    ...dm, id: String(dm.id),
    name: dm.name || (dm.recipients ?? []).map(user => user.global_name || user.username).join(", ") || "Direct Message",
  }));
}
async function showDMs(force = false) {
  document.querySelector(".guild-header").append(document.querySelector(".category-controls"));
  document.getElementById("guild-banner").hidden = true;
  document.getElementById("guild-name").hidden = false;
  document.getElementById("channel-sidebar").classList.remove("has-banner");
  sidebarMode = "dms";
  currentGuild = null;
  const selection = ++guildSelection;
  channelTooltip.hide();
  document.getElementById("dm-home").setAttribute("aria-pressed", "true");
  document.querySelector(".category-controls").hidden = true;
  document.getElementById("guild-name").textContent = "Direct Messages";
  channelList.setAttribute("aria-label", "Direct messages");
  for (const button of guildList.querySelectorAll("button")) { button.classList.remove("active"); button.setAttribute("aria-pressed", "false"); }
  const refresh = document.getElementById("refresh-dms");
  refresh.hidden = false; refresh.disabled = true;
  channelList.replaceChildren(element("p", "sidebar-status", "Loading DMs…"));
  try {
    const loaded = await fetchDMs(force);
    if (selection !== guildSelection) return;
    dms = loaded;
    channelList.replaceChildren();
    for (const dm of dms) {
      const button = element("button", "channel-button dm-button");
      button.type = "button"; button.dataset.channel = dm.id; button.dataset.name = dm.name;
      const avatar = element("span", "avatar self dm-avatar", Array.from(dm.name)[0]);
      const recipient = dm.recipients?.[0];
      if (dm.type === 1 && recipient?.id) {
        avatar.setAttribute("role", "button"); avatar.tabIndex = 0;
        avatar.setAttribute("aria-label", `View ${dm.name}'s profile`);
        bindProfileClick(avatar, () => ({id:recipient.id,user:recipient}));
      }

      const imageURL = dm.icon ? `https://cdn.discordapp.com/channel-icons/${encodeURIComponent(dm.id)}/${encodeURIComponent(dm.icon)}.png?size=64` : recipient?.avatar ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(recipient.id)}/${encodeURIComponent(recipient.avatar)}.png?size=64` : null;
      if (imageURL) { const image = element("img", "message-avatar"); image.src = imageURL; image.alt = ""; image.loading = "lazy"; image.addEventListener("error", () => image.remove()); avatar.append(image); }
      button.append(avatar, element("span", "channel-label", dm.name));
      button.addEventListener("click", () => openChannel({id:"dm",name:"Direct Messages"}, dm)); channelList.append(button);
    }
    if (!dms.length) channelList.append(element("p", "sidebar-status", "No DMs"));
    updateChannels();
  } catch (error) {
    if (selection !== guildSelection) return;
    const retry = element("button", "channel-button", "Retry loading DMs");
    retry.type = "button"; retry.addEventListener("click", () => showDMs(force));
    channelList.replaceChildren(element("p", "sidebar-status", "Couldn’t load DMs"), retry);
  } finally { if (selection === guildSelection) refresh.disabled = false; }
}
async function loadGuilds() {
  channelWorkspace = new ChannelWorkspace(updateChannels);
  messageFeed = new MessageFeed(channelWorkspace);
  workspaceTabs = new WorkspaceTabs(channelWorkspace, messageFeed, openChannel);
  if (workspaceTabs.hasSaved) workspaceTabs.activate(workspaceTabs.activeId, true);
  channelList.append(element("p", "sidebar-status", "Loading servers…"));
  try {
    await refreshServerList();
    const savedChannels = workspaceTabs.hasSaved ? [] : channelWorkspace.readSaved() ?? [];
    if (guilds.length && guildSelection === 0) await selectGuild(guilds[0]);
    else if (!guilds.length && guildSelection === 0) await showDMs();
    const loadedGuilds = new Set(currentGuild ? [currentGuild.id] : []);
    for (const key of savedChannels.slice(0, 30)) {
      if (typeof key !== "string") continue;
      const [id, channel] = key.split("/");
      if (id === "dm") {
        if (!dms.length) {
          try { dms = await fetchDMs(); } catch { continue; }
        }
        const dm=dms.find(dm=>dm.id===channel);if(dm)openChannel({id:"dm",name:"Direct Messages"},dm);
        continue;
      }
      const guild = guilds.find(item => item.id === id);
      if (!guild) continue;
      if (!loadedGuilds.has(id)) { loadedGuilds.add(id); try { await fetchChannels(guild); } catch { continue; } }
      const savedChannel = guild.channels.find(item => item.id === channel);
      if (savedChannel) openChannel(guild, savedChannel);
    }
    workspaceTabs.capture();
  } catch (error) {
    if (!workspaceTabs) workspaceTabs = new WorkspaceTabs(channelWorkspace, messageFeed, openChannel);
    if (sidebarMode === "guild") channelList.replaceChildren(element("p", "sidebar-status", "Couldn’t load servers"));
  }
}
document.getElementById("dm-home").addEventListener("click", () => showDMs());
document.getElementById("refresh-guilds").addEventListener("click", () => refreshServerList(true).catch(() => {}));
document.getElementById("refresh-dms").addEventListener("click", () => showDMs(true));
loadGuilds();
