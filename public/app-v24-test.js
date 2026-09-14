/* V2.4 validation helper: exposes a one-click standalone HTML stress sample download. */
(() => {
  function addButton() {
    const actions = document.querySelector('.top-actions');
    if (!actions || document.getElementById('downloadStressHtmlBtn')) return;

    const link = document.createElement('a');
    link.id = 'downloadStressHtmlBtn';
    link.className = 'btn';
    link.href = '/samples/v24-vertical-stress-test.html';
    link.download = 'v24-vertical-stress-test.html';
    link.textContent = '↓ Test HTML';
    link.title = 'Download the standalone V2.4 import stress-test HTML';

    const importBtn = document.getElementById('importHtmlBtn');
    actions.insertBefore(link, importBtn || actions.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addButton, { once: true });
  } else {
    addButton();
  }
})();
