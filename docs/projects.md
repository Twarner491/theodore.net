---
hide:
  - navigation
  - toc
  - feedback
template: index.html
og_description: Some of the Open-Source shenanigans I've been up to.
search:
  exclude: true
---

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  
  <!-- Primary Meta Tags -->
  <meta name="title" content="Projects - Teddy Warner">
  <meta name="description" content="Here's some of the stuff I've been up to.">
  <meta name="keywords" content="Digital fabrication, PCB development, Mechatronics engineering, USC Iovine and Young Academy, Engineering design, Fab Academy, Hardware engineering, Rapid prototyping, CAD design, Physical computing, Electronics design, IoT development, Wearable technology, Engineering portfolio">
  <meta name="author" content="Teddy Warner">
  <meta name="robots" content="index, follow">
  
  <!-- Existing resource links -->
  <script src="https://kit.fontawesome.com/79ff35ecec.js" crossorigin="anonymous"></script>
  <!-- Fonts served locally via tufte.css -->
  <link rel="stylesheet" href="../assets/css/projects.css">
  <link rel="stylesheet" href="../assets/css/header.css">
  
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": "Projects - Teddy Warner",
    "description": "Here's some of the stuff I've been up to.",
    "url": "https://theodore.net/projects/",
    "author": {
      "@type": "Person",
      "@id": "https://theodore.net/#person"
    }
  }
  </script>
</head>

  <nav class="main-navigation">
    <ul>
      <li><a class="home" href="https://teddywarner.com"><span class="navnum">01</span> Home</a></li>
      <li><a class="proj" href="/projects"><span class="navnum">02</span> Projects</a></li>
      <li><a class="writ" href="/writings"><span class="navnum">03</span> Writing</a></li>
      <li><a class="stor" href="/store"><span class="navnum">04</span> Store</a></li>
    </ul>
  </nav>
  
  <div class="blur-overlay"></div>

<body>
  <main data-scroll-container>
  <div class="content-container">
    <section class="intro-section">
      <div class="content1">
        <div class="introabt">
          <h2>Projects and Adventures</h2>
          <h3>Here's some of the stuff I've been up to.</h3>
        </div>
      </div>
    </section>
    <section class="writing">
      <div class="content6" id="content6">
<!-- PROJECTS_FULL_LIST -->
      </div>
    </section>
    <section class="footer">
      <div class="content8">
        <div class="socialpar">
          <a target="_blank" href="https://github.com/Twarner491">
            <i class="fa-brands fa-github"></i>
          </a>
        </div>
        <div class="socialpar">
          <a target="_blank" href="https://x.com/WarnerTeddy">
            <i class="fa-brands fa-x-twitter"></i>
          </a>
        </div>
        <div class="socialpar">
          <a target="_blank" rel="noopener" href="https://www.instagram.com/teddymakesstuff/" aria-label="Instagram">
            <i class="fa-brands fa-instagram"></i>
          </a>
        </div>
        <a target="_blank" href="https://github.com/Twarner491/theodore.net/blob/main/LICENSE">
          <p class="copyright">Copyright © 2026 Teddy Warner</p>
        </a>
        <p class="footer-links"><a href="/privacy">Privacy</a> <a href="mailto:press@theodore.net">Press</a> <a href="/store">Store</a></p>
    </section>
    <h1 style="display:none;">Project Portfolio - Digital Fabrication & Engineering Projects</h1>
  </div>
  </main>
  <script>
    // Staggered animations on scroll - supports instant navigation
    function initProjAnimations() {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // If reduced motion, just make everything visible immediately
        document.querySelectorAll('.intro-section, .writing, .footer, .writparent').forEach(el => {
          el.classList.add('visible');
        });
        return;
      }
      
      let itemCounter = 0;
      const staggerDelay = 50;
      const viewportHeight = window.innerHeight;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      
      // Check if element is in or above viewport (already scrolled past)
      function isInOrAboveViewport(el) {
        const rect = el.getBoundingClientRect();
        return rect.bottom >= 0 && rect.top <= viewportHeight + 100;
      }
      
      function isAboveViewport(el) {
        const rect = el.getBoundingClientRect();
        return rect.bottom < 0;
      }
      
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const el = entry.target;
            const delay = el.classList.contains('writparent') ? itemCounter++ * staggerDelay : 0;
            
            requestAnimationFrame(() => {
              setTimeout(() => {
                el.style.animationDelay = delay + 'ms';
                el.classList.add('visible');
              }, 0);
            });
            
            observer.unobserve(el);
          }
        });
      }, { 
        threshold: 0.01,
        rootMargin: '50px'
      });
      
      document.querySelectorAll('.intro-section, .writing, .footer, .writparent').forEach(el => {
        el.classList.remove('visible'); // Reset for re-animation on navigation
        
        // Immediately show elements already above viewport (scrolled past)
        if (isAboveViewport(el)) {
          el.classList.add('visible');
        } 
        // Animate elements currently in viewport with stagger
        else if (isInOrAboveViewport(el)) {
          const delay = el.classList.contains('writparent') ? itemCounter++ * staggerDelay : 0;
          setTimeout(() => {
            el.style.animationDelay = delay + 'ms';
            el.classList.add('visible');
          }, 10);
        } 
        // Observe elements below viewport for scroll animation
        else {
          observer.observe(el);
        }
      });
    }
    
    if (typeof document$ !== 'undefined') {
      document$.subscribe(initProjAnimations);
    } else {
      document.addEventListener("DOMContentLoaded", initProjAnimations);
    }
  </script>
  <script src="../assets/js/projects.js"></script>
  <script src="../assets/js/header.js"></script>
</body>
</html>
