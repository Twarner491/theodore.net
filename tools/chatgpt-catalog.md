# ChatGPT product catalog

The live discovery CSV is served at `https://theodore.net/chatgpt-catalog.csv`.
Business Hub accepts this hosted URL. OpenAI also documents a merchant path that
takes full snapshots over SFTP; this account uses the hosted URL instead.
[Business Hub setup](https://help.openai.com/en/articles/20001635-setting-up-your-business-on-chatgpt#connect-a-product-feed)
· [Merchant application](https://chatgpt.com/merchants/#form)
· [File specification](https://developers.openai.com/commerce/specs/file-upload/products)

The ChatGPT and Meta endpoints both read the product data generated from
`docs/store/*.md` and apply the same live storefront inventory and production
checks. Keep editing products on their store pages. The feed includes stable
item IDs, variant links, images, USD prices, stock status, and the store's
returns policy, US market fields, and the storefront's current shipping notes.
Avian Visitors retains one ID across production batches.
Sold-out items stay in the feed with `out_of_stock`. Future launches become
eligible at their scheduled time. The feed enables discovery, with ads and
in-chat checkout disabled.

After a catalog change, check the current Avian Visitors stock against its
product page and at least one kit option's link, price and photo. Inspect
Business Hub's Upload history and Issues after ingestion. Check the next import
after a price or stock change to establish the refresh lag. The public endpoint
reads live stock on each request, but Business Hub downloads it daily; checkout
still enforces current availability independently.

The merchant application was submitted on November 12, 2026 using
`support@theodore.net`. On November 20, Business Hub product onboarding was
enabled; no separate merchant approval email was found. Teddy explicitly
approved the displayed Merchant Feed Terms. The feed was deployed through the
usual Cloudflare Pages workflow and connected as **Things by Theodore — live
store**, US/USD, with daily refresh (the fastest native choice offered).
Both live CSVs were downloaded and all 13 rows matched on price, availability,
variant link and image. The first hosted import processed all 13 products,
Business Hub reports **Healthy**, and Issues reports no issues in the loaded
upload history. The catalog was selected in Agent builder and the update
published. Successful ingestion does not guarantee appearance in ChatGPT.
