---
hide:
  - navigation
  - toc
  - feedback
template: index.html
search:
  exclude: true
title: Avian Visitors
product: true
order: 1
id: avian-visitors
published: true
teaser: A framed e-ink that displays the birds heard nearby.
sub: A wood-framed colorful e-ink display that collages the birds heard nearby.
description: A wood-framed colorful e-ink display that collages the birds heard nearby. A buildable kit or a finished, framed piece.
imageBase: /assets/images/AvianVisitors/
images:
  - heard-today.png
  - framedeink.JPG
  - raweink.JPG
defaultBuild: electronics
weight: 0.9  
project: /projects/AvianVisitors/
related:
  - avian-mic
variants:
  - id: assembled
    label: Assembled
    comingSoon: true
    desc: Finished, framed, and ready to hang.
    contents:
      - 13.3" Spectra 6 E-ink, matted in an oak wood frame
      - Charging cable & brick
  - id: electronics
    label: Electronics Kit
    price: 450
    stripePrice: "price_1TkB7KRPSNpqisAPzs2xr9zO"
    stripePriceLive: "price_1TkCJcRPSNpqisAP3ee3eytM"
    desc: All electronics needed for the build, you provide the frame and backing.
    contents:
      - Raspberry Pi Zero 2 W
      - 13.3" Spectra 6 E-ink panel
      - microSD card
      - Power cable & brick
  - id: electronics-printed
    label: "+ Frame & Parts"
    price: 520
    weight: 2.2  
    stripePrice: "price_1TkB7KRPSNpqisAPHfB4WxjI"
    stripePriceLive: "price_1TkCJdRPSNpqisAP6IenR74C"
    desc: All electronics + a 3D printed backplate and a finished wood frame with mat.
    contents:
      - Everything in the Electronics Kit
      - 3D Printed backplate
      - Oak wood frame and mat
softwareNote: Hardware only. You install the open-source software on your own device at first setup.
sections:
  - label: Pairs with
    items:
      - Pair with a <a href="/store/avian-mic/">Bird Mic</a> to fill the display with birds captured right at your home.
  - label: Dimensions
    items:
      - Assembled variant comes in 11"x14" oak wood frame
      - Frame & Parts kit ships with an A4 (8.27" x 11.69") oak wood frame
colophon: 'Sold as hardware. The open-source BirdNET software and Cornell’s model install onto your own device on first setup, for personal use; they are not pre-loaded or resold. Bird ID by <a href="https://birdnet.cornell.edu/" target="_blank" rel="noopener">BirdNET</a>, Cornell Lab of Ornithology (CC BY-NC-SA 4.0).'
---

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://kit.fontawesome.com/79ff35ecec.js" crossorigin="anonymous" defer></script>
  <link rel="stylesheet" href="/assets/css/index.css">
  <link rel="stylesheet" href="/assets/css/store.css">
  <link rel="stylesheet" href="/assets/css/header.css">
</head>

<body>

  <nav class="main-navigation">
    <ul>
      <li><a class="home" href="https://teddywarner.com"><span class="navnum">01</span> Home</a></li>
      <li><a class="proj" href="/projects"><span class="navnum">02</span> Projects</a></li>
      <li><a class="writ" href="/writings"><span class="navnum">03</span> Writing</a></li>
      <li><a class="stor" href="/store"><span class="navnum">04</span> Store</a></li>
    </ul>
  </nav>

  <div class="blur-overlay"></div>

  <main data-scroll-container>
  <div class="content-container">
    <section class="intro-section">
      <div class="content1">
        <div id="product-detail" data-product="avian-visitors"><!-- rendered by store.js --></div>
      </div>
    </section>

    <section class="footer">
      <div class="content8">
        <div class="socialpar"><a target="_blank" href="https://github.com/Twarner491" aria-label="GitHub Profile"><i class="fa-brands fa-github"></i></a></div>
        <div class="socialpar"><a target="_blank" href="https://x.com/intent/follow?screen_name=WarnerTeddy" aria-label="X (Twitter) Profile"><i class="fa-brands fa-x-twitter"></i></a></div>
        <div class="socialpar"><a target="_blank" href="mailto:teddy@warner.net" aria-label="Send Email"><i class="fa-solid fa-paper-plane"></i></a></div>
        <a target="_blank" href="https://github.com/Twarner491/theodore.net/blob/main/LICENSE"><p class="copyright">Copyright © 2026 Teddy Warner</p></a>
        <p class="store-legal"><a href="/privacy">Privacy</a> <a href="/terms">Terms</a> <a href="/returns">Returns</a></p>
      </div>
    </section>
  </div>
  <h1 style="display:none;">Avian Visitors - Teddy Warner</h1>
  </main>

  <script src="/assets/js/store.js" defer></script>
  <script src="/assets/js/header.js" defer></script>
</body>
</html>
