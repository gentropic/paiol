// paiol — entry point. Boots the app into #app, surfacing any boot failure to the user
// (rather than a blank page) since this runs on Nayara's phone with no devtools open.

import { boot } from './app.js';

const root = document.getElementById('app');

boot(root).catch((e) => {
  console.error('paiol boot failed:', e);
  root.replaceChildren();
  const box = document.createElement('div');
  box.className = 'pa-card';
  box.innerHTML = '<h2>Algo deu errado ao abrir</h2>'
    + '<p class="pa-status"></p>'
    + '<p class="pa-sub">Recarregue a página. Se persistir, seus dados continuam salvos no aparelho.</p>';
  box.querySelector('.pa-status').textContent = String(e && e.message ? e.message : e);
  root.append(box);
});
