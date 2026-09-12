(() => {
  const mount = () => {
    const actions = document.querySelector('.top-actions');
    if (!actions || actions.dataset.featurePack === 'true') return;
    actions.dataset.featurePack = 'true';

    const makeButton = (label, title, onClick) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.title = title;
      b.addEventListener('click', onClick);
      return b;
    };

    const exportBoard = () => {
      const source = document.querySelector('canvas.canvas');
      if (!source) return;
      const out = document.createElement('canvas');
      out.width = source.width; out.height = source.height;
      const ctx = out.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#fffdf7'; ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(source, 0, 0);
      const room = new URLSearchParams(location.search).get('room') || 'main';
      const a = document.createElement('a');
      a.download = `canvasly-${room}-${new Date().toISOString().slice(0,10)}.png`;
      a.href = out.toDataURL('image/png'); a.click();
    };

    const shareRoom = async () => {
      const roomInput = document.querySelector('.room-controls input');
      const room = roomInput?.value?.trim() || new URLSearchParams(location.search).get('room') || 'main';
      const url = new URL(location.href); url.searchParams.set('room', room);
      try {
        if (navigator.share) await navigator.share({title:'Canvasly room', text:`Join my Canvasly room: ${room}`, url:url.href});
        else { await navigator.clipboard.writeText(url.href); alert('Room link copied!'); }
      } catch (_) {}
    };

    const exportBtn = makeButton('Export', 'Export the board as PNG', exportBoard);
    const shareBtn = makeButton('Share', 'Copy or share this room link', shareRoom);
    actions.insertBefore(shareBtn, actions.firstChild);
    actions.insertBefore(exportBtn, actions.firstChild);

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault(); exportBoard();
      }
    });
  };

  mount();
  new MutationObserver(mount).observe(document.documentElement, {childList:true, subtree:true});
})();
