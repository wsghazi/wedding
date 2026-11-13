# Wedding registry hub

A static GitHub Pages site that puts all our registries in one place: a gift catalog with Buy links to each store, store-level registry buttons, cash funds, and an **I bought this** button so guests don't double up across stores. No fees, no build step.

Live site: https://wsghazi.github.io/wedding/

## Editing the registry

Everything lives in [`data/registry.json`](data/registry.json). Edit it on GitHub (pencil icon) and commit; the site updates in about a minute.

### Add a gift (one line)

Copy any line in `items` and change it:

```json
{ "name": "Stand mixer, 5 qt", "price": 449, "store": "williams-sonoma", "url": "https://www.williams-sonoma.com/products/...", "image": "https://.../mixer.jpg" },
```

| Field   | Required | Notes |
|---------|----------|-------|
| `name`  | yes | What guests see. |
| `store` | yes | Must match an `id` in `stores`. |
| `url`   | yes | The product page. The Buy button opens it in a new tab. |
| `price` | no  | A number, no `$`. |
| `image` | no  | Full image URL, or a file you add to `assets/`, e.g. `"assets/mixer.jpg"`. Without one, a monogram tile is shown. Tip: right-click the store's product photo and choose "Copy image address". |
| `qty`   | no  | For things you want several of, e.g. `"qty": 3` for three plate sets. Defaults to 1. |
| `note`  | no  | A short line under the price, e.g. `"Color: sage"`. |
| `id`    | no  | Claims are tied to an id built from the store and name. If you need to **rename an item that's already been claimed**, first add `"id"` with its current id (store id + name in lowercase-with-dashes, e.g. `"williams-sonoma-stand-mixer-5-qt"`) so the claim stays attached. |

Watch the commas: every line in a list except the last ends with `,`. If the page says it couldn't load the registry, paste the file into https://jsonlint.com to find the typo.

### Stores and funds

- `stores`: each one gets a button at the top if it has a `url`. Put your actual registry page URL there (e.g. your Williams Sonoma registry link). A store with an empty `url` still works for items but gets no button.
- `funds`: honeymoon or cash funds. Each can have `venmo`, `paypal`, and/or a generic `url` + `label`. Remove the `funds` entries you don't want, or leave the list empty to hide the section.
- `couple`, `date`, `intro`: the heading text.

## Turning on shared claims

Out of the box `claims.backend` is `"local"`, which is a demo mode: claims only save in the browser that made them. Pick **one** of the two free options below so all guests see the same claims.

### Option A: Firebase Realtime Database (recommended)

1. Go to https://console.firebase.google.com, **Add project**, any name (Analytics not needed). The free Spark plan is plenty.
2. In the left menu: **Build > Realtime Database > Create database**. Pick a location, start in **locked mode**.
3. Open the **Rules** tab, replace everything with the contents of [`backend/firebase-rules.json`](backend/firebase-rules.json), and **Publish**. These rules let anyone read claims and add or remove a single claim, but not touch anything else.
4. Copy the database URL shown at the top of the **Data** tab (looks like `https://your-project-default-rtdb.firebaseio.com`).
5. In `data/registry.json` set:
   ```json
   "claims": { "backend": "firebase", "firebaseUrl": "https://your-project-default-rtdb.firebaseio.com" }
   ```

To see who bought what, look at the **Data** tab: `claims > item-id > entry > name`. To reset a mistaken claim, delete that entry there.

### Option B: Google Sheet via Apps Script

1. Create a new Google Sheet. **Extensions > Apps Script**.
2. Replace the code with [`backend/apps-script/Code.gs`](backend/apps-script/Code.gs) and save.
3. **Deploy > New deployment**, type **Web app**, Execute as **Me**, Who has access **Anyone**. Authorize when asked.
4. Copy the web app URL (ends in `/exec`).
5. In `data/registry.json` set:
   ```json
   "claims": { "backend": "appsscript", "appsScriptUrl": "https://script.google.com/macros/s/.../exec" }
   ```

Claims show up as rows in the `claims` tab of the sheet, which doubles as your thank-you list. If you change the script later, use **Deploy > Manage deployments > Edit > New version** so the URL stays the same.

### Privacy note

Guest names are optional. With either backend, claim data is readable by anyone who digs into the page's network requests, so it's fine for "Aunt Rania bought the mixer" but don't collect anything sensitive.

## How it works

- `index.html`, `assets/styles.css`, `assets/app.js`: the whole site, plain HTML/CSS/JS.
- Store checkouts can't be embedded, so Buy links open the store's product page. Guests come back and tap **I bought this**.
- Before saving a claim the page re-checks whether someone else just took it. Claims refresh every 30 seconds.
- Guests can undo their own claim from the same device.

## Running locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening `index.html` directly from disk won't load the JSON, so use a local server.)
