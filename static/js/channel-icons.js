function channelIcon(type) {
  const icons = {
    0: ['M5 9h14M4 15h14M11 3 7 21M17 3l-4 18'],
    5: ['M3 10v4h4l10 5V5L7 10H3Z', 'm7 14 2 6h3l-2-5M20 9v6'],
    2: ['M4 9v6h4l5 4V5L8 9H4Z', 'M16 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12'],
    13: ['M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Z', 'M6 11v1a6 6 0 0 0 12 0v-1M12 18v4M8 22h8'],
    15: ['M3 4h15v11H8l-5 4V4Z', 'M18 8h3v13l-5-3h-5v-3M7 8h7M7 11h4'],
    16: ['M3 4h18v16H3V4Z', 'm3 17 5-6 4 4 3-3 6 6', 'M16 7h.01'],
    10: ['M5 4h10v7H9l-4 3V4Z', 'M9 16h10M13 12l-1 9M18 12l-1 9'],
    11: ['M5 4h10v7H9l-4 3V4Z', 'M9 16h10M13 12l-1 9M18 12l-1 9'],
    12: ['M5 4h10v7H9l-4 3V4Z', 'M9 16h10M13 12l-1 9M18 12l-1 9'],
    1: ['M3 4h18v13H8l-5 4V4Z', 'M7 8h10M7 12h6'],
    3: ['M3 4h18v13H8l-5 4V4Z', 'M7 8h10M7 12h6'],
  };
  const names = {0:'Text',5:'Announcement',2:'Voice',13:'Stage',15:'Forum',16:'Media',10:'Thread',11:'Thread',12:'Private thread',1:'DM',3:'Group DM'};
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('channel-type-icon');
  for (const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) svg.setAttribute(key,value);
  for (const d of icons[type] ?? icons[0]) {
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);
  }
  svg.dataset.channelType = names[type] ?? 'Channel';
  return svg;
}
