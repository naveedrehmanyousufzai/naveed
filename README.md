# Naveed Rehman — site prototype

Static HTML/CSS/JS. No build step, no npm. Open `index.html` in a browser.

## Run it in VS Code

1. Open this folder in VS Code (`File → Open Folder`).
2. Install the **Live Server** extension.
3. Right-click `index.html` → **Open with Live Server**.

Edits save and reload instantly.

**Always open it through Live Server, never by double-clicking the HTML file.**
The pages now load their content from the `content` folder, and browsers block
that when you open a file directly from your hard drive. You'd get a page with
no results and no products.

## Files

| File | What it is |
|---|---|
| `styles.css` | Design tokens + all styling. Read this first. |
| `index.html` | Home |
| `shop.html` | Store grid, category filter |
| `results.html` | Tournament archive, year filter |
| `media.html` | Press and footage |
| `about.html` | Bio + career timeline |
| `contact.html` | Enquiries |
| `app.js` | Menu toggle and filters |
| `content.js` | Fills the pages from `content/` — don't edit |
| `content/*.json` | The actual content. The admin page writes these. |
| `admin/` | The content manager. See SETUP-ADMIN.md |
| `images/nr-logo.png` | Mark for light backgrounds (nav) |
| `images/nr-logo-light.png` | Mark for dark backgrounds (footer) |

## Design system

Everything is driven by the logo. Two brand colours, sampled straight from the
PNG, plus four neutrals:

```
--ink       #111111   logo black — text, footer, record strip
--gold      #D4AF37   logo gold — rules, marks, primary buttons
--paper     #F4F2ED   page background
--card      #FFFFFF   raised surfaces
--ash       #6B6963   secondary text
--hairline  #DAD6CD   quiet borders
--gold-ink  #8A6D14   darkened gold, for gold-coloured TEXT on light
```

**Never set `--gold` as text colour on a light background.** #D4AF37 on #F4F2ED
is about 2:1 contrast — unreadable and it fails accessibility. Gold works as a
fill (with black text on top), as a rule, or as text on the black sections. For
gold-looking text on light, use `--gold-ink`.

The section divider is the segmented bar from underneath the NR mark, redrawn in
CSS as a repeating gradient. It is the one device that ties every page back to
the logo, so keep it.

Type: `Archivo` 800/900 for headings, `Public Sans` for body.
Scale: 13 / 15 / 17 / 22 / 34 / 52 / clamp-display. Nothing in between.
Spacing: multiples of 8.

## Placeholders

Grey blocks are where images go. Product images show a number instead.
All results, statistics and dates are invented — replace them.

Set the real WhatsApp number in `product.html` and `contact.html`:
`https://wa.me/923000000000` → your number, country code, no `+` or spaces.

## Porting to Next.js later

When the design is settled:

```
app/layout.js        ← the <header> and <footer> blocks
app/page.js          ← index.html body
app/shop/page.js     ← shop.html body
app/shop/[slug]/page.js
app/results/page.js
app/about/page.js
app/media/page.js
app/contact/page.js
app/globals.css      ← styles.css as-is
```

Rules when converting: `class` becomes `className`, every tag closes, and any
file using `useState` or an `onClick` needs `'use client'` on line one. The CSS
does not change at all.  
