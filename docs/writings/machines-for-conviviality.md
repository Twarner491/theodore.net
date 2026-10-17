---
title: Machines for Conviviality
description: About dancing bees, sycophancy, and our need for emotionally intelligent machines.
keywords: AI, conviviality, emotional intelligence, robotics, alignment, philosophy of technology, human machine interaction, Ivan Illich, tools for conviviality, bee dance, sycophancy
thumbnail: /assets/images/machines-for-conviviality/signac-au-temps-d-harmonie-1420.jpg
thumbnail_alt: Paul Signac, In the Time of Harmony, 1893–95 — a pointillist pastoral of figures at leisure on a sunlit coast
thumbnail_width: 1420
thumbnail_height: 1064
date: 2026-05-11
hide:
  - navigation
  - tags
template: comments.html
---

<link rel="stylesheet" href="../../assets/css/machines-for-conviviality.css">

<figure class="marginfigure conviviality-opening-art">
  <img src="/assets/images/machines-for-conviviality/signac-au-temps-d-harmonie-1420.jpg" alt="Paul Signac, In the Time of Harmony, 1893–95 — a pointillist pastoral of figures at leisure on a sunlit coast">
  <span class="caption">Paul Signac, <em>In the Time of Harmony</em>, 1893–95. The full title is <em>Au temps d'harmonie: l'âge d'or n'est pas dans le passé, il est dans l'avenir</em> ("The Golden Age is not in the past, it is in the future.")</span>
</figure>

{.newthought}Our future will be full of machines{/.newthought} and they will have to interact with us. When we consider these machines of the future, do we aspire to design technologies more like the telephone or the fax machine? Both augment the human experience by conveying information more quickly, but telephones keep humans in the loop throughout the process. Most [people do not seem to like learning new languages](https://www.insidehighered.com/news/faculty-issues/curriculum/2023/11/16/foreign-language-enrollment-sees-steepest-decline-record), so we must continue to bridge gaps between binary code and human communication. We must make them fluent in our warm human-ness instead of a cold, ever-long cascade of beeps and boops.

<figure class="hello-world">
  <p class="hello-world__prompt">Click to hear “hello world”.</p>
  <div class="hello-world__channels">
    <button type="button" class="hello-world__channel" id="hw-voice" aria-label="Hear hello world spoken aloud">
      <span class="hello-world__play-icon" aria-hidden="true">
        <svg viewBox="0 0 12 12" width="10" height="10"><path d="M 4,2 L 4,10 L 10,6 Z"></path></svg>
      </span>
      <span>telephone</span>
    </button>
    <button type="button" class="hello-world__channel" id="hw-fax" aria-label="Hear hello world as Morse code beeps">
      <span class="hello-world__play-icon" aria-hidden="true">
        <svg viewBox="0 0 12 12" width="10" height="10"><path d="M 4,2 L 4,10 L 10,6 Z"></path></svg>
      </span>
      <span>fax machine</span>
    </button>
  </div>
  <figcaption>Both transmit the exact same message.</figcaption>
</figure>

Man has long dreamt of machines that are loved. Our films and literature imagine machines we grow attached to because they are similar to us; they speak our language. Iron Giant fights to protect a boy who taught him empathy.{.sidenote}[Brad Bird Talks 'Iron Giant'](https://www.awn.com/animationworld/brad-bird-talks-iron-giant-10th-anniversary){/.sidenote} WALL-E simply wants to hold someone's hand.{.sidenote}[WALL-E's Andrew Stanton](https://www.cinemablend.com/new/Interview-WALL-E-Andrew-Stanton-9323.html){/.sidenote}

{.newthought}While we humans{/.newthought} like to think of our society as rational, we are a lot more like bees; we do these funny little dances to understand each other.{.sidenote}[Predictably Irrational](https://en.wikipedia.org/wiki/Predictably_Irrational), [Thinking, Fast and Slow](https://en.wikipedia.org/wiki/Thinking,_Fast_and_Slow){/.sidenote}

<figure class="bee-dance" tabindex="0">
  <svg class="bee-dance__svg" viewBox="0 0 880 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The two dances of the honeybee — round and waggle — after von Frisch. Hover or focus to reveal dancing humans.">
    <defs>
      <path id="round-motion" d="M 48,-60 C 72,-68 80,-46 56,-40 C 34,-36 38,-56 52,-54 C 62,-50 80,-50 92,-30 C 108,4 86,64 36,74 C -20,82 -84,56 -90,8 C -96,-38 -58,-78 -4,-80 C 22,-80 36,-72 48,-60"></path>
      <path id="waggle-motion" d="M 0,110 C 3,72.6 -3,36.3 0,0 C 3,-36.3 -3,-72.6 0,-110 C 42.9,-110 78,-60.5 78,0 C 78,60.5 42.9,110 0,110 C 3,72.6 -3,36.3 0,0 C 3,-36.3 -3,-72.6 0,-110 C -42.9,-110 -78,-60.5 -78,0 C -78,60.5 -42.9,110 0,110"></path>
    </defs>

    <g transform="translate(210, 165)">
      <path class="bee-dance__path" d="M 48,-60 C 72,-68 80,-46 56,-40 C 34,-36 38,-56 52,-54 C 62,-50 80,-50 92,-30 C 108,4 86,64 36,74 C -20,82 -84,56 -90,8 C -96,-38 -58,-78 -4,-80 C 22,-80 36,-72 48,-60"></path>
      <path class="bee-dance__arrow" d="M 5,-81 L 11,-78 L 5,-75 Z"></path>
      <path class="bee-dance__arrow" d="M 87,12 L 93,12 L 90,18 Z"></path>
      <path class="bee-dance__arrow" d="M -5,73 L -5,79 L -11,76 Z"></path>
      <path class="bee-dance__arrow" d="M -93,-9 L -87,-9 L -90,-15 Z"></path>
      <g class="bee-dance__dancer">
        <animateMotion dur="7s" repeatCount="indefinite" rotate="auto"><mpath href="#round-motion"></mpath></animateMotion>
        <g class="bee-dance__sprite-rotator">
          <g class="bee-dance__bee">
            <svg x="-34" y="-26" width="68" height="52" viewBox="0 0 94 72" overflow="hidden">
              <ellipse class="bee-dance__backing" cx="47" cy="38" rx="36" ry="28"></ellipse>
              <image href="/assets/images/machines-for-conviviality/bee-idle.png" width="752" height="72" x="0" y="0">
                <animate attributeName="x" values="0;-94;-188;-282;-376;-470;-564;-658" dur="0.64s" calcMode="discrete" repeatCount="indefinite"></animate>
              </image>
            </svg>
          </g>
          <svg class="bee-dance__human" x="-25" y="-36" width="50" height="71" viewBox="0 0 49 70" overflow="hidden">
            <ellipse class="bee-dance__backing" cx="24" cy="36" rx="18" ry="34"></ellipse>
            <image href="/assets/images/machines-for-conviviality/dancer-idle.png" width="392" height="70" x="0" y="0">
              <animate attributeName="x" values="0;-49;-98;-147;-196;-245;-294;-343" dur="1.28s" calcMode="discrete" repeatCount="indefinite"></animate>
            </image>
          </svg>
        </g>
      </g>
      <text class="bee-dance__label" y="140" text-anchor="middle">Round dance</text>
    </g>

    <g transform="translate(670, 165)">
      <path class="bee-dance__path" d="M 0,110 C 3,72.6 -3,36.3 0,0 C 3,-36.3 -3,-72.6 0,-110 C 42.9,-110 78,-60.5 78,0 C 78,60.5 42.9,110 0,110 C 3,72.6 -3,36.3 0,0 C 3,-36.3 -3,-72.6 0,-110 C -42.9,-110 -78,-60.5 -78,0 C -78,60.5 -42.9,110 0,110"></path>
      <path class="bee-dance__arrow" d="M 0,-108 l -4,6 l 8,0 z"></path>
      <path class="bee-dance__arrow" d="M 78,-4 L 86,-4 L 82,5 Z"></path>
      <path class="bee-dance__arrow" d="M -86,-4 L -78,-4 L -82,5 Z"></path>
      <g class="bee-dance__dancer">
        <animateMotion dur="12s" repeatCount="indefinite" rotate="auto"><mpath href="#waggle-motion"></mpath></animateMotion>
        <g class="bee-dance__sprite-rotator">
          <g class="bee-dance__bee bee-dance__bee--waggle">
            <svg x="-34" y="-26" width="68" height="52" viewBox="0 0 94 72" overflow="hidden">
              <ellipse class="bee-dance__backing" cx="47" cy="38" rx="36" ry="28"></ellipse>
              <image href="/assets/images/machines-for-conviviality/bee-idle.png" width="752" height="72" x="0" y="0">
                <animate attributeName="x" values="0;-94;-188;-282;-376;-470;-564;-658" dur="0.56s" calcMode="discrete" repeatCount="indefinite"></animate>
              </image>
            </svg>
          </g>
          <svg class="bee-dance__human" x="-25" y="-36" width="50" height="71" viewBox="0 0 49 70" overflow="hidden">
            <ellipse class="bee-dance__backing" cx="24" cy="36" rx="18" ry="34"></ellipse>
            <image href="/assets/images/machines-for-conviviality/dancer-idle.png" width="392" height="70" x="0" y="0">
              <animate attributeName="x" values="0;-49;-98;-147;-196;-245;-294;-343" dur="0.96s" calcMode="discrete" repeatCount="indefinite"></animate>
            </image>
          </svg>
        </g>
      </g>
      <text class="bee-dance__label" y="140" text-anchor="middle">Waggle dance</text>
    </g>
  </svg>
  <figcaption>After von Frisch. <a href="http://www.buzzingacrossamerica.com/2014/08/the-language-of-honey-bee.html">The language of the honey bee</a></figcaption>
</figure>

Bees waggle and shake to share information.{.marginnote}[*Decoding the Language of the Bee*](https://www.nobelprize.org/uploads/2018/06/frisch-lecture.pdf){/.marginnote} We do the same; we [scream](https://scispace.com/pdf/the-signal-functions-of-early-infant-crying-zov0kx5dyk.pdf) and [flail](https://www.sciencedirect.com/science/article/abs/pii/S0163638307000343?via%3Dihub) to share our thoughts and feelings.

Regardless of where we come from or the languages we speak, we're native to the experiences of emotion. We are able to interpret the analog jitter creatures give off, from [cats](https://pmc.ncbi.nlm.nih.gov/articles/PMC7401521/) to [dogs](https://royalsocietypublishing.org/rsbl/article/12/1/20150883/50723/Dogs-recognize-dog-and-human-emotionsDogs) to [other people](https://www.gutenberg.org/ebooks/1227).

We are not born with technical competency. The average human can not 'speak' the command line.{.marginnote}[*The Distribution of Users' Computer Skills*](https://www.nngroup.com/articles/computer-skill-levels/), "Across 33 rich countries, only 5% of the population has high computer-related abilities, and only a third of people can complete medium-complexity tasks."{/.marginnote} To build machines we may all love and understand requires their participation in our dance. They must be emotional.

Our emotional nature is already bled into the [overly sycophantic machines of today](https://openai.com/index/sycophancy-in-gpt-4o/). A machine trained on text alone can successfully act and react emotionally, but often in a superficial way, leaving us [prone to manipulation](https://www.science.org/doi/10.1126/science.aec8352). A machine explicitly trained on our emotional nature is, by that fact, less sycophantic because it grasps what is flattering. A shared emotional language allows everyone, including those lacking in technical literacy, an additional channel to note and alter the behavior of the machines we interact with every day. Readability will [not solve alignment alone](https://arxiv.org/html/2406.07358v3), but one more channel is one more channel, and it is an inherently human one.

Like the many machines that came before them, our machines of the future should exist in good company with ourselves.

<div class="dinkus" aria-hidden="true">* * *</div>

*Thank you to Maxime Vidal, Luke Drago, Alexandra Silverman, Harry Sanders, and Omar Ababneh for reviewing early drafts of this essay.*

<script src="../../assets/js/machines-for-conviviality.js"></script>
