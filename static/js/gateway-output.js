window.gatewayOutput = {
  visible:false, paused:false, lines:[],
  receive(event) {
    if(event.type==='GATEWAY_LOG_HISTORY')this.lines=[];
    const data=event.type==='GATEWAY_LOG_HISTORY'?event.data:[event.data];
    for(const item of data??[])this.lines.push(item);
    this.lines=this.lines.slice(-200);if(!this.paused)this.render();
  },
  render() {
    const log=document.getElementById('gateway-lines');const bottom=log.scrollHeight-log.scrollTop-log.clientHeight<40;
    log.replaceChildren();
    for(const item of this.lines){const row=document.createElement('pre');row.className='gateway-line';row.textContent=`${new Date(item.timestamp*1000).toLocaleTimeString()} ${item.direction==='out'?'→':'←'} ${JSON.stringify(item.payload)}`;log.append(row);}
    if(bottom)log.scrollTop=log.scrollHeight;
  },
  toggle() {this.visible=!this.visible;document.getElementById('gateway-output').hidden=!this.visible;document.getElementById('toggle-output').setAttribute('aria-pressed',String(this.visible));messageFeed?.sync();if(this.visible)this.render();}
};
document.getElementById('toggle-output').addEventListener('click',()=>window.gatewayOutput.toggle());
document.getElementById('close-output').addEventListener('click',()=>window.gatewayOutput.toggle());
document.getElementById('pause-output').addEventListener('click',event=>{const output=window.gatewayOutput;output.paused=!output.paused;event.currentTarget.textContent=output.paused?'Resume':'Pause';if(!output.paused)output.render();});
document.getElementById('clear-output').addEventListener('click',()=>{window.gatewayOutput.lines=[];window.gatewayOutput.render();});
