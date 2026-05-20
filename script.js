const customCursorMedia = window.matchMedia('(any-hover: hover) and (any-pointer: fine)');
const scriptElement = document.currentScript;

if (customCursorMedia.matches) {
  const assetBase = scriptElement ? new URL('./', scriptElement.src) : new URL('./', window.location.href);
  const defaultCursorSrc = new URL('assets/cursor.png', assetBase).href;
  const hoverCursorSrc = new URL('assets/cursor_hover.png', assetBase).href;
  const cursorHotspotX = 8;
  const cursorHotspotY = 58;
  const textFieldSelector = 'input, textarea, [contenteditable="true"]';
  const hoverTargetSelector = 'a[href], button, .tile, .language-toggle, .back-link';

  const customCursor = document.createElement('img');
  customCursor.className = 'custom-cursor';
  customCursor.src = defaultCursorSrc;
  customCursor.alt = '';
  customCursor.setAttribute('aria-hidden', 'true');
  customCursor.decoding = 'async';

  document.documentElement.classList.add('has-custom-cursor');
  document.body.appendChild(customCursor);

  const hoverCursorImage = new Image();
  hoverCursorImage.src = hoverCursorSrc;

  const moveCursor = (event) => {
    customCursor.style.transform = `translate3d(${event.clientX - cursorHotspotX}px, ${event.clientY - cursorHotspotY}px, 0)`;

    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest(textFieldSelector)) {
      customCursor.classList.remove('is-visible');
      return;
    }

    const isHoverTarget = Boolean(target && target.closest(hoverTargetSelector));
    customCursor.src = isHoverTarget ? hoverCursorSrc : defaultCursorSrc;
    customCursor.classList.add('is-visible');
  };

  document.addEventListener('pointermove', moveCursor);
  document.addEventListener('pointerdown', moveCursor);
  document.addEventListener('pointerleave', () => {
    customCursor.classList.remove('is-visible', 'is-hover');
  });
}

const bookReaderRoot = document.querySelector('[data-book-reader]');

if (bookReaderRoot && window.pdfjsLib) {
  const pdfUrl = bookReaderRoot.getAttribute('data-book-pdf');
  const openButton = document.querySelector('[data-book-open]');
  const closeButtons = bookReaderRoot.querySelectorAll('[data-reader-close]');
  const prevButton = bookReaderRoot.querySelector('[data-reader-prev]');
  const nextButton = bookReaderRoot.querySelector('[data-reader-next]');
  const stage = bookReaderRoot.querySelector('[data-reader-stage]');
  const loadingLabel = bookReaderRoot.querySelector('[data-reader-loading]');
  const counterLabel = bookReaderRoot.querySelector('[data-reader-counter]');
  const pdfWorkerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const layoutQuery = window.matchMedia('(max-width: 760px)');

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

  const state = {
    currentPage: 0,
    pdfDocument: null,
    loadPromise: null,
    renderToken: 0,
    animating: false,
    open: false,
  };

  const getLayout = () => (layoutQuery.matches ? 'single' : 'spread');

  const getStep = () => (getLayout() === 'single' ? 1 : 2);

  const getVisiblePages = () => {
    if (!state.pdfDocument) {
      return [];
    }

    if (getLayout() === 'single') {
      return [state.currentPage];
    }

    return [state.currentPage, state.currentPage + 1 < state.pdfDocument.numPages ? state.currentPage + 1 : null];
  };

  const duplicateCanvas = (sourceCanvas) => {
    const copy = document.createElement('canvas');
    copy.width = sourceCanvas.width;
    copy.height = sourceCanvas.height;
    copy.style.width = sourceCanvas.style.width;
    copy.style.height = sourceCanvas.style.height;

    const context = copy.getContext('2d');
    context.drawImage(sourceCanvas, 0, 0);
    return copy;
  };

  const renderedPageCache = new Map();

  const cacheKeyForPage = (pageNumber, slotWidth, slotHeight) => {
    const dpr = Math.max(window.devicePixelRatio || 1, 1);
    return `${pageNumber}:${Math.round(slotWidth)}x${Math.round(slotHeight)}@${dpr}`;
  };

  const loadPdf = async () => {
    if (state.pdfDocument) {
      return state.pdfDocument;
    }

    if (!state.loadPromise) {
      state.loadPromise = window.pdfjsLib.getDocument(pdfUrl).promise.then((pdfDocument) => {
        state.pdfDocument = pdfDocument;
        return pdfDocument;
      });
    }

    return state.loadPromise;
  };

  // Pre-cache all pages in small chunks to avoid lag when navigating
  const preCacheAllPages = async () => {
    try {
      const pdf = await loadPdf();
      const numPages = pdf.numPages;

      // Determine target slot dimensions; fallback to reasonable defaults if stage is not sized yet
      const stageRect = stage.getBoundingClientRect();
      let slotWidth = Math.max(stageRect.width, 640);
      let slotHeight = Math.max(stageRect.height, 720);
      if (stageRect.width === 0 || stageRect.height === 0) {
        slotWidth = Math.min(1200, Math.round(window.innerWidth * 0.8));
        slotHeight = Math.max(720, Math.round(window.innerHeight * 0.6));
      }

      // Safety guard for extremely large PDFs
      const MAX_PAGES_TO_PARSE = 500;
      const pagesToCache = Math.min(numPages, MAX_PAGES_TO_PARSE);

      for (let i = 0; i < pagesToCache; i++) {
        // Skip if already cached at the desired size
        const key = cacheKeyForPage(i, slotWidth, slotHeight);
        if (renderedPageCache.has(key)) continue;

        // Render one page at a time and yield to the event loop to keep UI responsive
        // eslint-disable-next-line no-await-in-loop
        await renderPageToCanvas(i, slotWidth, slotHeight);

        // Give the browser a short break; uses requestIdleCallback if available
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          if ('requestIdleCallback' in window) {
            // @ts-ignore
            requestIdleCallback(resolve, { timeout: 200 });
          } else {
            setTimeout(resolve, 60);
          }
        });
      }

      if (numPages > MAX_PAGES_TO_PARSE) {
        console.warn(`PDF has ${numPages} pages; cached first ${MAX_PAGES_TO_PARSE} pages for performance.`);
      }
    } catch (err) {
      console.error('Pre-cache of PDF pages failed:', err);
    }
  };

  const getSlotDimensions = () => {
    const stageRect = stage.getBoundingClientRect();
    const width = Math.max(stageRect.width, 640);
    const height = Math.max(stageRect.height, 720);

    if (getLayout() === 'single') {
      return {
        slotWidth: width,
        slotHeight: height,
      };
    }

    return {
      slotWidth: Math.max((width - 18) / 2, 320),
      slotHeight: height,
    };
  };

  const renderPageToCanvas = async (pageNumber, slotWidth, slotHeight) => {
    const cacheKey = cacheKeyForPage(pageNumber, slotWidth, slotHeight);

    if (renderedPageCache.has(cacheKey)) {
      return renderedPageCache.get(cacheKey);
    }

    const page = await state.pdfDocument.getPage(pageNumber + 1);
    const baseViewport = page.getViewport({ scale: 1 });
    const fitScale = Math.min(slotWidth / baseViewport.width, slotHeight / baseViewport.height);
    const outputScale = Math.max(window.devicePixelRatio || 1, 1);
    const viewport = page.getViewport({ scale: fitScale * outputScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${Math.floor(viewport.width / outputScale)}px`;
    canvas.style.height = `${Math.floor(viewport.height / outputScale)}px`;

    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;

    renderedPageCache.set(cacheKey, canvas);
    return canvas;
  };

  const createPageNode = (pageNumber, slotWidth, slotHeight) => {
    const pageNode = document.createElement('div');
    pageNode.className = 'book-reader__page';

    if (pageNumber === null) {
      pageNode.classList.add('is-blank');
      return pageNode;
    }

    return renderPageToCanvas(pageNumber, slotWidth, slotHeight).then((canvas) => {
      pageNode.appendChild(duplicateCanvas(canvas));
      return pageNode;
    });
  };

  const updateCounter = () => {
    if (!state.pdfDocument) {
      counterLabel.textContent = 'Loading pages…';
      return;
    }

    if (getLayout() === 'single') {
      counterLabel.textContent = `Page ${state.currentPage + 1} / ${state.pdfDocument.numPages}`;
      return;
    }

    const leftPage = state.currentPage + 1;
    const rightPage = state.currentPage + 2 <= state.pdfDocument.numPages ? state.currentPage + 2 : null;
    counterLabel.textContent = rightPage ? `Pages ${leftPage}-${rightPage} / ${state.pdfDocument.numPages}` : `Page ${leftPage} / ${state.pdfDocument.numPages}`;
  };

  const updateButtons = () => {
    const totalPages = state.pdfDocument ? state.pdfDocument.numPages : 0;
    const step = getStep();
    const canGoPrev = state.currentPage > 0;
    const canGoNext = state.currentPage + step < totalPages;

    prevButton.disabled = !canGoPrev;
    nextButton.disabled = !canGoNext;
  };

  const renderSpread = async () => {
    if (!state.pdfDocument || !state.open) {
      return;
    }

    const token = ++state.renderToken;
    const layout = getLayout();
    const slotDimensions = getSlotDimensions();
    const pageNumbers = getVisiblePages();

    stage.classList.toggle('is-single', layout === 'single');
    stage.classList.toggle('is-spread', layout === 'spread');
    stage.innerHTML = '';
    loadingLabel.hidden = false;
    updateCounter();
    updateButtons();

    const pageNodes = await Promise.all(pageNumbers.map((pageNumber) => createPageNode(pageNumber, slotDimensions.slotWidth, slotDimensions.slotHeight)));

    if (token !== state.renderToken || !state.open) {
      return;
    }

    pageNodes.forEach((node) => {
      stage.appendChild(node);
    });

    loadingLabel.hidden = true;
  };

  const createSheetFace = (pageNumber, slotWidth, slotHeight) => {
    const face = document.createElement('div');
    face.className = 'book-reader__sheet-face';

    if (pageNumber === null) {
      face.classList.add('is-blank');
      return Promise.resolve(face);
    }

    return renderPageToCanvas(pageNumber, slotWidth, slotHeight).then((canvas) => {
      face.appendChild(duplicateCanvas(canvas));
      return face;
    });
  };

  const animateFlip = async (direction, targetPage) => {
    if (!state.pdfDocument || state.animating) {
      return;
    }
    // Mark as animating immediately to prevent rapid repeated flips
    state.animating = true;
    // Disable nav buttons while animating
    if (prevButton) prevButton.disabled = true;
    if (nextButton) nextButton.disabled = true;

    const layout = getLayout();
    const step = getStep();
    const currentPage = state.currentPage;
    const slotDimensions = getSlotDimensions();
    const currentPages = getVisiblePages();
    const nextStatePages = layout === 'single' ? [targetPage] : [targetPage, targetPage + 1 < state.pdfDocument.numPages ? targetPage + 1 : null];
    const overlay = document.createElement('div');
    overlay.className = `book-reader__sheet ${direction === 'next' ? 'is-next' : 'is-prev'}`;

    const frontPage = direction === 'next'
      ? (layout === 'single' ? currentPages[0] : currentPages[1])
      : (layout === 'single' ? currentPages[0] : currentPages[0]);

    const backPage = direction === 'next'
      ? (layout === 'single' ? targetPage : nextStatePages[0])
      : (layout === 'single' ? targetPage : nextStatePages[1]);

    overlay.style.width = layout === 'single' ? '100%' : '50%';

    const frontFace = await createSheetFace(frontPage, slotDimensions.slotWidth, slotDimensions.slotHeight);
    const backFace = await createSheetFace(backPage, slotDimensions.slotWidth, slotDimensions.slotHeight);

    frontFace.classList.add('book-reader__sheet-face--front');
    backFace.classList.add('book-reader__sheet-face--back');
    overlay.append(frontFace, backFace);
    stage.appendChild(overlay);
    await new Promise((resolve) => {
      overlay.addEventListener('animationend', resolve, { once: true });
      overlay.classList.add(direction === 'next' ? 'is-animating-next' : 'is-animating-prev');
    });
    state.currentPage = targetPage;
    await renderSpread();
    updateButtons();
    updateCounter();

    // Re-enable navigation after render completes
    state.animating = false;
    if (prevButton) prevButton.disabled = false;
    if (nextButton) nextButton.disabled = false;

    if (overlay.isConnected) {
      overlay.remove();
    }
  };

  const goNext = async () => {
    if (!state.pdfDocument || state.animating) {
      return;
    }

    const step = getStep();
    const targetPage = state.currentPage + step;

    if (targetPage >= state.pdfDocument.numPages) {
      return;
    }

    if (!state.open) {
      return;
    }

    if (getLayout() === 'single') {
      await animateFlip('next', targetPage);
      return;
    }

    await animateFlip('next', targetPage);
  };

  const goPrev = async () => {
    if (!state.pdfDocument || state.animating) {
      return;
    }

    const step = getStep();
    const targetPage = Math.max(state.currentPage - step, 0);

    if (targetPage === state.currentPage) {
      return;
    }

    if (!state.open) {
      return;
    }

    await animateFlip('prev', targetPage);
  };

  const openReader = async () => {
    if (state.open) {
      return;
    }

    state.open = true;
    bookReaderRoot.hidden = false;
    bookReaderRoot.setAttribute('aria-hidden', 'false');
    document.body.classList.add('reader-open');
    loadingLabel.hidden = false;
    stage.innerHTML = '';

    try {
      await loadPdf();
      state.currentPage = 0;
      await renderSpread();
      updateButtons();
      updateCounter();
      prevButton.focus();
    } catch (error) {
      loadingLabel.hidden = false;
      loadingLabel.textContent = 'Unable to load the book.';
      counterLabel.textContent = 'Book unavailable';
      console.error('Failed to load the Fruit of my Woman PDF reader:', error);
    }
  };

  const closeReader = () => {
    if (!state.open) {
      return;
    }

    state.open = false;
    state.animating = false;
    bookReaderRoot.hidden = true;
    bookReaderRoot.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('reader-open');
  };

  openButton.addEventListener('click', openReader);
  prevButton.addEventListener('click', goPrev);
  nextButton.addEventListener('click', goNext);

  closeButtons.forEach((button) => {
    button.addEventListener('click', closeReader);
  });

  layoutQuery.addEventListener('change', () => {
    if (state.open) {
      state.renderToken += 1;
      renderSpread();
    }
  });

  window.addEventListener('resize', () => {
    if (state.open) {
      state.renderToken += 1;
      renderSpread();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!state.open) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeReader();
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goNext();
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goPrev();
    }
  });

  updateButtons();

  // Start pre-caching pages in the background so navigation feels snappy later.
  // Do not await this to avoid blocking page load.
  preCacheAllPages();
}

const revealTargets = document.querySelectorAll('.tile');

const observer = new IntersectionObserver(
  (entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }

      entry.target.classList.add('revealed');
      obs.unobserve(entry.target);
    });
  },
  {
    rootMargin: '0px 0px -8% 0px',
    threshold: 0.08,
  }
);

revealTargets.forEach((target, index) => {
  target.style.transitionDelay = `${Math.min(index * 28, 480)}ms`;
  observer.observe(target);
});

(() => {
  const scriptTag = document.currentScript || document.querySelector('script[src*="script.js"]');
  const assetBase = scriptTag ? new URL('.', scriptTag.src) : new URL('./', window.location.href);
  const DOODLES_JSON = new URL('assets/img/doodles/list.json', assetBase).href;
  const MAX_DOODLES = 6;

  function pickRandom(arr, n) {
    const copy = arr.slice();
    const out = [];
    while (out.length < n && copy.length) {
      const i = Math.floor(Math.random() * copy.length);
      out.push(copy.splice(i, 1)[0]);
    }
    return out;
  }

  function randBetween(min, max) {
    return Math.random() * (max - min) + min;
  }

  function debounce(fn, t = 120) {
    let id;
    return (...args) => {
      clearTimeout(id);
      id = setTimeout(() => fn(...args), t);
    };
  }

  let doodleEls = [];

  function placeElAtRandom(el, others = []) {
    const pageW = Math.max(document.documentElement.scrollWidth || 0, document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const pageH = Math.max(document.documentElement.scrollHeight || 0, document.documentElement.clientHeight || 0, window.innerHeight || 0);
    const marginX = Math.min(0.06 * (window.innerWidth || document.documentElement.clientWidth), 80); // avoid viewport edges
    const marginY = Math.min(0.06 * (window.innerHeight || document.documentElement.clientHeight), 80);

    const mainEl = document.querySelector('main');
    let exclusion = null;
    if (mainEl) {
      const rect = mainEl.getBoundingClientRect();
      const sx = window.pageXOffset || document.documentElement.scrollLeft || 0;
      const sy = window.pageYOffset || document.documentElement.scrollTop || 0;
      exclusion = {
        left: rect.left + sx,
        top: rect.top + sy,
        right: rect.right + sx,
        bottom: rect.bottom + sy,
      };
    }

    const w = el.offsetWidth || 1;
    const h = el.offsetHeight || 1;
      // choose visual transform first so we can account for scaled size when checking overlaps
      const rot = randBetween(-14, 14);
      const scale = randBetween(0.9, 1.4);

      // use viewport coordinates for placement calculations (convert to page coords when assigning)
      const scrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
      const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
      const vpW = window.innerWidth || document.documentElement.clientWidth || 0;
      const vpH = window.innerHeight || document.documentElement.clientHeight || 0;
      const marginVX = Math.min(0.06 * vpW, 80);
      const marginVY = Math.min(0.06 * vpH, 80);

      const wScaled = w * scale;
      const hScaled = h * scale;

      // try a few times to avoid placing inside excluded rect or overlapping other doodles
      let attempt = 0;
      let leftV = 0, topV = 0;
      const maxAttempts = 80;
      while (attempt < maxAttempts) {
        leftV = randBetween(marginVX, vpW - marginVX);
        topV = randBetween(marginVY, vpH - marginVY);

        // current doodle bounding box in viewport coordinates
        const doodleRectV = {
          left: leftV - wScaled / 2,
          top: topV - hScaled / 2,
          right: leftV + wScaled / 2,
          bottom: topV + hScaled / 2,
        };

        // check exclusion: convert exclusion (page coords) to viewport coords and test
        if (exclusion) {
          const exclusionV = {
            left: exclusion.left - scrollX,
            top: exclusion.top - scrollY,
            right: exclusion.right - scrollX,
            bottom: exclusion.bottom - scrollY,
          };
          const overlapsExclusion = !(doodleRectV.right < exclusionV.left || doodleRectV.left > exclusionV.right || doodleRectV.bottom < exclusionV.top || doodleRectV.top > exclusionV.bottom);
          if (overlapsExclusion) {
            attempt += 1;
            continue;
          }
        }

        // check overlap with other doodles using their getBoundingClientRect (which includes transforms)
        let overlapsOthers = false;
        for (let i = 0; i < others.length; i++) {
          const other = others[i];
          if (!other || other === el) continue;
          const otherRect = other.getBoundingClientRect();
          const overlaps = !(doodleRectV.right < otherRect.left || doodleRectV.left > otherRect.right || doodleRectV.bottom < otherRect.top || doodleRectV.top > otherRect.bottom);
          if (overlaps) {
            overlapsOthers = true;
            break;
          }
        }

        if (overlapsOthers) {
          attempt += 1;
          continue;
        }

        // found a non-overlapping spot
        break;
      }

      // if we failed to find a non-overlapping spot, nudge the doodle to the nearest side of exclusion (use page coords)
      let leftPage = leftV + scrollX;
      let topPage = topV + scrollY;
      if (exclusion && attempt >= 30) {
        const centerX = (exclusion.left + exclusion.right) / 2;
        if (leftPage > centerX) {
          leftPage = Math.min(pageW - marginX, exclusion.right + wScaled);
        } else {
          leftPage = Math.max(marginX, exclusion.left - wScaled);
        }
        const centerY = (exclusion.top + exclusion.bottom) / 2;
        if (topPage > centerY) {
          topPage = Math.min(pageH - marginY, exclusion.bottom + hScaled);
        } else {
          topPage = Math.max(marginY, exclusion.top - hScaled);
        }
      }

      el.style.left = `${leftPage}px`;
      el.style.top = `${topPage}px`;
      el.style.transform = `translate(-50%, -50%) rotate(${rot}deg) scale(${scale})`;
  }

  fetch(DOODLES_JSON, { cache: 'no-cache' })
    .then((r) => r.ok ? r.json() : Promise.reject('doodles list not found'))
    .then((data) => {
      if (!data || !Array.isArray(data.doodles) || data.doodles.length === 0) return;

      // pick a few doodles to display
      const picks = pickRandom(data.doodles, Math.min(MAX_DOODLES, data.doodles.length));

      // remove any existing doodles we might have added previously
      doodleEls.forEach((e) => e.remove());
      doodleEls = [];

      picks.forEach((src, i) => {
        const img = document.createElement('img');
        img.className = 'site-doodle';
        img.src = src;
        img.alt = '';
        img.loading = 'lazy';

        // give a responsive base width then fine-tune position
        const baseWidthVw = Math.round(randBetween(12, 24));
        img.style.width = baseWidthVw + 'vw';
        img.style.maxWidth = '360px';

        // append first so we can measure size, then position
        document.body.appendChild(img);
        // initial placement (avoid overlapping previously placed doodles)
        placeElAtRandom(img, doodleEls);
        doodleEls.push(img);
      });

      // reposition on resize
      const onResize = debounce(() => {
        doodleEls.forEach((el, idx) => placeElAtRandom(el, doodleEls.filter((e, i) => i !== idx)));
      }, 160);

      window.addEventListener('resize', onResize);
    })
    .catch((err) => {
      // silently fail if doodles are missing
    });
})();

if (document.querySelector('.category-page') && window.baguetteBox) {
  const galleryImages = document.querySelectorAll('.category-grid .tile img');

  galleryImages.forEach((img) => {
    if (img.closest('a')) {
      return;
    }

    const link = document.createElement('a');
    link.href = img.currentSrc || img.src;
    link.className = 'lightbox-link';
    link.setAttribute('aria-label', `Open image: ${img.alt || 'Artwork'}`);
    img.parentNode.insertBefore(link, img);
    link.appendChild(img);
  });

  baguetteBox.run('.category-page .category-grid', {
    captions: (element) => {
      const image = element.getElementsByTagName('img')[0];
      return image ? image.alt : '';
    },
    animation: 'fadeIn',
    noScrollbars: true,
  });
}
