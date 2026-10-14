async function loadProfile() {
  const name = document.getElementById('profile-name');
  const username = document.getElementById('profile-username');
  const avatar = document.getElementById('profile-avatar');
  const initial = document.getElementById('profile-initial');
  try {
    const response = await fetch('/api/me', {cache:'no-store'});
    if (!response.ok) throw new Error('Could not load profile');
    const user = await response.json();
    if (!user.id || !user.username) throw new Error('Invalid profile');
    window.currentProfile = user;
    name.textContent = user.global_name || user.username;
    username.textContent = user.discriminator && user.discriminator !== '0' ? `${user.username}#${user.discriminator}` : `@${user.username}`;
    initial.textContent = Array.from(name.textContent)[0].toUpperCase();
    avatar.querySelector('img')?.remove();
    const image = document.createElement('img');
    image.className = 'message-avatar';
    image.alt = '';
    const defaultIndex = user.discriminator && user.discriminator !== '0' ? Number(user.discriminator) % 5 : Number((BigInt(user.id) >> 22n) % 6n);
    image.src = user.avatar
      ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=80`
      : `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
    image.addEventListener('error', () => image.remove());
    avatar.append(image);
  } catch {
    name.textContent = 'Profile unavailable';
    username.replaceChildren();
    const retry = document.createElement('button');
    retry.className = 'profile-retry'; retry.type = 'button'; retry.textContent = 'Retry';
    retry.addEventListener('click', loadProfile); username.append(retry);
  }
}
loadProfile();

const ownAvatar = document.getElementById('profile-avatar');
bindProfileClick(ownAvatar, () => ({id:window.currentProfile?.id,user:window.currentProfile}));
