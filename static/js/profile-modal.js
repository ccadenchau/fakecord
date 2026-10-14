const userProfileCard = document.createElement('div');
userProfileCard.className = 'profile-modal';
userProfileCard.setAttribute('aria-labelledby', 'modal-profile-name');
document.body.append(userProfileCard);
let profileRequest = null;
let profileGeneration = 0;
userProfileCard.hidden = true;
userProfileCard.setAttribute('role', 'dialog');
let profileAnchor = null;
let profileAnchorRect = null;
let hideProfileTimer;
function hideUserProfile() {
  clearTimeout(hideProfileTimer);
  profileGeneration++;
  profileRequest?.abort();
  userProfileCard.hidden = true;
  profileAnchor?.removeAttribute('aria-controls');
  profileAnchor = null;
}
userProfileCard.id = 'user-profile-card';
function positionUserProfile() {
  if (!profileAnchor || userProfileCard.hidden) return;
  // Keep the open card at its last position if history replaces its anchor.
  if (profileAnchor.isConnected) profileAnchorRect = profileAnchor.getBoundingClientRect();
  const anchor = profileAnchorRect;
  if (!anchor) return;
  const box = userProfileCard.getBoundingClientRect();
  let left = anchor.right + 10;
  if (left + box.width > window.innerWidth - 8) left = anchor.left - box.width - 10;
  userProfileCard.style.left = `${Math.max(8, Math.min(left, window.innerWidth - box.width - 8))}px`;
  userProfileCard.style.top = `${Math.max(8, Math.min(anchor.top, window.innerHeight - box.height - 8))}px`;
}
function deferHideProfile() { clearTimeout(hideProfileTimer); hideProfileTimer = setTimeout(hideUserProfile, 200); }
document.addEventListener('keydown', event => { if (event.key === 'Escape') hideUserProfile(); });
document.addEventListener('pointerdown', event => {
  if (!userProfileCard.contains(event.target) && !profileAnchor?.contains(event.target)) hideUserProfile();
});
window.addEventListener('resize', positionUserProfile);
window.addEventListener('scroll', event => {
  if (event.target === document || event.target === document.documentElement) positionUserProfile();
  else if (event.target?.contains?.(profileAnchor)) positionUserProfile();
}, true);
new ResizeObserver(positionUserProfile).observe(userProfileCard);
function bindProfileClick(avatar, resolve) {
  const show = event => {
    event?.stopPropagation();
    const profile = resolve();
    if (profile.id) openUserProfile(profile.id, profile.user ?? {}, avatar);
  };
  avatar.addEventListener('click', show);
  if (avatar.tagName !== 'BUTTON') avatar.addEventListener('keydown', event => {
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); show(event); }
  });
}
function drawUserProfile(user, status = '') {
  userProfileCard.replaceChildren();
  const close = element('button', 'profile-modal-close', '×');
  close.type='button';close.setAttribute('aria-label','Close profile');close.addEventListener('click',hideUserProfile);
  const banner=element('div','profile-banner');
  if(user.avatar) {
    const wash=element('img','profile-avatar-wash');
    wash.src=`https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.png?size=32`;
    wash.alt='';wash.addEventListener('error',()=>wash.remove());banner.append(wash);
  }
  const body=element('div','profile-modal-body');
  const name=user.global_name||user.username||'User';
  const avatar=element('div','avatar self profile-modal-avatar',Array.from(name)[0]);
  if(user.avatar){const image=element('img','message-avatar');image.src=`https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.${user.avatar.startsWith('a_')?'gif':'png'}?size=160`;image.alt='';image.addEventListener('error',()=>image.remove());avatar.append(image);}
  const heading=element('h2','',name);heading.id='modal-profile-name';
  const handle=user.username?(user.discriminator&&user.discriminator!=='0'?`${user.username}#${user.discriminator}`:`@${user.username}`):'';
  body.append(avatar,heading,element('div','profile-modal-username',handle));
  const details=element('dl');
  details.append(element('dt','','User ID'),element('dd','',String(user.id)));
  try {
    const created=new Date(Number((BigInt(user.id)>>22n)+1420070400000n));
    details.append(element('dt','','Member since'),element('dd','',created.toLocaleDateString([],{year:'numeric',month:'long',day:'numeric'})));
  } catch { /* Invalid fallback ID. */ }
  if(user.bot)details.append(element('dt','','Account'),element('dd','','Bot'));
  body.append(details);
  if(status){const text=element('p','profile-modal-status',status);text.setAttribute('role','status');body.append(text);}
  userProfileCard.append(close,banner,body);
}
async function openUserProfile(userId, fallback = {}, anchor = profileAnchor) {
  if(!userId)return;
  clearTimeout(hideProfileTimer);
  profileAnchor = anchor;
  profileAnchorRect = anchor?.getBoundingClientRect() ?? profileAnchorRect;
  profileAnchor?.setAttribute('aria-controls', userProfileCard.id);
  const generation=++profileGeneration;
  profileRequest?.abort();profileRequest=new AbortController();
  drawUserProfile({...fallback,id:String(userId)},'Loading profile…');
  userProfileCard.hidden = false;
  positionUserProfile();
  // Message authors and DM recipients already contain the usable profile fields.
  drawUserProfile({...fallback,id:String(userId)});
  loadUserActivity(userId,generation);
  positionUserProfile();
}

async function loadUserActivity(userId, generation) {
  const section=element('section','profile-activity');
  section.append(element('h3','profile-activity-header','Recent messages'));
  const list=element('div','profile-activity-list');
  section.append(list);
  userProfileCard.append(section);
  list.append(element('p','profile-modal-status activity-status','Loading recent messages…'));
  try {
    const response=await fetch('/api/users/'+encodeURIComponent(userId)+'/activity',{cache:'no-store'});
    if(!response.ok)throw Error();
    const entries=await response.json();
    if(generation!==profileGeneration)return;
    section.querySelector('.activity-status')?.remove();
    if(!entries.length)list.append(element('p','profile-modal-status','No recent messages loaded yet.'));
    for(const {message,source} of [...entries].sort((a,b)=>BigInt(a.message.id)<BigInt(b.message.id)?-1:1)) {
      const row=element('article','profile-activity-message');
      const location=messageSourceLabel(source,'profile-activity-source');
      const time=element('time','',new Date(message.timestamp).toLocaleString());
      const content=messageMarkdown(message.content||'',message);
      row.append(location,time,content);
      if(message.attachments?.length)row.append(element('div','profile-modal-status',message.attachments.length+' attachment(s)'));
      list.append(row);
    }
    positionUserProfile();
    list.scrollTop=list.scrollHeight;
  } catch {
    section.querySelector('.activity-status')?.remove();
    if(generation===profileGeneration)list.append(element('p','profile-modal-status','Couldn’t load recent messages.'));
  }
}
