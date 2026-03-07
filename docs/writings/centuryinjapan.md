---
title: A Century in Japan
description: 439.59 miles, 21,165 ft of elev. gained, ~39.21 hrs of peddling.
keywords: cycling Japan, bikepacking, century ride, long distance cycling, Osaka to Tokyo, bike touring Japan, Japanese Alps, 35mm film photography, adventure cycling, travel writing, San Francisco, cycling adventure, film camera travel, bike journey, endurance cycling
thumbnail: /assets/images/centuryinjapan/thumb.png
readtime: "9–11 mins"
date: 2025-11-01
hide:
  - navigation
  - tags
template: comments.html
---

<style>
  /* Ensure carousel container has min-height before images load */
  #japan-carousel {
    min-height: 500px;
    display: block;
    visibility: visible;
  }
  
  @media (max-width: 860px) {
    #japan-carousel {
      min-height: 300px;
    }
  }
  
  @media (max-width: 695px) {
    #japan-carousel {
      min-height: 250px;
    }
  }
</style>
<script>
  // Initialize carousel with robust loading
  function initJapanCarousel() {
    const japanCarousel = document.getElementById('japan-carousel');
    if (!japanCarousel) {
      console.warn('Japan carousel container not found');
      return;
    }
    
    // Check if ImageCarousel class is available
    if (typeof ImageCarousel === 'undefined') {
      console.warn('ImageCarousel class not loaded yet, retrying...');
      setTimeout(initJapanCarousel, 100);
      return;
    }
    
    const japanImages = [
      '000061380021_21.jpg',
      '000061380020_20.jpg',
      '000061380011_11.jpg',
      '000061380012_12.jpg',
      '000061380013_13.jpg',
      '000061380015_15.jpg',
      '000061380016_16.jpg',
      '000061380017_17.jpg',
      '000061380018_18.jpg',
      '000061380019_19.jpg',
      '000061380023_23.jpg',
      '000061380024_24.jpg',
      '000061380025_25.jpg',
      '000061380026_26.jpg',
      '000061380027_27.jpg',
      '000061380028_28.jpg',
      '000061380029_29.jpg',
      '000061380030_30.jpg',
      '000061380031_31.jpg',
      '000061380034_34.jpg',
      '000061380035_35.jpg',
      '000061390004_4.jpg',
      '000061390006_6.jpg',
      '000061390007_7.jpg',
      '000061390008_8.jpg',
      '000061390009_9.jpg',
      '000061390010_10.jpg',
      '000061390012_12.jpg',
      '000061390014_14.jpg',
      '000061390015_15.jpg',
      '000061390016_16.jpg',
      '000061390017_17.jpg',
      '000061390018_18.jpg',
      '000061390019_19.jpg',
      '000061390020_20.jpg',
      '000061390021_21.jpg',
      '000061390023_23.jpg',
      '000061390024_24.jpg',
      '000061390025_25.jpg',
      '000061390031_31.jpg',
      '000061400001_1.jpg',
      '000061400002_2.jpg',
      '000061400003_3.jpg',
      '000061400004_4.jpg',
      '000061400005_5.jpg',
      '000061400006_6.jpg',
      '000061400007_7.jpg',
      '000061400008_8.jpg',
      '000061400009_9.jpg',
      '000061400010_10.jpg',
      '000061400011_11.jpg',
      '000061400012_12.jpg',
      '000061400013_13.jpg',
      '000061400014_14.jpg',
      '000061400015_15.jpg',
      '000061400016_16.jpg',
      '000061400017_17.jpg',
      '000061400019_19.jpg',
      '000061400020_20.jpg',
      '000061400022_22.jpg',
      '000061400023_23.jpg',
      '000061400027_27.jpg',
      '000061400028_28.jpg',
      '000061400029_29.jpg',
      '000061400030_30.jpg',
      '000061400032_32.jpg',
      '000061400033_33.jpg',
      '000061400036_36.jpg',
      '000061410001_1.jpg',
      '000061410002_2.jpg',
      '000061410003_3.jpg',
      '000061410004_4.jpg',
      '000061410005_5.jpg',
      '000061410006_6.jpg',
      '000061410008_8.jpg',
      '000061410009_9.jpg',
      '000061410010_10.jpg',
      '000061410011_11.jpg',
      '000061410013_13.jpg',
      '000061410014_14.jpg',
      '000061410015_15.jpg',
      '000061410016_16.jpg',
      '000061410017_17.jpg',
      '000061410018_18.jpg',
      '000061410019_19.jpg',
      '000061410020_20.jpg',
      '000061410021_21.jpg',
      '000061410022_22.jpg',
      '000061410023_23.jpg',
      '000061410024_24.jpg',
      '000061410025_25.jpg',
      '000061410026_26.jpg',
      '000061410027_27.jpg',
      '000061410028_28.jpg',
      '000061410029_29.jpg',
      '000061410030_30.jpg',
      '000061410031_31.jpg',
      '000061410032_32.jpg',
      '000061410033_33.jpg',
      '000061410034_34.jpg',
      '000061410035_35.jpg',
      '000061410036_36.jpg',
      '000061420004_4.jpg',
      '000061420005_5.jpg',
      '000061420006_6.jpg',
      '000061420009_9.jpg',
      '000061430007_7.jpg',
      '000061430019_19.jpg',
      '000061430021_21.jpg',
      '000061430022_22.jpg',
      '000061430028_28.jpg',
      '000061430031_31.jpg',
      'IMG_7771.jpg',
      'IMG_7821.jpg',
      'IMG_7832.jpg',
      'IMG_7914.jpg',
      'IMG_7951.jpg',
      'IMG_7977.jpg',
      'IMG_7992.jpg',
      'IMG_8002.jpg',
      'IMG_8015.jpg',
      'IMG_8019.jpg',
      'IMG_8027.jpg',
      'IMG_8050.jpg'
    ];
    
    try {
      new ImageCarousel('japan-carousel', '../../assets/images/Japan/favs', japanImages);
    } catch (error) {
      console.error('Error initializing Japan carousel:', error);
    }
  }
  
  // Initialize header immediately
  if (typeof initializeHeader !== 'undefined') {
    initializeHeader();
  }
  
  // Try to initialize carousel immediately if DOM is already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initJapanCarousel);
  } else {
    // DOM is already loaded, initialize immediately
    initJapanCarousel();
  }
</script>

I'm currently sitting in the dirt, under a tall tree in a park in the middle of Tokyo. I've managed to ignorantly place myself next to a small ant pile, and as I've been sitting here for quite some time now, the ants have taken to waging war on my legs. No matter, besides the ants, I've found quite the lovely spot. Plus, I'm not one to shy away from a good attack on the corpus inferius.

This morning, I wrapped up my longest bike ride to date: The Length of Japan (or Osaka to Tokyo at least). 439.59 miles, 21,165 ft of elev. gained ~39.21 hrs of peddling.

Quite the epic journey, and one that I'm super proud of. I'm not one to pass up on some good shenanigans, but this trip felt like a bit of a large scope. I find it amusing how things like this come about. There is certainly some "outlandish" limit to the scope of shenanigans that I would readily take on, and I would certainly categorise this ride as initially outside of this limit.

I have a few friends to thank for pushing this ride within my "landish" scope of shennigans if you will: Tom, who initially suggested the ride, Aidan, who miraculously had done a Tokyo to Osaka ride just a few weeks prior, and Koki (my Japanese friend), who looked at my crazy when I mentioned the ride to him. There's something about arguing that something is possible that really convinces you to want to do that thing.

### Day 3

Day 2, I rode 49.69 miles, which was my longest ride ever recorded. Day 3, I had to one-up it (duh). I've had a bit of a silly mantra stuck in my head for the past few months: "who am I to *not* tell my grandkids that I did [insert silly thing here] when I was 20." As such, on day 3 of my ride, I rode my first ever century, something I've been wanting to do for quite some time. 100.11 miles, 4,291 feet of elevation gained, 8 hours and 42 minutes in the saddle. 

### The Rest (ing)

I finished the ride in 8 days, two days ahead of schedule. Those extra two days in Tokyo were incredibly welcome. I didn't do much exploring, mostly just rotted in my hotel room, ate convenience store onigiri, and walked around aimlessly. I had an absolute blast in Asia overall, but I felt like I'd been away from home for a century (lol). I love San Francisco - the people here, how naturally beautiful it is, how weird and whimsical everything is. Landing back at SFO and finally getting back to my apartment felt really, really good.

### A Century on 35mm

Tom convinced me to buy a 35mm point-and-shoot film camera a few weeks before the trip. I plotted my route on a paper map and had this idea that I'd do the whole thing mostly phoneless (I failed spectacularly at this). Turns out navigating the Japanese Alps on vibes alone is a bad idea, who would have thought. But I did stick with the film camera, which felt like something.

I shot seven rolls across Japan and Korea - here are some of the results:

<div id="japan-carousel"></div>

### Ride my Route

There's this Derek Sivers essay I think about a lot, where he bikes along the Santa Monica beach ([Relax for the same result](https://sive.rs/relax) I believe). One day he goes all out - red-faced, 100% effort, completely exhausted. Finishes in 43 minutes. Another day he decides to just chill and take it easy at like 50% effort. Finishes in like 45 minutes. 

I've determined this is a great metaphorical mantra to live by in many facets of life. Not in shenanigans. The suffering makes the story, if you take it easy, what separates that ride, that day, from any other? Odds are, very little. 

For anyone who wants to ride my route: [here's the GPX](../assets/misc/Legnth_of_Japan.gpx). Osaka → Kyoto → Lake Biwa → Ena → Iida → Ina → Chino → Kofu → Tokyo, 439.59 miles, 21,165 ft of elevation gain, 8 days total. Or ride the route I planned to ride (which I believe is slightly shorter but more elevation).

<center>
    <div style="position:relative;padding-bottom:56.25%;" class="strava-embed-placeholder" data-embed-type="route" data-embed-id="3412901464299209894" data-full-width="true" data-style="light" data-map-hash="6.25/35.333/137.633" data-from-embed="true"></div><script src="https://strava-embeds.com/embed.js"></script>
</center>

Note - I bought a used bike in Osaka for ¥70,000 and sold it in Tokyo for ¥30,000, so the whole bike situation cost me about $260. This is seemingly a better deal then renting.

I'm still sitting here in the dirt. The ants are still attacking my legs, but I made it. Worth it.
