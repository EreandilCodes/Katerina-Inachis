/**
 * Lightweight carousel/slider component.
 * Finds all `.carousel` elements and adds prev/next buttons,
 * dot indicators, touch/swipe support, and wrap-around navigation.
 * Uses CSS transform translateX for sliding. No dependencies.
 */

(function () {
  function initCarousels() {
    const carousels = document.querySelectorAll('.carousel');
    carousels.forEach(initCarousel);
  }

  function initCarousel(el) {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';

    const track = el.querySelector('.carousel-track');
    if (!track) return;

    const slides = track.querySelectorAll('.carousel-slide');
    if (slides.length <= 1) return;

    const total = slides.length;
    let current = 0;

    // -- Prev / Next buttons --------------------------------------------------

    const prevBtn = document.createElement('button');
    prevBtn.className = 'carousel-prev';
    prevBtn.type = 'button';
    prevBtn.setAttribute('aria-label', 'Previous slide');
    prevBtn.textContent = '\u2190';

    const nextBtn = document.createElement('button');
    nextBtn.className = 'carousel-next';
    nextBtn.type = 'button';
    nextBtn.setAttribute('aria-label', 'Next slide');
    nextBtn.textContent = '\u2192';

    el.appendChild(prevBtn);
    el.appendChild(nextBtn);

    // -- Dot indicators -------------------------------------------------------

    const dotsWrap = document.createElement('div');
    dotsWrap.className = 'carousel-dots';

    for (let i = 0; i < total; i++) {
      const dot = document.createElement('button');
      dot.className = 'carousel-dot';
      dot.type = 'button';
      dot.setAttribute('aria-label', 'Go to slide ' + (i + 1));
      dot.addEventListener('click', function () {
        goTo(i);
      });
      dotsWrap.appendChild(dot);
    }

    el.appendChild(dotsWrap);

    // -- Navigation helpers ---------------------------------------------------

    function goTo(index) {
      current = ((index % total) + total) % total;
      track.style.transform = 'translateX(-' + (current * 100) + '%)';
      updateDots();
    }

    function updateDots() {
      const dots = dotsWrap.querySelectorAll('.carousel-dot');
      dots.forEach(function (d, i) {
        if (i === current) {
          d.classList.add('active');
        } else {
          d.classList.remove('active');
        }
      });
    }

    prevBtn.addEventListener('click', function () {
      goTo(current - 1);
    });

    nextBtn.addEventListener('click', function () {
      goTo(current + 1);
    });

    // -- Touch / swipe support ------------------------------------------------

    let touchStartX = 0;
    let touchEndX = 0;
    const SWIPE_THRESHOLD = 50;

    el.addEventListener('touchstart', function (e) {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    el.addEventListener('touchend', function (e) {
      touchEndX = e.changedTouches[0].screenX;
      var delta = touchStartX - touchEndX;
      if (Math.abs(delta) >= SWIPE_THRESHOLD) {
        if (delta > 0) {
          goTo(current + 1);
        } else {
          goTo(current - 1);
        }
      }
    }, { passive: true });

    // -- Initial state --------------------------------------------------------

    updateDots();
  }

  window.initCarousels = initCarousels;
})();
