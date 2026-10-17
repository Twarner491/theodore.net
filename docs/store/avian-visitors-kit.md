---
hide:
  - navigation
  - toc
  - feedback
template: index.html
search:
  exclude: true
title: Avian Visitors Kit
product: true
order: 1
id: avian-visitors-kit
published: true
teaser: A buildable e-paper display that shows the birds around you.
sub: A colorful e-paper frame you build yourself to turn nearby bird sightings into a changing print.
description: The build-it-yourself Avian Visitors display, available as an electronics kit or with the frame and printed parts included.
imageBase: /assets/images/AvianVisitors/
images:
  - avianElectronics.png
  - heard-today.png
  - frameAndBacking.png
defaultBuild: electronics
weight: 1.7   # scale-verified: base kit ships ~2.0 lb packed (0.3 packaging added at checkout)
project: /projects/AvianVisitors/
related:
  - avian-mic
storeListings:
  - category: kits
    build: electronics
    variants:
      - electronics
      - electronics-printed
    title: Avian Visitors Kit
variants:
  - id: electronics
    image: avianElectronics.png
    label: Electronics Kit
    price: 450
    stripePrice: "price_1TkB7KRPSNpqisAPzs2xr9zO"
    stripePriceLive: "price_1TkCJcRPSNpqisAP3ee3eytM"
    desc: All electronics needed for the build, you provide the frame and backing.
    contents:
      - Raspberry Pi 3 A+
      - 13.3" Spectra 6 E-ink panel
      - microSD card
      - Power cable & brick
  - id: electronics-printed
    image: frameAndBacking.png
    label: "+ Frame & Parts"
    price: 520
    weight: 3.2   # scale-verified: ships 3.1-3.7 lb packed
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
      - Pair with a <a href="/store/avian-mic/">Bird Mic Kit</a> to fill the display with birds captured right at your home.
  - label: Open Source
    items:
      - This work, like all <a href="/projects/">my other projects</a>, is open source and usually in a state of continuous revision and development. Expect things to change, and (hopefully) get sleeker and easier to use over time. If any features or tweaks or fixes to this product would make your life easier, <a href="mailto:support@theodore.net">please do let me know</a>. And if you haven't already, check out the <a href="/projects/AvianVisitors/">Avian Visitors project writeup</a>!
  - label: Dimensions
    items:
      - Frame & Parts kit ships with an A4 (8.27" x 11.69") oak wood frame
colophon: 'The build-it-yourself Avian Visitors kits are sold as hardware and do not include preloaded third-party software.'
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
        <div id="product-detail" data-product="avian-visitors-kit"><!-- rendered by store.js --></div>
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
  <h1 style="display:none;">Avian Visitors Kit - Teddy Warner</h1>
  </main>

  <script src="/assets/js/store.js" defer></script>
  <script src="/assets/js/header.js" defer></script>
</body>
</html>
