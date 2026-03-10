---
title: Parametric Bottle Cap Generator
description: Lost a lid or just want a more functional cap? Generate and print your own, compatible with any existing threads!
keywords: Parametric design, Bottle caps, 3D printing, Fusion 360, Custom threads, CAD modeling, Thread profiles, Customizable caps, 3D printed lids, Parametric generator
thumbnail: /assets/images/ParametricGenerator/hero.png
date: 2021-11-01
hide:
  - navigation
  - tags
template: comments.html
---

<figure markdown="1">

*Lost a lid or just want a more functional cap? Generate and print your own, compatible with any existing threads!*

![](../assets/images/ParametricGenerator/beautyshot1.jpg){ width="100%" }

*Be Sure to check out this projects page on [PrusaPrinters](https://www.prusaprinters.org/prints/76271-parametric-bottle-cap-generator), and its [Instructable](https://www.instructables.com/Parametric-Bottle-Cap-Generator/)!*

[Parametric Bottle Cap Generator Files :fontawesome-brands-github:](https://github.com/Twarner491/ParametricBottleCapGenerator){: align=right .md-button .md-button--outlined }

</figure>

## CAD & Testing

{.newthought}This model{/.newthought} was designed in Fusion 360 and uses 3 required input parameters and [standard Metric thread profile](https://amesweb.info/Screws/metric-thread-profile-form-formula.aspx) equations to generate a cap that will perfectly fit any of your threaded containers. Input Parameters can be found from an existing threaded connector following the documentation below and their values can be written in their corresponding Expression boxes in the Parameters spreadsheet of the attached Parametric Bottle Cap Fusion 360 file (shown below)

<figure markdown="1">

![Fusion 360 parameters spreadsheet for cap generation](../assets/images/ParametricGenerator/capparameters.png){ width="95%" }

</figure>

!!! abstract "Project Origins"

    I originally set out to make this generator due to a need for a lower profile cap for the isopropyl alcohol bottle I keep next to my printer. The thread profile of this bottle is rather abnormal, and thus I found myself finding thread component values with [standard Metric thread profile](https://amesweb.info/Screws/metric-thread-profile-form-formula.aspx) equations, the same used by the generator. 

Following the standard Metric thread profile{.sidenote}[Metric Thread Profile Form](https://amesweb.info/Screws/metric-thread-profile-form-formula.aspx){/.sidenote} (displayed in the diagram below)...

<figure markdown="1">

![](../assets/images/ParametricGenerator/ISOThreadForm1.jpg){ width="100%" }

</figure>

The model derives all necessary values from three required input parameters, all of which are fed into Fusion 360's coil tool, creating entirely parametrically generated threads. The calculations for user parameters derived from the three required input parameters are as followed ...

 - ThreadHeight $= \frac{\sqrt{3}}{2} \times$ ThreadPitch
 - HoleSize $=$ ConnectDiameter $+$ ThreadHeight
 - ThreadDmax $=$ ConnectDiameter
 - ThreadDmin $=$ ThreadDmax $- 2 \times \frac{5}{8} \times$ ThreadHeight
 - CapDiameter $=$ HoleSize $+$ ThreadHeight
 - CapHeight $=$ ConnectLength $+ \frac{\text{ThreadPitch}}{2} + 1.5$ mm

The implementation of these [standard Metric thread profile](https://amesweb.info/Screws/metric-thread-profile-form-formula.aspx) equations in a Fusion model parametrically was the real kicker of this design. Unfortunately, Fusion's native thread tool is incompatible with user parameters and thus was unusable in the case of this generator. In its place, I utilized Fusion's coil tool, manipulating the values found in the generator's user parameters to create the caps inner threads. The final working coil tool calculations are as followed ...

 - Diameter $=$ ThreadDmax $+ \frac{\text{ThreadHeight}}{4} \times 2$
 - Height $=$ ConnectLength $+ \frac{\text{ThreadPitch}}{2}$
 - Pitch $=$ ThreadPitch
 - Angle $= 0°$
 - Section Size $=$ ThreadHeight

all of which are included, shown below, to generate the cap's threads.

<figure markdown="1">

![Fusion 360 coil tool settings for thread generation](../assets/images/ParametricGenerator/ThreadCap.png){ width="95%" }

</figure>

Following the Generation of the caps thread, an inner contour is added defined by the ISO 965-1 standard{.sidenote}[ISO 965-1 Standard](https://www.iso.org/standard/57778.html){/.sidenote} - shown in the diagram below.

<figure markdown="1">

![](../assets/images/ParametricGenerator/ISOExternalThreadRootContour.jpg){ width="100%" }

</figure>

This standard calls for radius value *ThreadPitch / 4*, and thus the following values are used in the inner contour ...

 - Radius - *ThreadPitch / 4*
 - Radius Type - *Constant*

The contour is created with Fusion's Fillet tool and the prior mentioned values, shown below.

<figure markdown="1">

![Fusion 360 fillet tool settings for thread contour](../assets/images/ParametricGenerator/threadfillet.png){ width="95%" }

</figure>

All this yields the successful basic generator, embedded below ...

<center>

<div class="embed-frame"><div class="embed-inner">
<iframe src="https://gmail5303747.autodesk360.com/shares/public/SH286ddQT78850c0d8a459c8bfbf26c57d2d?mode=embed" width="95%" height="500" allowfullscreen="true" webkitallowfullscreen="true" mozallowfullscreen="true"  frameborder="0"></iframe>
</div></div>

</center>

... however, what fun would a custom cap generator be without a little customization. The generator includes four different body styles,

 1. Plain
 2. Single-Hole
 3. Salt-Shaker
 4. Lanyard

... allowing for total cap customization. These styles can be changed, along with two other customization factors, discussed in the *Cap Generation* section below.

## Cap Generation -

For documentation purposes, I created a new cap for my Nalgene water bottle …

### Required Measurements 

There are three measurements required to generate your cap, all of which can be taken from the existing threaded connector … 

1. [x] **Connector Diameter -**
Measure the diameter (in MM) of your existing connector, from the very farthest point (i.e. the point of the thread) on either side. 
<figure markdown="1">

![Measuring connector diameter with calipers](../assets/images/ParametricGenerator/diametermeasurment.jpg){ width="95%" }

</figure>
Then, update the Expression value in the ConnectDiameter row (the box highlighted yellow below) with this found value.
<figure markdown="1">

![ConnectDiameter parameter input in Fusion 360](../assets/images/ParametricGenerator/connectdiameter.png){ width="95%" }

</figure>

2. [x] **Connector Length -**
Measure the height (in MM) of your existing connector, from the top lip to underneath the threads.
<figure markdown="1">

![Measuring connector length with calipers](../assets/images/ParametricGenerator/legnthmeasurement.jpg){ width="95%" }

</figure>
Then, update the Expression value in the ConnectLegnth row (the box highlighted yellow below) with this found value.
<figure markdown="1">

![ConnectLength parameter input in Fusion 360](../assets/images/ParametricGenerator/connectlegnth.png){ width="95%" }

</figure>
 
3. [x] **Thread Pitch -**
Measure the thread pitch of your existing connector, the distance in MM between the points of two sequential threads. 
<figure markdown="1">

![Measuring thread pitch with calipers](../assets/images/ParametricGenerator/pitchmeasurment.jpg){ width="95%" }

</figure>
Then, update the Expression value in the ThreadPitch row (the box highlighted yellow below) with this found value.
<figure markdown="1">

![ThreadPitch parameter input in Fusion 360](../assets/images/ParametricGenerator/threadpitch.png){ width="95%" }

</figure>

### Optional Customization

To offer a bit more customization to each generated cap, there are a couple of different preferences allowing for different functions.

1. [ ] **Number of Grips -**
The number of grips lining the edge of the cap can be changed in the Expression value of the NumofGrips row. I find values between 40 through 55 work best, but if your experimenting, going below 11 will stop the generation of grip chamfered.
<figure markdown="1">

![NumofGrips parameter input in Fusion 360](../assets/images/ParametricGenerator/numofgrips.png){ width="95%" }

</figure>

2. [ ] **Grip Depth -**
The depths of these grips can be altered, determining how grippy your grips are. I've found a value around 0.3 or 0.4 offers a good texture around the edge.
<figure markdown="1">

![GripDepth parameter input in Fusion 360](../assets/images/ParametricGenerator/gripdepth.png){ width="95%" }

</figure>

3. [ ] **Lid Style -**
The lid style of your cap can be toggled between 4 presets in the Fusion Parametric Bottle Cap file by navigating to

```
Parametric-Bottle_Cap > Bodies > Styles
```

in the Fusion browser. The lid styles can be toggled between via the eye icon to the left of each style. The four styles are included below, with each of the toggles highlighted.

- Plain -

<figure markdown="1">

![Plain cap style selection in Fusion 360](../assets/images/ParametricGenerator/plain.png){ width="95%" }

</figure>

- Single Hole -

<figure markdown="1">

![Single hole cap style selection in Fusion 360](../assets/images/ParametricGenerator/singlehole.png){ width="95%" }

</figure>

- Salt Shaker -

<figure markdown="1">

![Salt shaker cap style selection in Fusion 360](../assets/images/ParametricGenerator/saltshaker.png){ width="95%" }

</figure>

- Lanyard -

<figure markdown="1">

![Lanyard cap style selection in Fusion 360](../assets/images/ParametricGenerator/lanyard.png){ width="95%" }

</figure>

- (Bonus) Community Remixes - 

    Since I published this article, the community has developed a few additional styles! You can browse these on [printables](https://www.printables.com/model/76271-parametric-bottle-cap-generator/remixes).

!!! success "Congrats!"

    You've successfully generated your own bottle cap!