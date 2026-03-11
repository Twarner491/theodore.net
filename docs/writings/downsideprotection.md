---
title: Why 10x Better Robots Scale 10x Worse
description: Novel hardware adoption is implicitly limited by downside tolerance, not upside potential.
keywords: robotics, automation, hardware adoption, downside protection, risk management, innovation scaling, technology adoption, industrial automation, robot safety, robotics deployment, 10x scaling, novel hardware, downside risk, upside potential, Teddy Warner
thumbnail: /assets/images/downsideprotection/thumb.png
date: 2025-12-08
hide:
  - navigation
  - tags
template: comments.html
---

{.newthought}*Novel hardware adoption*{/.newthought} *is implicitly limited by downside tolerance, not upside potential.*

Hardware that's worth developing innately contains exponential upside. That's the prior to novel hardware work, the justification for the stupendous time/energy/and capital into it; the resulting tech must be exponentially better than the prior most comparable thing. Unlike software where it's possible to stack marginal improvements, the "square wave" of time/energy/cost of hardware demands this massive upside.

Yet the repercussive nature of such a substantial upside often hinders the propagation of that novel hardware itself. Say I have a robot arm that I've developed to pack boxes in an amazon factory. This particular robot arm can do the work of 5 men in a single day. Great! Stupendous even! Very easy to justify the cost of said arm, as opposed to the salaries of 5 men. So why doesn't every factory deploy thousands of arms and save a ton of money?

When those robots fail (and they do, though somewhat infrequently) you now lose the productive output of 5 men. Very rarely (when employing humans) do such a large multiple call in sick, or quit, or have some sudden downtime. Yet when deploying robots with such a substantial upside multiple, we seem to do so despite our downside protection not yet following.

Consider a robot arm at \$70K that replaces 5 warehouse workers at \$35K/year each (\$175K in annual labor). Let's say this robot works at ~10x human speed, so it can accomplish in one hour what takes a human ten hours. Looks like a 5 month payback period, right? Now assume the robot fails just 1.5% of the time, that's 131 hours per year. During those 131 hours, you don't just lose one worker's output. You lose the productive capacity of that 10x speed multiplier doing the work of 5 people. That's 131 hours of zero output where you expected 5 worker equivalent productivity at 10x speed, or roughly 6,550 man-hours lost annually. At \$35K per worker/year (~\$17/hour), that's \$111K in lost productivity. This gets even worse when you consider that this robot must be removed from the production line for debugging (further reducing productive output), and debugged by a costly roboticist (increasing expenses). The 5 month payback stretches to 18-24 months, and that's if the factory can even stomach the productivity volatility.

{.newthought}This fail state{/.newthought} is everything. It keeps the market size and CAGR small by minimizing the number of people who can see a true ROI with that new technology. This has very little to do with the cost of debugging. This has everything to do with the loss of productivity.

This pattern doesn't apply universally. Novel hardware that has achieved massive scale historically solved adequately protected their downsides or avoided it entirely. Smartphones replaced telegraphs and landlines, but the downside of a dead smartphone is just reverting to baseline: you can't make a call for a few hours. As such, smartphones had lower absolute downside risk despite being more complex. Similarly, EVs replace combustion vehicles but with comparable failure modes. When a Tesla fails, you're down one car, same as a combustion vehicle failure. The productivity multiplier is 1:1, so the failure multiplier is also 1:1. Industrial robots are different. A warehouse robot arm that replaces 5 workers creates a 5:1 productivity multiplier, but also a 5:1 downside multiplier. This is the core asymmetry that limits industrial robot adoption despite obvious ROI.

{.newthought}Hardware founders{/.newthought} and engineers consistently underweight tail risk in adoption decisions. The compounding economic impact of correlated failures is the primary hindrance in expansion of hardware efforts. If more engineers considered this, propagation of novel hardware in the physical world would compound much faster.

The market prices hardware startups like SaaS companies, favoring sleek launch videos and niche early adopter markets. This works for software because SaaS companies can build \$100M ARR businesses selling to 500 companies in a tight, self-reinforcing ecosystem. Hardware can't play this game. The market is the physical world itself, and mass adoption is limited by downside tolerance, not upside potential.
