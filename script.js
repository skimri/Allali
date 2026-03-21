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
