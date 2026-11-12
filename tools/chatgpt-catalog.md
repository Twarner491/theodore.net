# ChatGPT product catalog

After this change is deployed, the discovery CSV is served at
`https://theodore.net/chatgpt-catalog.csv`. Business Hub accepts a hosted feed
file URL when **Products → Add products** is enabled. OpenAI also documents an
approved merchant path that takes full snapshots over SFTP. Confirm the delivery
method and refresh schedule for this account during onboarding.
[Business Hub setup](https://help.openai.com/en/articles/20001635-setting-up-your-business-on-chatgpt#connect-a-product-feed)
· [Merchant application](https://chatgpt.com/merchants/#form)
· [File specification](https://developers.openai.com/commerce/specs/file-upload/products)

The ChatGPT and Meta endpoints both read the product data generated from
`docs/store/*.md` and apply the same live storefront inventory and production
checks. Keep editing products on their store pages. The feed includes stable
item IDs, variant links, images, USD prices, stock status, and the store's
returns policy. Avian Visitors retains one ID across production batches.
Sold-out items stay in the feed with `out_of_stock`. Future launches become
eligible at their scheduled time. The feed enables discovery, with ads and
in-chat checkout disabled.

After deployment, open the CSV and check the current Avian Visitors stock
against its product page, then verify at least one kit option's link, price,
and photo. Once the feed can be connected, inspect Upload history and Issues
for the first import, and confirm the imported price and availability in
Business Hub before selecting the catalog in Agent builder. Check the next
import after a price or stock change to establish the refresh lag.

The merchant application was submitted on November 12, 2026 using
`support@theodore.net`. OpenAI confirmed receipt. Wait for approval, then
check which delivery method it enabled. For a hosted URL, bring the feed
commit onto the current main branch and use the usual Cloudflare Pages
deployment workflow. Verify both the ChatGPT CSV and the existing Meta CSV
on the live site before connecting the new feed. If approval specifies SFTP,
use OpenAI's supplied delivery instructions for full snapshots.
