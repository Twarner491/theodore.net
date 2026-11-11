# Instagram / Facebook catalog

Commerce Manager's existing `theodorenet` feed fetches
`https://theodore.net/meta-catalog.csv` hourly. The Pages Function at that path
reads generated `meta-catalog-source.json` and overlays the same D1 primary
inventory read used by `/api/inventory-availability`. Quantity excludes both
sold units and reserved units. Failed inventory reads publish zero finite stock.
Meta may show the previous result until its next fetch finishes; website checkout
continues to enforce inventory independently.

Product copy, USD prices and all photos come from `docs/store/*.md` frontmatter.
Sold-out products publish `out of stock` and quantity zero instead of disappearing
from the feed. Ordinary made-to-order products retain their existing display
quantity of 25; the website's status controls whether they are available.

Variant-specific listings link to `?variant=<build>` so their website landing page
selects the same package and price shown in the card. Meta may append tracking
parameters to that query; the storefront preserves them. This does not change
the separate Shop checkout handoff, which resolves the catalog item ID.

Avian Visitors uses `metaCatalogId: avian-visitors`: only its current default build
is listed under that permanent ID. Open subsequent batches through the normal
storefront and inventory process, retaining this product field. Existing tags and
Meta checkout links then resolve to the new default build automatically. Retired
builds remain absent from the feed.

The generated static CSV is a fallback with finite stock set to zero. It is not
the live feed when Pages Functions are deployed. After a release, request an
update in Commerce Manager and verify the imported quantity, availability and
images. No Meta pixel or customer-data export is needed for this integration.
