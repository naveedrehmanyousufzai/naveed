# Setting up the admin page

Follow these in order. Do not skip ahead — each one depends on the last.

Total time: about an hour, mostly waiting on sign-up emails.

---

## What you're building

Naveed goes to `naveedrehman.com/admin`, clicks "Login with GitHub", and gets
forms. He adds a tournament, uploads a photo, hits Save. The website updates by
itself a minute later.

Behind the scenes: the admin page saves to GitHub, and Netlify notices the change
and rebuilds the site. Neither of you touches code.

---

## Part 1 — Put the site on GitHub

1. Go to github.com and sign in.
2. Click the **+** in the top right, choose **New repository**.
3. Name it `naveed`. Leave it **Public**. Do not tick any of the boxes below.
4. Click **Create repository**.
5. On the next screen find the link **uploading an existing file**.
6. Drag your whole `naveed` folder's *contents* into the browser window — all the
   HTML files, `styles.css`, `app.js`, `content.js`, and the `images`, `content`
   and `admin` folders.
7. Wait for the upload bar to finish, then click **Commit changes**.

You should now see all your files listed on GitHub.

---

## Part 2 — Put it online with Netlify

1. Go to netlify.com and click **Sign up**. Choose **Sign up with GitHub**.
2. Once in, click **Add new site → Import an existing project**.
3. Choose **GitHub**, then pick your `naveed` repository.
4. Leave every setting blank or as-is. Click **Deploy**.
5. Wait about a minute. Netlify gives you a web address like
   `random-name-12345.netlify.app`.

Open that address. Your site is live on the internet.

Rename it to something sensible under **Site configuration → Change site name**.

---

## Part 3 — Point the admin page at your repository

1. In VS Code, open `admin/config.yml`.
2. Line 4 reads:

   ```
   repo: YOUR-GITHUB-USERNAME/naveed
   ```

   Replace `YOUR-GITHUB-USERNAME` with your actual GitHub username. Keep the
   `/naveed` part. Save.

3. Upload the changed file to GitHub: on your repo page, click into the `admin`
   folder, click `config.yml`, click the **pencil icon**, paste the corrected
   line, and click **Commit changes**.

---

## Part 4 — Turn on the login

1. In Netlify, open your site and go to
   **Site configuration → Access & security → OAuth**.
2. Under *Authentication providers*, click **Install provider**.
3. Choose **GitHub** and authorise it.

That's the login switched on.

---

## Part 5 — Test it

1. Go to `your-site-name.netlify.app/admin`
2. Click **Login with GitHub** and approve.
3. You should see the editing screens: Tournament results, Press coverage,
   Store, Home page, Settings.
4. Open **Tournament results**, change one thing, click **Save** then
   **Publish**.
5. Wait a minute, then reload the main site. Your change is there.

---

## Part 6 — Give Naveed access

1. He signs up for a free GitHub account.
2. On your GitHub repo: **Settings → Collaborators → Add people**. Enter his
   username.
3. He accepts the email invitation.
4. Send him the link `naveedrehman.com/admin`. He logs in with GitHub and edits.

He never needs to understand GitHub. It's just his login.

---

## Part 7 — Move the domain (only when you're happy)

In Netlify: **Domain management → Add a domain**, enter `naveedrehman.com`, and
follow the instructions it gives you for your domain provider.

Keep the old site running until this step. There is no rush.

---

## What Naveed can and cannot change

**He can:** add, edit and delete tournament results; add press coverage with
photos; add, edit and remove store products; change the four career numbers and
the featured result on the home page; change the WhatsApp number and email.

**He cannot:** change page layouts, colours, the About page text, or anything in
`styles.css`. Those stay with you. That's deliberate — it's what stops the site
getting broken.

To let him edit something new, a field has to be added to `admin/config.yml`.
Ask me and I'll write it.

---

## If something goes wrong

**Admin page is blank.** The `repo:` line in `config.yml` is wrong. Check the
username spelling and that the repo is named `naveed`.

**"Failed to load config.yml".** The file must sit at `admin/config.yml` in the
repository, spelled exactly that way.

**Saved in admin, but the site didn't change.** Give it two minutes. Then check
Netlify → **Deploys** to see whether a new build ran.

**Site works on Netlify but not when you open files locally.** Expected. The
pages now load content from files, and browsers block that from your hard drive.
Always use Live Server, never double-click the HTML file.
