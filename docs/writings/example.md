---
title: Tufte-Inspired Elements
description: A demonstration of Tufte-inspired typographic elements and refined MkDocs Material components.
keywords: Tufte, typography, design, sidenotes, epigraphs
thumbnail: /assets/images/index/orange.png
draft: true
readtime: "5-8 mins"
date: 2026-03-06
hide:
  - navigation
  - tags
template: comments.html
---

{.epigraph}
> The English language becomes ugly and inaccurate because our thoughts are foolish, but the slovenliness of our language makes it easier for us to have foolish thoughts.
> — George Orwell, <cite>"Politics and the English Language"</cite>

> For a successful technology, reality must take precedence over public relations, for Nature cannot be fooled.
> — Richard P. Feynman, <cite>"What Do You Care What Other People Think?"</cite>

> I do not paint things, I paint only the differences between things.
> — Henri Matisse, <cite>Henri Matisse Dessins: themes et variations</cite> (Paris, 1943), 37
{/.epigraph}

{.newthought}In his later books{/.newthought}, Tufte starts each section with a bit of vertical space, a non-indented paragraph, and the first few words of the sentence set in small caps. This is the `newthought` element, used at the start of new sections to signal a shift in topic without the disruption of a heading. Vertical spacing is accomplished naturally through markdown paragraph breaks.

This paragraph demonstrates how body text renders. Notice how the text feels different from a typical sans-serif web font{.sidenote}ET Book is based on Bembo, originally designed by Francesco Griffo in 1495. The digital version was created by Dmitry Krasny, Bonnie Scranton, and Edward Tufte.{/.sidenote} -- there is a warmth and humanity to the letterforms that makes extended reading comfortable.

> Everything should be made as simple as possible, but no simpler.

---

### Sidenotes and Margin Notes

{.newthought}One of the most distinctive{/.newthought} features of Tufte's style is his extensive use of sidenotes. Sidenotes are like footnotes, except they don't force the reader to jump their eye to the bottom of the page{.sidenote}This is a sidenote. On large screens it appears in the margin to the right. On small screens, tap the number to reveal it inline.{/.sidenote}. Instead, they display off to the side in the margin, keeping related but secondary information close to the text that references it.

If you want a note without the superscript number, you can use a margin note instead{.marginnote}This is a margin note. Notice there is no number preceding it -- just a small icon on small screens to toggle visibility.{/.marginnote}. Margin notes are useful for asides, definitions, or contextual information that relates to the adjacent text but doesn't require a formal citation reference.

The goal is to present related but not necessary information as close as possible to the text that references it. At the same time, this secondary information should stay out of the way of the eye, not interfering with the progression of ideas in the main text.

---

### Figures

Tufte emphasizes tight integration of graphics with text. Data, graphs, and figures are kept with the text that discusses them{.marginfigure}![Margin figure](https://picsum.photos/300/200?random=20)
A small image placed in the margin, adjacent to the text that references it.{/.marginfigure}. On the web, that means readability of graphics and their accompanying text without extra clicks or scrolling.

Standard figures are constrained to the main column{.marginnote}A standard figure with a margin description. This note collapses to a circle-plus icon on small screens.{/.marginnote}:

<figure>
<img src="https://picsum.photos/800/350" alt="A standard figure" width="100%">
</figure>

For images that need more space, use the fullwidth class{.marginnote}Fullwidth figures expand into the TOC sidebar area, giving more{/.marginnote}:

<figure class="fullwidth">
<img src="https://picsum.photos/1200/400" alt="A fullwidth figure spans the entire content area" width="100%">
</figure>

### Figure Grids

Multiple images can be laid out in flexible grids. Images share heights and distribute width automatically, adjusting for varying aspect ratios.

**2x1 Grid:**{.marginnote}Images in a grid automatically share the same row height while dynamically adjusting their widths based on aspect ratio.{/.marginnote}

<div class="figure-grid grid-2x1">
<img src="https://picsum.photos/600/300?random=1" alt="Grid image 1">
<img src="https://picsum.photos/400/300?random=2" alt="Grid image 2">
</div>

**3x1 Grid:**

<div class="figure-grid grid-3x1">
<img src="https://picsum.photos/400/300?random=3" alt="Grid image 3">
<img src="https://picsum.photos/500/400?random=4" alt="Grid image 4">
<img src="https://picsum.photos/300/300?random=5" alt="Grid image 5">
</div>

**2x2 Grid:**

<div class="figure-grid grid-2x2">
<img src="https://picsum.photos/500/400?random=6" alt="Grid image 6">
<img src="https://picsum.photos/500/350?random=7" alt="Grid image 7">
<img src="https://picsum.photos/500/200?random=8" alt="Grid image 8">
<img src="https://picsum.photos/600/350?random=9" alt="Grid image 9">
</div>

---

### Links

{.newthought}Links in this design{/.newthought} match the body text in color and do not change on mouseover or when clicked. They are underlined with a subtle, thin line -- the most widely recognized indicator of clickable text. [Here is a link that demonstrates this styling](#). The underline becomes slightly more prominent on hover, but the text color remains unchanged throughout all states: unvisited, visited, hover, and active.

This approach keeps the page visually calm. Traditional blue links create visual noise that disrupts the reading experience{.sidenote}Tufte's principle: minimize non-data ink. Blue link text is non-data ink that adds visual clutter without aiding comprehension.{/.sidenote}, particularly in text-heavy pages where many references appear. The underline alone is sufficient to signal interactivity.

---

### Code

Technical jargon, programming language terms, and code samples use `monospace` formatting. Code blocks use syntax highlighting provided by Material's native Pygments integration.

``` python title="tufte_elements.py"
def on_page_markdown(markdown, page, config, files, **kwargs):
    """Process Tufte shorthand syntax in markdown."""
    src_path = page.file.src_path
    if not (src_path.startswith('projects/') or src_path.startswith('writings/')):
        return markdown
    return process_elements(markdown)
```

``` yaml title="mkdocs.yml"
theme:
  features:
    - content.code.annotate # (1)
```

1. Code annotations are also styled monochromatic.

---

### Admonitions

!!! abstract "Abstract"

    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla et euismod
    nulla. Curabitur feugiat, tortor non consequat finibus.

!!! note "A Note"

    Notes provide additional context without interrupting the flow.

!!! info "Information"

    Informational callout with supporting details.

!!! tip "Helpful Tip"

    A useful suggestion for the reader.

!!! warning "Warning"

    Something to be cautious about.

!!! danger "Danger"

    Critical information that requires immediate attention.

!!! note inline "Inline Note"

    This note floats to the left of the following content, useful for
    short asides that relate to adjacent text.

!!! info inline end "Inline End"

    This note floats to the right, creating a
    two-column layout with the adjacent note.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla et euismod nulla. Curabitur feugiat, tortor non consequat finibus, justo purus auctor massa, nec semper lorem quam in massa. Clear the inline admonitions with some body text.

??? tip "Collapsible Tip"

    Click the title to expand. Collapsible admonitions use the same styling.

??? warning "Collapsible Warning"

    Warnings and other types maintain consistent appearance across states.

---

### Buttons

Buttons are styled to be minimal and sleek, consistent with the monochromatic palette.

[Primary Button](#){ .md-button .md-button--primary }
[Outline Button](#){ .md-button }

---

### Tables

Standard formatted tables receive refined typography and subtle horizontal rules.

| Method | Description | Status |
|--------|-------------|--------|
| `GET` | Fetch resource | Supported |
| `PUT` | Update resource | Supported |
| `DELETE` | Delete resource | Restricted |
| `POST` | Create resource | Supported |

### Bill of Materials

Long BOM tables are wrapped in a scrollable container with a sticky header for easy navigation. Use a `bom-table` wrapper:

<div class="bom-table" markdown>

| Qty | Description | Cost | Link | Notes |
|-----|-------------|------|------|-------|
| 14 | Breadboard | $112 | [link](#) | Standard solderless |
| 10 | 1k resistor | -- | [link](#) | 1/4W |
| 9 | 10k resistor | -- | [link](#) | 1/4W |
| 24 | 470 resistor | -- | [link](#) | 1/4W |
| 6 | 0.01uF capacitor | $1.20 | [link](#) | Ceramic |
| 16 | 0.1uF capacitor | $3.00 | [link](#) | Ceramic |
| 4 | 555 timer IC | $0.63 | [link](#) | NE555 |
| 2 | 74LS00 NAND gate | $0.76 | [link](#) | Quad |
| 5 | 74LS04 Hex inverter | $0.87 | [link](#) | |
| 3 | 74LS08 AND gate | $0.72 | [link](#) | Quad |
| 8 | 74LS173 D register | $1.45 | [link](#) | 4-bit |
| 2 | 74189 RAM | $9.90 | [link](#) | 64-bit |
| 6 | 74LS245 transceiver | $1.26 | [link](#) | Octal |
| 3 | 28C16 EEPROM | $11.85 | [link](#) | |
| 44 | Red LED | -- | [link](#) | 5mm |
| 8 | Yellow LED | -- | [link](#) | 5mm |
| 12 | Green LED | -- | [link](#) | 5mm |
| 4 | 7-segment display | $4.36 | [link](#) | Common cathode |
| 1 | 22 AWG wire | $29.95 | [link](#) | Solid core |

</div>

---

### Lists

### Ordered List

1. First item with some description text
2. Second item that continues the sequence
3. Third item demonstrating consistent spacing
    1. Nested items maintain hierarchy
    2. With proper indentation

### Unordered List

- Item one describing a feature
- Item two with a brief explanation
- Item three continuing the pattern
    - Nested sub-items
    - Are properly indented

### Task List

- [x] Completed task with strikethrough indicator
- [x] Another finished item
    * [x] Nested completed sub-task
    * [ ] Nested incomplete sub-task
- [ ] Remaining work to be done

### Definition List

`Term One`

:   A clear definition with proper indentation and spacing, maintaining
    readability across multiple lines.

`Term Two`

:   Another definition that demonstrates consistent formatting
    throughout the definition list structure.

---

### Content Tabs

=== "YAML"

    ``` yaml title="Example Configuration"
    theme:
      features:
        - content.code.annotate
    ```

=== "Python"

    ``` python title="Example Script"
    import mkdocs
    config = mkdocs.config.load_config()
    ```

=== "Markdown"

    ``` markdown
    !!! note "A Note"
        Content goes here.
    ```

---

### LaTeX / Math

Inline math: The quadratic formula is $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$ and can be derived by completing the square.

Display math:

$$W_{counter} = k \cdot \frac{W_{gondola}}{2}$$

where $k \approx 0.75\text{-}0.85$ gives good results.

$$\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$$

---

### YouTube Embed

<div class="embed-frame">
  <div class="embed-inner">
    <iframe src="https://www.youtube.com/embed/ZFyQTihnSG4" title="" allow="autoplay; encrypted-media" allowfullscreen></iframe>
  </div>
</div>

---

### Twitter / X Embed

<div class="tweet-container">
  <div class="tweet-item single">
    <span class="lighttweet"><blockquote id='tweet' class="twitter-tweet" data-theme="light"><p lang="en" dir="ltr">I've withdrawn from the tournament. I've always enjoyed playing in the <a href="https://twitter.com/STLChessClub?ref_src=twsrc%5Etfw">@STLChessClub</a>, and hope to be back in the future <a href="https://t.co/YFSpl8er3u">https://t.co/YFSpl8er3u</a></p>&mdash; Magnus Carlsen (@MagnusCarlsen) <a href="https://twitter.com/MagnusCarlsen/status/1566848734616555523?ref_src=twsrc%5Etfw">September 5, 2022</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script></span>
    <span class="darktweet"><blockquote id='tweet' class="twitter-tweet" data-theme="dark"><p lang="en" dir="ltr">I've withdrawn from the tournament. I've always enjoyed playing in the <a href="https://twitter.com/STLChessClub?ref_src=twsrc%5Etfw">@STLChessClub</a>, and hope to be back in the future <a href="https://t.co/YFSpl8er3u">https://t.co/YFSpl8er3u</a></p>&mdash; Magnus Carlsen (@MagnusCarlsen) <a href="https://twitter.com/MagnusCarlsen/status/1566848734616555523?ref_src=twsrc%5Etfw">September 5, 2022</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script></span>
  </div>
</div>

---

### Photo Carousel

{.carousel}assets/images/Japan/favs{/.carousel}

---

### Iframe Embed

<div class="embed-frame">
  <div class="embed-inner">
    <iframe src="https://gmail5303747.autodesk360.com/shares/public/SH90d2dQT28d5b602811b69ff174e571ad2a?mode=embed" allowfullscreen="true" webkitallowfullscreen="true" mozallowfullscreen="true"></iframe>
  </div>
</div>

---

### Markdown Shorthand Reference

The Tufte shorthand syntax is processed by `tufte_elements.py` before rendering:

| Element | Syntax |
|---------|--------|
| Newthought | `{.newthought}` Text `{/.newthought}` |
| Sidenote | `{.sidenote}` Note text `{/.sidenote}` |
| Margin note | `{.marginnote}` Note text `{/.marginnote}` |
| Margin figure | `{.marginfigure}` `![alt](url)` + caption `{/.marginfigure}` |
| Epigraph | `{.epigraph}` + blockquote lines + `{/.epigraph}` |
| Fullwidth | `{.fullwidth}` ... `{/.fullwidth}` |
| Figure grid | `<div class="figure-grid grid-2x1">` ... `</div>` |
| Carousel | `{.carousel}path/to/folder{/.carousel}` |
| BOM table | `<div class="bom-table" markdown>` ... `</div>` |
| Embed frame | `<div class="embed-frame"><div class="embed-inner">` iframe `</div></div>` |
