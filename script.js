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
  const scriptBase = scriptElement ? new URL('./', scriptElement.src) : new URL('./', window.location.href);
  const pdfWorkerSrc = new URL('vendor/pdfjs/pdf.worker.min.js', scriptBase).href;
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
  const doodlesEnabled = document.querySelector('.hero#home, .contact-page');
  if (!doodlesEnabled) return;

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

  function rectsOverlap(a, b, gap = 0) {
    return !(
      a.right + gap <= b.left ||
      a.left >= b.right + gap ||
      a.bottom + gap <= b.top ||
      a.top >= b.bottom + gap
    );
  }

  function layoutDoodles() {
    // Reset first so old absolute positions cannot inflate the document dimensions.
    doodleEls.forEach((el) => {
      el.style.visibility = 'hidden';
      el.style.left = '0';
      el.style.top = '0';
      el.style.transform = 'none';
    });

    const doc = document.documentElement;
    const pageW = Math.max(doc.clientWidth || 0, window.innerWidth || 0);
    const pageH = Math.max(doc.scrollHeight || 0, doc.clientHeight || 0, window.innerHeight || 0);
    const margin = Math.min(pageW * 0.04, 64);
    const gap = 24;
    const mainGap = 20;
    const scrollX = window.pageXOffset || doc.scrollLeft || 0;
    const scrollY = window.pageYOffset || doc.scrollTop || 0;
    const mainEl = document.querySelector('main');
    let exclusion = null;

    if (mainEl) {
      const rect = mainEl.getBoundingClientRect();
      exclusion = {
        left: rect.left + scrollX,
        top: rect.top + scrollY,
        right: rect.right + scrollX,
        bottom: rect.bottom + scrollY,
      };
    }

    const placedRects = [];

    doodleEls.forEach((el) => {
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const rotation = randBetween(-14, 14);
      const radians = Math.abs(rotation) * Math.PI / 180;
      // A rotated element's axis-aligned box is larger than width * scale.
      const rotatedW = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
      const rotatedH = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
      const leftGutterW = exclusion ? exclusion.left - margin - mainGap : 0;
      const rightGutterW = exclusion ? pageW - margin - exclusion.right - mainGap : 0;
      const widestGutter = Math.max(leftGutterW, rightGutterW);
      let scale = Math.min(randBetween(0.9, 1.4), widestGutter / rotatedW);
      let position = null;

      // Keep every doodle wholly inside either the left or right gutter. Very
      // small gutters hide doodles rather than placing them behind the main grid.
      if (width && height && exclusion && scale >= 0.45) {
        let transform = `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;
        el.style.transform = transform;
        let measured = el.getBoundingClientRect();

        // Use the rendered width as the final authority; percentage translation
        // and rotation can produce a wider box than the geometric estimate.
        if (measured.width > widestGutter) {
          scale *= Math.max(0, widestGutter - 1) / measured.width;
          if (scale < 0.45) return;
          transform = `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;
          el.style.transform = transform;
          measured = el.getBoundingClientRect();
        }

        // These offsets account for CSS transform order as rendered by the browser.
        const offsetLeft = measured.left + scrollX;
        const offsetTop = measured.top + scrollY;
        const offsetRight = measured.right + scrollX;
        const offsetBottom = measured.bottom + scrollY;
        const minY = margin - offsetTop;
        const maxY = pageH - margin - offsetBottom;
        const lanes = [
          {
            minX: margin - offsetLeft,
            maxX: exclusion.left - mainGap - offsetRight,
          },
          {
            minX: exclusion.right + mainGap - offsetLeft,
            maxX: pageW - margin - offsetRight,
          },
        ].filter((lane) => lane.minX <= lane.maxX);

        for (let attempt = 0; attempt < 240 && minY <= maxY; attempt += 1) {
          if (!lanes.length) break;
          const lane = lanes[Math.floor(Math.random() * lanes.length)];
          const left = randBetween(lane.minX, lane.maxX);
          const top = randBetween(minY, maxY);
          const candidate = {
            left: left + offsetLeft,
            top: top + offsetTop,
            right: left + offsetRight,
            bottom: top + offsetBottom,
          };

          if (placedRects.some((rect) => rectsOverlap(candidate, rect, gap))) continue;

          position = { left, top, transform, rect: candidate };
          break;
        }
      }

      // Fewer doodles is preferable to an overlapping pile on a constrained page.
      if (!position) return;

      el.style.left = `${position.left}px`;
      el.style.top = `${position.top}px`;
      el.style.transform = position.transform;
      el.style.visibility = 'visible';
      placedRects.push(position.rect);
    });
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

      picks.forEach((src) => {
        const img = document.createElement('img');
        img.className = 'site-doodle';
        img.src = new URL(src, assetBase).href;
        img.alt = '';
        img.decoding = 'async';
        img.style.visibility = 'hidden';

        // give a responsive base width then fine-tune position
        const baseWidthVw = Math.round(randBetween(12, 24));
        img.style.width = baseWidthVw + 'vw';
        img.style.maxWidth = '360px';

        // Append first; layout runs only after every image has measurable dimensions.
        document.body.appendChild(img);
        doodleEls.push(img);
      });

      const imagesReady = doodleEls.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      });

      Promise.all(imagesReady).then(layoutDoodles);

      // reposition on resize
      const onResize = debounce(layoutDoodles, 160);

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
    link.href = img.dataset.fullSrc || img.src;
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
