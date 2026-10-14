// Session-only attention dots. No read markers or mention counts.
window.messageDots = {
  channels: new Map(),
  seen: new Set(),
  receive(message, source) {
    const id=String(message.id);
    if(this.seen.has(id))return;
    this.seen.add(id);
    if(this.seen.size>2000)this.seen.delete(this.seen.values().next().value);
    if(String(message.author?.id)===String(window.currentProfile?.id))return;
    const channel=String(message.channel_id);
    const focused=typeof channelWorkspace!=='undefined'?channelWorkspace?.focused:null;
    if(document.visibilityState==='visible'&&focused?.split('/')[1]===channel)return;
    this.channels.set(channel,String(source?.guild_id??message.guild_id??'dm'));
    this.render();
  },
  focus() {
    const focused=typeof channelWorkspace!=='undefined'?channelWorkspace?.focused:null;
    if(document.visibilityState==='visible'&&focused)this.channels.delete(focused.split('/')[1]);
    this.render();
  },
  render() {
    for(const button of document.querySelectorAll('[data-channel]'))button.classList.toggle('has-new-message',this.channels.has(button.dataset.channel));
    for(const button of document.querySelectorAll('[data-guild]'))button.classList.toggle('has-new-message',[...this.channels.values()].includes(button.dataset.guild));
    document.getElementById('dm-home')?.classList.toggle('has-new-message',[...this.channels.values()].includes('dm'));
  }
};
document.addEventListener('visibilitychange',()=>window.messageDots.focus());
