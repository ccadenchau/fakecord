/* Discord-style Markdown. Raw HTML is disabled; custom token values are escaped. */
const MessageFormat = (() => {
  const md = markdownit({ html: false, linkify: true, breaks: true }).disable(['table', 'image']);
  const escape = md.utils.escapeHtml;
  md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return renderer.renderToken(tokens, index, options);
  };
  md.inline.ruler.before('text', 'discord', (state, silent) => {
    const source = state.src.slice(state.pos, state.posMax);
    const delimiter = source.startsWith('||') ? '||' : source.startsWith('__') ? '__' : null;
    if (delimiter) {
      const end = source.indexOf(delimiter, 2);
      if (end > 2) {
        if (!silent) {
          const token = state.push(delimiter === '||' ? 'spoiler' : 'underline', '', 0);
          token.content = source.slice(2, end);
        }
        state.pos += end + 2;
        return true;
      }
    }
    const match = /^(<@!?\d+>|<@&\d+>|<#\d+>|<a?:\w+:\d+>|<t:\d+(?::[tTdDfFR])?>|@(?:everyone|here)\b)/.exec(source);
    if (!match) return false;
    if (!silent) state.push('discord_token', '', 0).content = match[0];
    state.pos += match[0].length;
    return true;
  });
  // Make the text scanner stop before spoilers, including those after ordinary text.
  const textRule = md.inline.ruler.__rules__.find(rule => rule.name === 'text').fn;
  md.inline.ruler.at('text', (state, silent) => {
    const end = state.src.indexOf('||', state.pos + 1);
    const maximum = state.posMax;
    if (end > state.pos && end < maximum) state.posMax = end;
    const result = textRule(state, silent);
    state.posMax = maximum;
    return result;
  });
  md.renderer.rules.underline = (tokens, index, options, env) => `<u>${md.renderInline(tokens[index].content, env)}</u>`;
  md.renderer.rules.spoiler = (tokens, index, options, env) => `<span class="message-spoiler" role="button" tabindex="0" aria-label="Reveal spoiler" aria-expanded="false">${md.renderInline(tokens[index].content, env)}</span>`;
  md.renderer.rules.discord_token = (tokens, index, options, env) => {
    const value = tokens[index].content;
    if (value === '@everyone' || value === '@here') return `<span class="message-mention">${value}</span>`;
    let match = /^<(a?):(\w+):(\d+)>$/.exec(value);
    if (match) return `<img class="custom-emoji" alt=":${escape(match[2])}:" src="https://cdn.discordapp.com/emojis/${match[3]}.${match[1] ? 'gif' : 'png'}?size=48" loading="lazy">`;
    match = /^<t:(\d+)(?::([tTdDfFR]))?>$/.exec(value);
    if (match) {
      const date = new Date(Number(match[1]) * 1000);
      if (Number.isNaN(date.getTime())) return escape(value);
      const style = match[2] ?? 'f';
      let text;
      if (style === 'R') {
        const seconds = Math.round((date.getTime() - Date.now()) / 1000);
        const unit = Math.abs(seconds) < 60 ? 'second' : Math.abs(seconds) < 3600 ? 'minute' : Math.abs(seconds) < 86400 ? 'hour' : 'day';
        text = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(seconds / ({second:1,minute:60,hour:3600,day:86400}[unit])), unit);
      } else {
        text = date.toLocaleString([], style === 't' || style === 'T' ? {timeStyle:style === 't' ? 'short' : 'medium'} : style === 'd' || style === 'D' ? {dateStyle:style === 'd' ? 'short' : 'long'} : {dateStyle:style === 'F' ? 'full' : 'long',timeStyle:'short'});
      }
      return `<time class="message-mention" datetime="${date.toISOString()}">${escape(text)}</time>`;
    }
    const id = value.match(/\d+/)[0];
    if (value.startsWith('<#')) {
      const channel = env.channels?.find(channel => String(channel.id) === id);
      return `<span class="message-mention">#${escape(channel?.name ?? 'channel')}</span>`;
    }
    if (value.startsWith('<@&')) return '<span class="message-mention">@role</span>';
    const user = env.mentions?.find(user => String(user.id) === id);
    return `<span class="message-mention">@${escape(user?.global_name ?? user?.username ?? 'user')}</span>`;
  };
  function render(text, message = {}) {
    const channels = typeof guilds === 'undefined' ? [] : guilds.flatMap(guild => guild.channels ?? []);
    return md.render(text ?? '', { mentions: message.mentions ?? [], channels });
  }
  function wireSpoilers(container) {
    function toggle(target) {
      const spoiler = target.closest('.message-spoiler');
      if (!spoiler) return;
      spoiler.classList.toggle('revealed');
      const open = spoiler.classList.contains('revealed');
      spoiler.setAttribute('aria-expanded', String(open));
      spoiler.setAttribute('aria-label', open ? 'Hide spoiler' : 'Reveal spoiler');
    }
    container.addEventListener('click', event => {
      if (event.target.closest('.message-spoiler')) event.preventDefault();
      toggle(event.target);
    });
    container.addEventListener('keydown', event => {
      if (['Enter', ' '].includes(event.key) && event.target.classList.contains('message-spoiler')) { event.preventDefault(); toggle(event.target); }
    });
  }
  return { render, wireSpoilers };
})();
