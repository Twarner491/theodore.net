---
hide:
  - navigation
  - toc
  - feedback
template: index.html
search:
  exclude: true
title: Polargraph Plotter
product: true
order: 3
id: polargraph
published: true
teaser: A wall-mounted drawing machine.
sub: A wall-mounted pen plotter with a web-accessible control interface.
imageBase: /assets/images/Polargraph/
images:
  - kit.png
  - mountedPoalrgraph.JPG
  - wall.jpg
  - firstPlotResult.JPG
defaultBuild: electronics
weight: 3.1   
project: /projects/Polargraph/
variants:
  - id: electronics
    label: Electronics Kit
    price: 430
    stripePrice: "price_1TkCtxRPSNpqisAPCqVQCdz5"
    stripePriceLive: "price_1TkD4wRPSNpqisAP9uWspmjK"
    desc: All electronics, motors, and hardware needed for the build.
    contents:
      - 2× NEMA-17 steppers + drivers
      - MG90S Micro Servo
      - RAMPS 1.4 Controller board + Arduino Mega
      - Raspberry Pi 4 + cooling fan
      - Cabling + PSU + Power cord
      - Belts, pulleys, bearings, and other hardware
  - id: electronics-printed
    label: "+ 3D Printed Parts"
    price: 520
    stripePrice: "price_1TkCtxRPSNpqisAPfnljWfZA"
    stripePriceLive: "price_1TkD4wRPSNpqisAPViFLyO2k"
    weight: 4.5   # 
    desc: All electronics plus all 3D printed parts
    contents:
      - Everything in the Electronics Kit
      - All 3D printed parts
sections:
  - label: Open Source
    items:
      - This work, like all <a href="/projects/">my other projects</a>, is open source and usually in a state of continuous revision and development. Expect things to change, and (hopefully) get sleeker and easier to use over time. If any features or tweaks or fixes to this product would make your life easier, <a href="mailto:support@theodore.net">please do let me know</a>. And if you haven't already, check out the <a href="/projects/Polargraph/">Polargraph project writeup</a>!
  - label: Lumber
    items:
      - Provide your own lumber or backing material for this build! You can get all stock material from your local hardware store for a whole lot cheaper than I can ship it to you.
  - label: Dimensions
    items:
      - If you're following my build exactly, the final frame is ~48"x60”. However you can resize your machine to fit your space and simply update the machine dimensions in your web
colophon: ""
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
        <div id="product-detail" data-product="polargraph"><!-- rendered by store.js --></div>
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
  <h1 style="display:none;">Polargraph Pen Plotter - Teddy Warner</h1>
  </main>

  <script src="/assets/js/store.js" defer></script>
  <script src="/assets/js/header.js" defer></script>
</body>
</html>
