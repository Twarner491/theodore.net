---
title: Stratolink
description: An upper atmospheric pico balloon network
keywords: Stratolink, pico balloon, high altitude balloon, LoRa, stratosphere, atmospheric sensing, embedded systems, telemetry, balloon tracking, payload design
thumbnail: /assets/images/stratolink/thumb.jpg
date: 2026-06-01
draft: true
hide:
  - navigation
  - tags
template: comments.html
---

<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<link rel="stylesheet" href="/assets/css/projects/stratolink.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js" defer></script>
<script src="/assets/js/stratolink.js" defer></script>


{.newthought}Several months ago{/.newthought}, while standing at the Midjourney ice cream truck near the San Diego bay, [Caleb](https://calebkruse.com), a friend and old coworker of mine sold me on an idea. He wanted to track all the tagged birds in the world 

[explain how tracking birds has workedthus far.]

https://www.shepherdspacesystems.com/

<center>
  <br>
  <div class="tweet-container">
    <div class="tweet-item single">
      <span class="lighttweet"><blockquote class="twitter-tweet"><p lang="en" dir="ltr">The Midjourney ice cream truck has arrived - at Neurips 2025. Free ice cream, tote bags, and magazines for any researchers that come! Sensitive stomach and mind? Don&#39;t worry we got you with Vegan Midjourney flavors too. <a href="https://t.co/NMTUqVveCF">pic.twitter.com/NMTUqVveCF</a></p>&mdash; Midjourney (@midjourney) <a href="https://x.com/midjourney/status/1996318417859809321?ref_src=twsrc%5Etfw">December 3, 2025</a></blockquote> <script async src="https://platform.x.com/widgets.js" charset="utf-8"></script> </span>
      <span class="darktweet"><blockquote class="twitter-tweet" data-theme="dark"><p lang="en" dir="ltr">The Midjourney ice cream truck has arrived - at Neurips 2025. Free ice cream, tote bags, and magazines for any researchers that come! Sensitive stomach and mind? Don&#39;t worry we got you with Vegan Midjourney flavors too. <a href="https://t.co/NMTUqVveCF">pic.twitter.com/NMTUqVveCF</a></p>&mdash; Midjourney (@midjourney) <a href="https://x.com/midjourney/status/1996318417859809321?ref_src=twsrc%5Etfw">December 3, 2025</a></blockquote> <script async src="https://platform.x.com/widgets.js" charset="utf-8"></script> </span>
    </div>
  </div>
  <br>
</center>

---

<figure class="fullwidth">
<img src="../../assets/images/Stratolink/kicadschematic.png" alt="">
</figure>

<center><div class="figure-grid grid-2x1" style="width:60%">
<img src="../../assets/images/Stratolink/kicadrenderfront.jpg" alt="">
<img src="../../assets/images/Stratolink/kicadrenderback.jpg" alt="">
</div></center>

<div class="figure-grid grid-2x1">
<img src="../../assets/images/Stratolink/freshoffthepress.JPG" alt="">
<img src="../../assets/images/Stratolink/freshoffthepressback.JPG" alt="">
</div>

<figure markdown="1">

![](../assets/images/Stratolink/thinboard.JPG){ width="80%" }

</figure>

<figure markdown="1">

![](../assets/images/Stratolink/threeantennabords.JPG){ width="80%" }

</figure>

<figure markdown="1">

![](../assets/images/Stratolink/sdrtest.JPG){ width="80%" }

</figure>

<center>
  <br>
  <div class="tweet-container">
    <div class="tweet-item single">
      <span class="lighttweet"><blockquote class="twitter-tweet"><p lang="en" dir="ltr">radio is wild because the first thing humans did after finding a way to communicate via a mystic field is fill it with music</p>&mdash; blue (@cyanopsis) <a href="https://twitter.com/cyanopsis/status/2057371323048116591?ref_src=twsrc%5Etfw">May 21, 2026</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script></span>
      <span class="darktweet"><blockquote class="twitter-tweet" data-theme="dark"><p lang="en" dir="ltr">radio is wild because the first thing humans did after finding a way to communicate via a mystic field is fill it with music</p>&mdash; blue (@cyanopsis) <a href="https://twitter.com/cyanopsis/status/2057371323048116591?ref_src=twsrc%5Etfw">May 21, 2026</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script></span>
    </div>
  </div>
  <br>
</center>

<figure markdown="1">

![](../assets/images/Stratolink/supercaps.JPG){ width="80%" }

</figure>

{.marginfigure}![v1 board hanging test](../assets/images/Stratolink/bannanamuffins.JPG)My lovely girlfriend made banana muffins while I asked claude some power dev questions{/.marginfigure}

<figure markdown="1">

![](../assets/images/Stratolink/solartest.JPG){ width="80%" }

</figure>

<figure markdown="1">

![](../assets/images/Stratolink/mountedsolarv1.JPG){ width="80%" }

</figure>

{.marginfigure}![v1 board hanging test](../assets/images/Stratolink/hangingmountedsolarv1.JPG)Played around with some different means of hanging the PCB from its mount points{/.marginfigure}

<figure markdown="1">

![](../assets/images/Stratolink/8.32grams.JPG){ width="80%" }

</figure>

<figure markdown="1">

![](../assets/images/Stratolink/chargingpanels.JPG){ width="80%" }

</figure>

{.marginfigure}![v1 board hanging test](../assets/images/Stratolink/sutrotower.JPG) Really pretty morning at Dolores Park{/.marginfigure}

<figure markdown="1">

![](../assets/images/Stratolink/calebcamera.JPG){ width="80%" }

</figure>

<figure markdown="1">

![](../assets/images/Stratolink/doloresGloryHorz.jpg){ width="80%" }

</figure>

<figure markdown="1">

![](../assets/images/Stratolink/launchBros.jpg){ width="80%" }

</figure>

<figure markdown="1">

![](../assets/images/Stratolink/launch1horz.jpg){ width="80%" }

</figure>

<figure markdown="1">

![](../assets/images/Stratolink/balloon1insky.jpg){ width="80%" }

</figure>

<div class="embed-frame" style="--embed-height: 700px;">
  <iframe
    src="https://stratolink.org/dashboard-v2"
    frameborder="0"
    sandbox="allow-scripts allow-same-origin allow-forms"
    tabindex="-1"
  ></iframe>
</div>

<div class="figure-grid grid-3x1">
<img src="../../assets/images/Stratolink/tahoestock.jpg" alt="">
<img src="../../assets/images/Stratolink/tahoeroughingpass.jpg" alt="">
<img src="../../assets/images/Stratolink/tahoefinishingpass.jpg" alt="">
</div>