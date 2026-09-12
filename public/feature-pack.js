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

    const showDemo = () => {
      if (document.querySelector('.canvasly-demo-overlay')) return;
      const overlay = document.createElement('div');
      overlay.className = 'canvasly-demo-overlay';
      overlay.innerHTML = `
        <div class="canvasly-demo-card" role="dialog" aria-modal="true" aria-label="How to use Canvasly">
          <button class="canvasly-demo-close" aria-label="Close">×</button>
          <div class="canvasly-demo-kicker">QUICK DEMO</div>
          <h2>How to use Canvasly</h2>
          <p class="canvasly-demo-intro">Create a room, draw together, and share the board in a few clicks.</p>
          <div class="canvasly-demo-grid">
            <div><span>01</span><h3>Create or join a room</h3><p>Enter a room name at the top and use the same room name with your teammates.</p></div>
            <div><span>02</span><h3>Draw and add ideas</h3><p>Use Pen, Shapes, Text, Sticky Notes, and Image to build your board.</p></div>
            <div><span>03</span><h3>Collaborate live</h3><p>Click Share and send the room link. Everyone in the same room sees updates and cursors in real time.</p></div>
            <div><span>04</span><h3>Save your work</h3><p>Board data is persisted by the collaboration backend. Use Export to save a PNG snapshot locally.</p></div>
          </div>
          <div class="canvasly-demo-tip"><strong>Tip:</strong> Select objects to move them. Shift lets you multi-select. Ctrl/Cmd + Z undoes your last action.</div>
          <button class="canvasly-demo-start">Got it — start creating</button>
        </div>`;
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.querySelector('.canvasly-demo-close')?.addEventListener('click', close);
      overlay.querySelector('.canvasly-demo-start')?.addEventListener('click', close);
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
      document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    };

    const exportBtn = makeButton('Export', 'Export the board as PNG', exportBoard);
    const shareBtn = makeButton('Share', 'Copy or share this room link', shareRoom);
    const demoBtn = makeButton('Demo', 'See a quick guide to using Canvasly', showDemo);
    actions.insertBefore(shareBtn, actions.firstChild);
    actions.insertBefore(exportBtn, actions.firstChild);
    actions.insertBefore(demoBtn, actions.firstChild);

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault(); exportBoard();
      }
      if (e.key === '?' && !/input|textarea/i.test(document.activeElement?.tagName || '')) showDemo();
    });
  };

  const addStyles = () => {
    if (document.getElementById('canvasly-demo-styles')) return;
    const style = document.createElement('style');
    style.id = 'canvasly-demo-styles';
    style.textContent = `
      .canvasly-demo-overlay{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;background:rgba(12,27,32,.58);backdrop-filter:blur(8px)}
      .canvasly-demo-card{position:relative;width:min(720px,100%);max-height:min(88vh,760px);overflow:auto;padding:34px;border:1px solid rgba(182,135,56,.35);border-radius:22px;background:#fffdf7;box-shadow:0 28px 80px rgba(0,0,0,.28);font-family:DM Sans,system-ui,sans-serif;color:#18222b}
      .canvasly-demo-close{position:absolute;right:18px;top:14px;width:36px;height:36px;border:0;border-radius:50%;background:#f0eadf;color:#18222b;font-size:25px;line-height:1;cursor:pointer}
      .canvasly-demo-kicker{font-size:11px;font-weight:800;letter-spacing:.16em;color:#b68738;margin-bottom:8px}.canvasly-demo-card h2{margin:0;font-size:30px;letter-spacing:-.03em}.canvasly-demo-intro{margin:8px 0 24px;color:#66747b;font-size:15px}
      .canvasly-demo-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.canvasly-demo-grid>div{padding:18px;border:1px solid #e8dfd1;border-radius:16px;background:#fbf7ef}.canvasly-demo-grid span{font-size:11px;font-weight:800;color:#b68738}.canvasly-demo-grid h3{margin:7px 0 5px;font-size:16px}.canvasly-demo-grid p{margin:0;color:#68757a;font-size:13px;line-height:1.5}
      .canvasly-demo-tip{margin-top:16px;padding:13px 15px;border-radius:12px;background:#f3eee5;color:#58656a;font-size:13px;line-height:1.5}.canvasly-demo-start{margin-top:20px;border:0;border-radius:12px;padding:12px 18px;background:#18222b;color:white;font-weight:700;cursor:pointer}.canvasly-demo-start:hover{opacity:.92}
      @media(max-width:640px){.canvasly-demo-card{padding:26px 20px}.canvasly-demo-grid{grid-template-columns:1fr}.canvasly-demo-card h2{font-size:25px}}
    `;
    document.head.appendChild(style);
  };

  addStyles();
  mount();
  new MutationObserver(mount).observe(document.documentElement, {childList:true, subtree:true});
})();
