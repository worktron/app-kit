# Amazon cart pages

The cart pages keep the structure of cart pages recorded from a real account (regular Amazon, Amazon Fresh and Whole Foods Market on 2026-10-22, Amazon Fresh and Whole Foods Market again on 2026-11-05): the elements, ids and data attributes the reader uses, with made-up products, prices, product numbers, line ids, tokens, names, towns and ZIP codes in place of the real ones. The signed-out pages and `refused.html` keep the structure of pages fetched on 2026-11-05 with no cookies at all, which hold nothing about anyone. The repository is public, so `test/amazon-cart.test.ts` holds that every number and product here is a stand-in.

| Page | Recorded as |
| --- | --- |
| `cart-fresh.html`, `cart-wholefoods.html` | A grocery store's own cart page, `cartPath(store)`, signed in, with lines. |
| `cart-regular.html` | Regular Amazon's cart page, signed in, with a line, a saved-for-later item and both grocery carts shown collapsed. |
| `signed-out-cart.html` | Regular Amazon's cart page with no cookies. Amazon Fresh's cart page with no cookies redirects here too. |
| `signed-out-grocery.html` | Whole Foods Market's cart page with no cookies: a page with no cart on it. |
| `refused.html` | What Amazon answered a request with too few of a browser's headers: status 406, "Page Not Found". |

## What marks each store's cart

- **A grocery cart** (Amazon Fresh, Whole Foods Market): the page has one expanded grocery cart, `#sc-expanded-cart-localmarket`, and its checkout box (`#sc-fresh-buy-box` for Fresh, `#sc-alm-buy-box` for Whole Foods) carries the store's brand id as `data-brand-id` and Amazon's count of items as `data-quantity`, with a hidden `almBrandId` input holding the brand id again. Regular Amazon's cart page shows both grocery carts collapsed, each with the same kind of checkout box and input, which is why only the expanded cart counts.
- **Regular Amazon's cart**: the page has its active cart, `#sc-active-cart`, with Amazon's count of items as `data-cart-total-item-count`.
- **Signed out**: the header's account line reads "Hello, sign in". It is checked first, since a signed-out regular cart page has an active cart too, empty.

## What is not known

- **An empty grocery cart has never been recorded.** Both grocery carts held items at every recording. Whether its page still has the expanded grocery cart, and whether that still has a checkout box naming the store, is unknown. If it does, `readCart` reads it as a cart with no lines. If the checkout box is gone, `readCart` throws `NotTheCart` with the reason "The page's grocery cart has no checkout box naming its store", rather than guessing that the cart is empty. Recording one, with `amazon-connector raw GET '/cart/localmarket?almBrandId=<brand id>' --save <name>` after a grocery checkout, settles it.
- **An empty regular cart has been seen only signed out.** Signed out, the active cart is there with a count of 0 and "Your Amazon Cart is empty". A signed-in empty regular cart is expected to be the same without the sign-in, and to read as a cart with no lines, but it has not been recorded.
- **A robot check (a page asking for typed characters) has not been recorded.** It has neither cart's mark, so it throws `NotTheCart` with the kind `not-this-cart`, the same as any page without one.
