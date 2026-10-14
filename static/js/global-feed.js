window.globalFeed = {
  items:new Map(), loading:false,
  get visible() { return typeof channelWorkspace !== 'undefined' && Boolean(channelWorkspace?.windows.has('global/feed')); },
  container() { return channelWorkspace?.windows.get('global/feed')?.querySelector('.global-messages'); },
  sync() { document.getElementById('toggle-global').setAttribute('aria-pressed',String(this.visible)); },
  receive(message, source) {
    this.items.set(String(message.id),{message,source:source??{guild:message.guild_id??'Direct Messages',channel:message.channel_id}});
    const sorted=[...this.items.values()].sort((a,b)=>BigInt(a.message.id)<BigInt(b.message.id)?-1:1).slice(-200);
    this.items=new Map(sorted.map(item=>[String(item.message.id),item]));
    if(this.visible&&!this.loading)this.render();
  },
  async load() {
    if(this.loading)return;this.loading=true;
    try {
      const response=await fetch('/api/messages/global',{cache:'no-store'});if(!response.ok)throw new Error('Could not load global messages');
      const items=await response.json();if(!Array.isArray(items))throw new Error('Invalid response');
      for(const item of items){if(!this.items.has(String(item.message.id)))this.receive(item.message,item.source);}
      if(this.visible)this.render();
    } catch {
      if(this.visible){const retry=element('button','history-retry','Retry loading global messages');retry.type='button';retry.addEventListener('click',()=>this.load());this.container()?.append(retry);}
    } finally{this.loading=false;}
  },
  render() {
    const container=this.container();if(!container)return;
    const bottom=container.scrollHeight-container.scrollTop-container.clientHeight<80;const position=container.scrollTop;
    const existing = new Map([...container.children].map(node=>[node.dataset?.message,node]));
    const nodes=[];
    for(const item of this.items.values()){
      const signature=JSON.stringify(item);
      const old=existing.get(String(item.message.id));
      if(old?.messageSignature===signature){nodes.push(old);continue;}
      const section=element('section','global-entry');
      section.dataset.message=String(item.message.id);section.messageSignature=signature;
      const label=messageSourceLabel(item.source,'global-message-source');
      const log=element('div','messages');
      conversations.set('__global__',[item.message]);renderMessages('__global__',log);conversations.delete('__global__');
      log.querySelector('.message-date-divider')?.remove();section.append(label,log);nodes.push(section);
    }
    if(!this.items.size)nodes.push(element('p','history-status','No messages yet'));
    for(let index=0;index<nodes.length;index++)if(container.children[index]!==nodes[index])container.insertBefore(nodes[index],container.children[index]??null);
    while(container.children.length>nodes.length)container.lastElementChild.remove();
    container.scrollTop=bottom?container.scrollHeight:position;
  },
  open() {
    const key='global/feed';
    if(channelWorkspace.windows.has(key)){channelWorkspace.focus(key);return;}
    const content=element('article','channel-window global-window');
    content.setAttribute('aria-label','Global message feed');
    const header=element('header','window-titlebar');header.tabIndex=0;
    const title=element('div','window-title');title.append(element('strong','','Global'));
    const actions=element('div','window-actions');
    const maximize=element('button','maximize-window','□');maximize.type='button';maximize.setAttribute('aria-label','Maximize window');
    maximize.addEventListener('click',()=>channelWorkspace.maximize(key));
    const close=element('button','close-window','×');close.type='button';close.setAttribute('aria-label','Close global feed');
    close.addEventListener('click',()=>{channelWorkspace.close(key);this.sync();});
    actions.append(maximize,close);header.append(title,actions);
    const messages=element('div','global-messages');MessageFormat.wireSpoilers(messages);
    content.append(header,messages);
    channelWorkspace.add(key,content);
    channelWorkspace.windows.get(key).conversation={kind:'global'};
    channelWorkspace.save();this.sync();this.render();this.load();
  }
};
document.getElementById('toggle-global').addEventListener('click',()=>window.globalFeed.open());
