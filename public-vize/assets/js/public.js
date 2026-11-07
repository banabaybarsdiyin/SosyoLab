'use strict';
const homeSearch = document.querySelector('#home-search');
homeSearch?.addEventListener('keydown', event => {
  if (event.key === 'Enter') location.href = '/vize/archive.html?q=' + encodeURIComponent(homeSearch.value.trim());
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    const input = document.querySelector('#home-search, #catalog-search');
    if (input) { event.preventDefault(); input.focus(); }
  }
});
const input = document.querySelector('#catalog-search');
if (input) {
  input.value = (new URLSearchParams(location.search).get('q') || '').slice(0,100);
  const cards = [...document.querySelectorAll('[data-course-id]')];
  function filter() {
    const query = input.value.toLocaleLowerCase('tr').trim();
    let visible = 0;
    for (const card of cards) { card.hidden = !card.textContent.toLocaleLowerCase('tr').includes(query); if (!card.hidden) visible++; }
    document.querySelector('#search-count').textContent = visible + ' ders';
    document.querySelector('#search-empty').hidden = visible !== 0;
  }
  input.addEventListener('input', filter); filter();
}
