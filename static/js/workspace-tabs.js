class WorkspaceTabs {
  constructor(workspace, feed, open) {
    this.workspace=workspace;this.feed=feed;this.open=open;this.key='fakecord.workspaces.v1';
    this.items=[{id:crypto.randomUUID(),name:'Main',state:{mode:'grid',layouts:{grid:{},freeform:{}},windows:[]}}];
    this.activeId=this.items[0].id;this.hasSaved=false;
    try {
      const saved=JSON.parse(localStorage.getItem(this.key));
      if(Array.isArray(saved?.items)&&saved.items.length&&saved.items.every(item=>typeof item.id==='string'&&typeof item.name==='string'&&Array.isArray(item.state?.windows))) {
        this.items=saved.items;this.activeId=this.items.some(item=>item.id===saved.active)?saved.active:this.items[0].id;this.hasSaved=true;
      }
    } catch { /* Ignore invalid storage. */ }
    workspace.onSave=()=>this.capture();
    document.getElementById('add-workspace').addEventListener('click',()=>{
      const item={id:crypto.randomUUID(),name:'Untitled',state:{mode:this.workspace.mode,layouts:{grid:{},freeform:{}},windows:[]}};
      this.items.push(item);if(!this.activate(item.id))this.items.pop();
    });
    document.getElementById('workspace-name').addEventListener('input',event=>{
      const item=this.items.find(item=>item.id===this.renameId);
      if(item){item.name=event.target.value.trim()||'Untitled';this.persist();}
    });
    document.getElementById('workspace-editor').addEventListener('submit',event=>{event.preventDefault();this.closeEditor();});
    document.addEventListener('pointerdown',event=>{
      const editor=document.getElementById('workspace-editor');
      const input=document.getElementById('workspace-name');
      if(this.renameId&&!input.contains(event.target))this.closeEditor();
    });
    document.addEventListener('keydown',event=>{if(event.key==='Escape')this.closeEditor();});
    this.render();
  }
  closeEditor() {
    const editor=document.getElementById('workspace-editor');
    editor.hidden=true;editor.prepend(document.getElementById('workspace-name'));
    this.renameId=null;this.render();
  }
  edit(rename, id=this.activeId) {
    this.closeEditor();this.renameId=id;
    const input=document.getElementById('workspace-name');
    input.value=this.items.find(item=>item.id===id).name;
    input.setAttribute('form','workspace-editor');input.className='inline-tab-name';
    const wrapper=[...document.getElementById('workspace-tabs').children].find(node=>node.dataset.id===id);
    const title=wrapper.querySelector('[role="tab"]');title.hidden=true;
    wrapper.insertBefore(input,title);
    const editor=document.getElementById('workspace-editor');editor.hidden=true;
    input.focus();input.select();
  }
  delete(id) {
    if(this.items.length<2)return;
    const item=this.items.find(item=>item.id===id);
    if(!window.confirm(`Are you sure you want to delete "${item.name}"?`))return;
    if(id===this.activeId&&!this.activate(this.items.find(item=>item.id!==id).id))return;
    this.items=this.items.filter(item=>item.id!==id);this.persist();this.render();
  }
  persist() {try{localStorage.setItem(this.key,JSON.stringify({active:this.activeId,items:this.items}));}catch{/* Optional storage. */}}
  capture() {
    if(this.workspace.switching)return;
    const item=this.items.find(item=>item.id===this.activeId);if(!item)return;
    this.workspace.snapshot();
    item.state={mode:this.workspace.mode,gridResolution:4,layouts:JSON.parse(JSON.stringify(this.workspace.layouts)),windows:[...this.workspace.windows.values()].filter(node=>node.conversation).map(node=>({ ...node.conversation,draft:node.querySelector('input')?.value??'' }))};
    this.persist();
  }
  activate(id, initial=false) {
    if(!initial&&id===this.activeId)return true;
    if([...this.workspace.windows.values()].some(node=>node.querySelector('form')?.dataset.sending==='true')) {
      document.getElementById('workspace-status').textContent='Wait for sending to finish';return false;
    }
    const target=this.items.find(item=>item.id===id);if(!target)return false;
    if(!initial)this.capture();
    const workspace=this.workspace;workspace.switching=true;workspace.suspended=true;
    workspace.freeform.cancel();workspace.restore();
    for(const view of this.feed.views.values()){view.controller?.abort();view.olderController?.abort();view.resizeObserver?.disconnect();this.feed.clearTyping(view);}
    this.feed.views.clear();
    workspace.grid.removeAll(true,false);
    for(const node of workspace.windows.values())node.remove();
    workspace.windows.clear();workspace.focused=null;
    workspace.layouts=workspace.normalizeLayouts(target.state.layouts,target.state.gridResolution);
    workspace.setMode(['grid','freeform'].includes(target.state.mode)?target.state.mode:'grid',false);
    this.activeId=id;
    for(const saved of target.state.windows){
      if(saved.kind==='global'){window.globalFeed.open();continue;}
      if(!saved.guild?.id||!saved.channel?.id)continue;
      this.open(saved.guild,saved.channel);
      const input=workspace.windows.get(`${saved.guild.id}/${saved.channel.id}`)?.querySelector('input');if(input)input.value=saved.draft??'';
    }
    workspace.suspended=false;workspace.switching=false;
    workspace.refresh();this.feed.sync();this.persist();this.render();
    document.getElementById('workspace-status').textContent='';return true;
  }
  render() {
    const editor=document.getElementById('workspace-editor');
    const input=document.getElementById('workspace-name');
    if(input.parentElement && input.parentElement!==editor){editor.prepend(input);editor.hidden=true;}
    const tabs=document.getElementById('workspace-tabs');tabs.replaceChildren();
    this.items.forEach((item,index)=>{
      const wrapper=document.createElement('div');wrapper.className='workspace-tab';wrapper.dataset.id=item.id;wrapper.classList.toggle('active',item.id===this.activeId);
      const button=document.createElement('button');button.type='button';button.textContent=item.name;button.setAttribute('role','tab');
      const close=document.createElement('button');close.type='button';close.className='tab-close';close.textContent='×';close.setAttribute('aria-label',`Delete ${item.name}`);close.disabled=this.items.length<2;
      close.addEventListener('click',()=>this.delete(item.id));
      button.setAttribute('aria-selected',String(item.id===this.activeId));button.tabIndex=item.id===this.activeId?0:-1;
      button.addEventListener('click',()=>{
        if(item.id===this.activeId)this.edit(true,item.id);
        else this.activate(item.id);
      });
      button.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=this.items[(index+(event.key==='ArrowRight'?1:-1)+this.items.length)%this.items.length];this.activate(next.id);document.querySelector('#workspace-tabs [aria-selected="true"]').focus();}});
      wrapper.append(button,close);tabs.append(wrapper);
    });
  }
}
window.addEventListener('beforeunload',()=>workspaceTabs?.capture());
