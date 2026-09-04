// Mobile menu
const toggle = document.getElementById('navToggle');
const links = document.getElementById('navLinks');
if (toggle) {
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

// Mark the current page in the nav
const here = location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('.nav__links a').forEach(a => {
  if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page');
});

window.initFilters = function () {
// Store category filter
const filterBar = document.querySelector('.filters');
if (filterBar) {
  filterBar.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    filterBar.querySelectorAll('button').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    const cat = btn.dataset.cat;
    document.querySelectorAll('.grid-products .product').forEach(p => {
      p.style.display = (cat === 'all' || p.dataset.cat === cat) ? '' : 'none';
    });
  });
}

// Results year filter
const yearBar = document.querySelector('.years');
if (yearBar) {
  yearBar.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    yearBar.querySelectorAll('button').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    const yr = btn.dataset.year;
    document.querySelectorAll('.table tbody tr').forEach(r => {
      r.style.display = (yr === 'all' || r.dataset.year === yr) ? '' : 'none';
    });
  });
}

};
